import { supabaseServer as db } from '@/lib/supabase-server';
import { validateWebsiteFiscalConfig } from '@/lib/website-plans';
import { validDate } from '@/lib/website-contracts';
import { validDocument } from '@/lib/holding-customers';
import nacional from '@/services/nfse/providers/national';
import xmlService, { type DPSData } from '@/services/nfse/xml-service';
import { dataHoraNacional } from '@/services/nfse/data-hora';
import { lerDocumentoOficial } from '@/services/nfse/documento-oficial';
import { montarSnapshotDanfse } from '@/services/nfse/danfse-snapshot';
import municipios from '@/services/nfse/municipios-ibge.json';

export type WebsiteFiscalSource = {
  id: string;
  total_cents: number;
  customer_snapshot: Record<string, unknown>;
  plan_snapshot: Record<string, unknown>;
};
type Reservation = {
  id: string; contract_id: string; status: string; competence: string;
  operation: string; dps_number: string; series: string; issuer_document: string;
};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function websiteInvoiceData(
  contract: WebsiteFiscalSource, config: Record<string, unknown>, competence: string,
  policy: 'manual_project_total' | 'automatic_after_payment' = 'manual_project_total',
): DPSData {
  const now = dataHoraNacional().slice(0, 10);
  if (!validDate(competence) || competence > now || competence.slice(0, 4) !== '2026') {
    throw new Error('Informe uma competência válida de 2026, não futura. Revise IBS/CBS antes de emitir para 2027.');
  }
  if (contract.plan_snapshot.invoice_policy !== policy) throw new Error('Política fiscal da contratação incompatível com esta emissão.');
  const fiscal = validateWebsiteFiscalConfig(contract.plan_snapshot.fiscal_config);
  if (!fiscal.ok || !fiscal.data?.accountant_confirmed || fiscal.data.simples_percent === null) {
    throw new Error('Contrato sem enquadramento fiscal completo e confirmado. Revise a contratação; editar o catálogo não altera o histórico.');
  }
  const nationalConfig = config.nacional;
  if (!nationalConfig || typeof nationalConfig !== 'object' || Array.isArray(nationalConfig)) throw new Error('Configure o emissor nacional da Holding.');
  const settings = nationalConfig as Record<string, unknown>;
  if (config.environment !== 'producao' || settings.enabled !== true || settings.enquadramentoConfirmado !== true) {
    throw new Error('Emissor nacional de produção ou enquadramento do prestador não confirmado.');
  }
  if (!/^\d{1,5}$/.test(text(settings.serie)) || Number(settings.serie) < 1 || Number(settings.serie) > 49999
    || !/^\d{7}$/.test(text(settings.municipioEmissao))) throw new Error('Série ou município de emissão nacional inválido.');
  if (!validDocument(text(config.prestador_cnpj)) || text(config.prestador_cnpj).length !== 14
    || !text(config.pfxBase64) || typeof config.passphrase !== 'string') throw new Error('CNPJ ou certificado A1 da Holding não configurado.');
  const customer = contract.customer_snapshot;
  const document = text(customer.document);
  if (!validDocument(document)) throw new Error('Documento fiscal inválido no contrato.');
  const normal = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  const city = text(customer.city);
  const state = text(customer.state).toUpperCase();
  const found = municipios.filter((row) => row.uf === state && (row.codigo === city || normal(row.nome) === normal(city)));
  if (found.length !== 1) throw new Error('Município/UF fiscal do contrato inválido. Complete o cliente antes de contratar.');
  if (!Number.isSafeInteger(contract.total_cents) || contract.total_cents <= 0) throw new Error('Valor do projeto inválido.');
  const data: DPSData = {
    ambiente: 1, numero: '1', serie: text(settings.serie), dataEmissao: dataHoraNacional(),
    prestador: { cnpj: text(config.prestador_cnpj), inscricaoMunicipal: text(config.inscricao_municipal) },
    tomador: {
      ...(document.length === 11 ? { cpf: document } : { cnpj: document }),
      razaoSocial: text(customer.name), email: text(customer.email),
      endereco: {
        codigoMunicipio: found[0].codigo, cep: text(customer.postal_code),
        logradouro: text(customer.address), numero: text(customer.address_number), bairro: text(customer.district),
        complemento: text(customer.complement) || undefined,
      },
    },
    servico: {
      valorServicos: contract.total_cents / 100, codigoItemListaServico: fiscal.data.national_code,
      discriminacao: fiscal.data.service_description,
    },
    nacional: {
      competencia: competence, municipioEmissao: text(settings.municipioEmissao),
      municipioPrestacao: text(settings.municipioEmissao), codigoTributacaoNacional: fiscal.data.national_code,
      codigoTributacaoMunicipal: fiscal.data.municipal_code || undefined,
      codigoNbs: fiscal.data.nbs, percentualTributosSimples: fiscal.data.simples_percent, regimeConfirmado: 'simples-me-epp',
    },
  };
  // Valida toda a DPS antes de reservar operação ou enviar ao fisco.
  xmlService.generateDPS(data);
  return data;
}

export async function emitWebsiteInvoice(id: string, competence: string, confirmed: boolean) {
  const [contractResult, configResult] = await Promise.all([
    db.from('holding_website_contracts').select('id,total_cents,customer_snapshot,plan_snapshot').eq('id', id).single(),
    db.from('system_settings').select('value').eq('id', 'nfse_config').single(),
  ]);
  if (contractResult.error || !contractResult.data || configResult.error || !configResult.data?.value) {
    throw new Error('Não foi possível carregar contrato e configuração nacional da Holding.');
  }
  const contract: WebsiteFiscalSource = contractResult.data;
  const config: Record<string, unknown> = configResult.data.value;
  const data = websiteInvoiceData(contract, config, competence);
  const summary = {
    contract_id: id, customer: data.tomador.razaoSocial, total_cents: contract.total_cents,
    competence, national_code: data.nacional!.codigoTributacaoNacional, municipal_code: data.nacional!.codigoTributacaoMunicipal || '',
    nbs: data.nacional!.codigoNbs, description: data.servico.discriminacao,
    simples_percent: data.nacional!.percentualTributosSimples,
  };
  if (!confirmed) return { sent: false, preview: summary };
  const { data: reserved, error: reserveError } = await db.rpc('holding_reserve_website_invoice', {
    p_contract_id: id, p_competence: competence, p_series: data.serie, p_issuer_document: data.prestador.cnpj,
  }).single<Reservation>();
  if (reserveError || !reserved) {
    throw new Error(reserveError?.code === '23505'
      ? 'Nota deste contrato já reservada/enviada. Confira o histórico e o portal nacional; não repita a emissão.'
      : 'Não foi possível reservar a operação fiscal. Nenhuma nota foi enviada.');
  }
  const { data: current, error: currentError } = await db.from('holding_website_contracts')
    .select('total_cents,customer_snapshot,plan_snapshot').eq('id', id).single();
  if (currentError || !current || current.total_cents !== contract.total_cents
    || JSON.stringify(current.customer_snapshot) !== JSON.stringify(contract.customer_snapshot)
    || JSON.stringify(current.plan_snapshot) !== JSON.stringify(contract.plan_snapshot)) {
    throw new Error('Contratação alterada durante a reserva fiscal. Nenhuma nota foi enviada; confira a operação reservada antes de continuar.');
  }
  return deliverWebsiteInvoice(reserved, data, config, contract.customer_snapshot, {
    website_contract_id: id, invoice_policy: 'manual_project_total',
  });
}

async function deliverWebsiteInvoice(
  reservation: Reservation, data: DPSData, config: Record<string, unknown>,
  customer: Record<string, unknown>, origin: Record<string, string>,
) {
  const competence = data.nacional!.competencia;
  const value = data.servico.valorServicos;
  data.numero = reservation.dps_number;
  let authorized = false;
  try {
    const xml = xmlService.generateDPS(data);
    const metadata = {
      ambiente: 'producao', provider: 'nacional', competencia: competence, mes_ref: competence.slice(0, 7),
      operacao_nacional: reservation.operation, ...origin,
      numero_dps: data.numero, serie_dps: data.serie, dps_xml: xml,
    };
    const { error: controlError } = await db.from('system_settings').update({
      value: { ...metadata, status: 'enviando', competencia: competence, valor: value },
      updated_at: new Date().toISOString(),
    }).eq('id', reservation.operation).select('id').single();
    if (controlError) throw new Error('Não foi possível persistir o controle fiscal. Nenhuma DPS enviada.');
    const { error: stateError } = await db.from('holding_website_invoices').update({ status: 'sending' })
      .eq('id', reservation.id).eq('status', 'preparing').select('id').single();
    if (stateError) throw new Error('Não foi possível confirmar a reserva fiscal. Nenhuma DPS enviada.');
    const result = await nacional.emit(data, text(config.pfxBase64), String(config.passphrase));
    if (!result.success || result.status !== 'authorized' || !result.xml) {
      throw new Error('Emissor não confirmou a autorização. Consulte a DPS no portal antes de qualquer ação.');
    }
    authorized = true;
    const official = lerDocumentoOficial(result.xml);
    const { error: resultError } = await db.from('holding_website_invoices').update({ status: 'authorized', result })
      .eq('id', reservation.id).select('id').single();
    if (resultError) throw new Error('Nota autorizada, mas o vínculo local falhou. Não reenvie; confira o portal nacional.');
    const { error: authorizedControlError } = await db.from('system_settings').update({
      value: { ...metadata, status: 'authorized', competencia: competence, valor: value, result },
      updated_at: new Date().toISOString(),
    }).eq('id', reservation.operation).select('id').single();
    if (authorizedControlError) throw new Error('Nota autorizada, mas o controle fiscal falhou. Não reenvie.');
    const { data: history, error: historyError } = await db.from('system_invoices').insert({
      invoice_number: result.invoiceId, status: 'authorized', client_name: data.tomador.razaoSocial,
      client_document: data.tomador.cnpj || data.tomador.cpf, value: data.servico.valorServicos,
      access_link: result.accessLink, error_message: null,
      metadata: {
        ...metadata, xml: result.xml, nfse_oficial_xml: result.xml, documento_oficial: official,
        danfse: montarSnapshotDanfse({
          dpsData: {
            ...data, prestador: { ...data.prestador, razaoSocial: text(config.razao_social) },
            tomador: { ...data.tomador, endereco: {
              ...data.tomador.endereco, cidade: text(customer.city), uf: text(customer.state),
            } },
          }, config, retornoXml: result.xml, accessLink: result.accessLink,
        }),
      },
    }).select('id').single();
    if (historyError || !history) throw new Error('Nota autorizada, mas o histórico visual falhou. Não reenvie; consulte o portal.');
    const { error: linkError } = await db.from('holding_website_invoices').update({ system_invoice_id: history.id })
      .eq('id', reservation.id).select('id').single();
    if (linkError) throw new Error('Nota autorizada e salva, mas o vínculo ao histórico falhou. Não reenvie.');
    return { sent: true, invoice_number: result.invoiceId, message: 'NFS-e nacional autorizada pelo valor total contratado.' };
  } catch (error) {
    if (!authorized) {
      const { error: reviewError } = await db.from('holding_website_invoices').update({ status: 'review' })
        .eq('id', reservation.id);
      if (reviewError) console.error('[WEBSITE NFS-E] Falha ao sinalizar revisão. Operação permanece bloqueada.');
      const { error: controlError } = await db.from('system_settings').update({
        value: { status: 'verificar_no_portal', competencia: competence, valor: value, ...origin },
        updated_at: new Date().toISOString(),
      }).eq('id', reservation.operation);
      if (controlError) console.error('[WEBSITE NFS-E] Controle fiscal pendente de revisão administrativa.');
    }

    throw error;
  }
}

export async function validateWebsiteSubscriptionFiscal(source: WebsiteFiscalSource) {
  const { data, error } = await db.from('system_settings').select('value').eq('id', 'nfse_config').single();
  if (error || !data?.value) throw new Error('Não foi possível carregar o emissor nacional da Holding.');
  return { config: data.value as Record<string, unknown>, data: websiteInvoiceData(
    source, data.value, dataHoraNacional().slice(0, 10), 'automatic_after_payment',
  ) };
}

export async function emitWebsiteSubscriptionInvoice(paymentId: string, source: WebsiteFiscalSource, competence: string) {
  const { data: configRow, error: configError } = await db.from('system_settings').select('value').eq('id', 'nfse_config').single();
  if (configError || !configRow?.value) throw new Error('Emissor nacional indisponível.');
  const config: Record<string, unknown> = configRow.value;
  const data = websiteInvoiceData(source, config, competence, 'automatic_after_payment');
  const { data: reserved, error } = await db.rpc('holding_reserve_website_subscription_invoice', {
    p_payment_id: paymentId, p_series: data.serie, p_issuer_document: data.prestador.cnpj,
  }).single<Reservation>();
  if (error || !reserved) {
    if (error?.code === '23505') {
      const { data: existing, error: existingError } = await db.from('holding_website_invoices')
        .select('id,status').eq('subscription_payment_id', paymentId).maybeSingle();
      if (existingError || !existing) throw new Error('Conflito fiscal sem reserva recuperável. Revisão administrativa necessária.');
      console.warn('[WEBSITE NFS-E] Operação recorrente já reservada; nenhum novo envio.');
      return { sent: false, message: 'Operação já reservada. Confira o histórico e o portal nacional.' };
    }
    throw new Error('Falha ao reservar a NFS-e do pagamento. Nenhuma DPS enviada.');
  }
  return deliverWebsiteInvoice(reserved, data, config, source.customer_snapshot, {
    website_subscription_id: source.id, website_subscription_payment_id: paymentId, invoice_policy: 'automatic_after_payment',
  });
}
