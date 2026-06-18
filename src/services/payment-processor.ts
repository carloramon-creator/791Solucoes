import { AsaasClient } from './asaas-service';
import { InterAPIV2 } from './inter-service';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import ipmProvider from '@/lib/nfse/providers/ipm';

// Configurações globais
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Chaves do Glass para atualização remota
const glassUrl = process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL!;
const glassServiceKey = process.env.SUPABASE_GLASS_SERVICE_ROLE_KEY!;

function getLocalIsoTimestamp() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString();
}

function addCycleToDate(baseDate: Date, cycle: string) {
  const nextDate = new Date(baseDate);

  if (cycle === 'annual') {
    nextDate.setFullYear(nextDate.getFullYear() + 1);
    return nextDate;
  }

  if (cycle === 'semiannual') {
    nextDate.setMonth(nextDate.getMonth() + 6);
    return nextDate;
  }

  nextDate.setMonth(nextDate.getMonth() + 1);
  return nextDate;
}

function resolveNextExpiration(currentExpiration: string | null | undefined, cycle: string) {
  const today = new Date();
  const parsedExpiration = currentExpiration ? new Date(`${currentExpiration}T00:00:00`) : null;

  const baseDate = parsedExpiration && parsedExpiration > today ? parsedExpiration : today;
  return addCycleToDate(baseDate, cycle);
}

export class PaymentProcessor {
  /**
   * Processa um pagamento confirmado (via Webhook)
   * Identifica se é do Glass ou Barber e atualiza o acesso.
   */
  static async handlePaymentConfirmed(payload: {
    externalReference: string; // "glass|tenant_id" ou "barber|tenant_id"
    value: number;
    paymentMethod: string;
    bankId: string;
    metadata?: any;
  }) {
    const parts = payload.externalReference.split('|');
    const [saasType, tenantId, , couponId] = parts;
    const asaasPaymentId = payload?.metadata?.id || payload?.metadata?.payment?.id || null;
    
    console.log(`[PAYMENT PROCESSOR] Pagamento confirmado para ${saasType}: ${tenantId}${couponId ? ` (cupom: ${couponId})` : ''}`);

    // 1. Registrar na Holding (system_finance_records)
    const holdingSupabase = createClient(supabaseUrl, supabaseServiceKey);
    try {
      const metadata = {
        ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
        tenant_id: tenantId,
        external_reference: payload.externalReference,
      };

      await holdingSupabase.from('system_finance_records').insert({
        business_unit: saasType,
        type: 'revenue',
        value: payload.value,
        description: `Assinatura SaaS ${saasType} - Tenant: ${tenantId}`,
        payment_method: payload.paymentMethod,
        bank_id: payload.bankId,
        category: 'SaaS Revenue',
        metadata,
      });
    } catch (financeErr: any) {
      // Não deve impedir a ativação da assinatura por causa de falha no registro financeiro
      console.error('[PAYMENT PROCESSOR] Erro ao registrar system_finance_records:', financeErr.message);
    }

    // 2. Atualizar o SaaS correspondente
    if (saasType === 'glass') {
      const cycle = payload.externalReference.split('|')[2] || 'monthly';
      
      if (!glassServiceKey) {
        console.error('[PAYMENT PROCESSOR] Erro: SUPABASE_GLASS_SERVICE_ROLE_KEY não configurada!');
        await persistInvoiceFailure({
          holdingSupabase,
          tenantId,
          valor: payload.value,
          ciclo: cycle,
          asaasPaymentId,
          message: 'SUPABASE_GLASS_SERVICE_ROLE_KEY não configurada no ambiente de execução.',
          step: 'env_glass_service_key',
        });
        return;
      }
      
      const glassSupabase = createClient(glassUrl, glassServiceKey);
      
      const { data: currentTenant, error: currentTenantError } = await glassSupabase
        .from('vidracarias')
        .select('id, vencimento_assinatura')
        .eq('id', tenantId)
        .single();

      if (currentTenantError) {
        console.warn('[PAYMENT PROCESSOR] Não foi possível ler o vencimento atual da vidraçaria:', currentTenantError.message);
      }

      const nextExpiration = resolveNextExpiration(currentTenant?.vencimento_assinatura, cycle);

      console.log(`[PAYMENT PROCESSOR] Ativando vidracaria ${tenantId} (Ciclo: ${cycle}) até ${nextExpiration.toISOString()}`);

      const updatePayload = {
        ativa: true,
        status_assinatura: 'ativa',
        vencimento_assinatura: nextExpiration.toISOString().split('T')[0],
        ultimo_pagamento_em: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      let { error } = await glassSupabase
        .from('vidracarias')
        .update(updatePayload)
        .eq('id', tenantId);

      if (error?.message?.includes("Could not find the 'vencimento_assinatura' column")) {
        console.warn('[PAYMENT PROCESSOR] Coluna vencimento_assinatura ausente no Glass. Repetindo ativação sem esse campo.');

        ({ error } = await glassSupabase
          .from('vidracarias')
          .update({
            ativa: true,
            status_assinatura: 'ativa',
            ultimo_pagamento_em: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', tenantId));
      }

      if (error) {
        console.error(`[PAYMENT PROCESSOR] Erro ao atualizar vidracaria no Glass:`, error);
        await persistInvoiceFailure({
          holdingSupabase,
          tenantId,
          valor: payload.value,
          ciclo: cycle,
          asaasPaymentId,
          message: `Falha ao atualizar vidraçaria no Glass: ${error.message}`,
          step: 'activate_tenant',
        });
      } else {
        console.log(`[PAYMENT PROCESSOR] Vidracaria ${tenantId} no Glass ativada com sucesso!`);

        // Registrar uso do cupom (se havia cupom aplicado)
        if (couponId) {
          try {
            const { data: couponRow } = await holdingSupabase
              .from('coupons')
              .select('used_count')
              .eq('id', couponId)
              .single();

            if (couponRow) {
              await holdingSupabase
                .from('coupons')
                .update({ used_count: couponRow.used_count + 1 })
                .eq('id', couponId);

              await holdingSupabase.from('coupon_uses').insert({
                coupon_id: couponId,
                vidracaria_id: tenantId,
                used_at: new Date().toISOString(),
                value: payload.value,
              });

              console.log(`[PAYMENT PROCESSOR] Uso do cupom ${couponId} registrado para vidraçaria ${tenantId}`);
            }
          } catch (couponErr: any) {
            // Não bloqueia o fluxo — apenas loga
            console.error(`[PAYMENT PROCESSOR] Erro ao registrar uso do cupom:`, couponErr.message);
          }
        }

      }

        if (!error) {
          try {
            await scheduleMonthlyOverageChargeForTenant({
              holdingSupabase,
              glassSupabase,
              tenantId,
            });
          } catch (overageErr: any) {
            console.error(`[PAYMENT PROCESSOR] Erro ao lançar excedente automático para ${tenantId}:`, overageErr.message);
          }
        }

      // Emitir NF-e automaticamente após confirmar o pagamento
      try {
        await emitirNFeSaas({
          holdingSupabase,
          glassSupabase,
          vidracariaId: tenantId,
          valor: payload.value,
          ciclo: cycle,
          asaasPaymentId,
        });
      } catch (nfErr: any) {
        await persistInvoiceFailure({
          holdingSupabase,
          tenantId,
          valor: payload.value,
          ciclo: cycle,
          asaasPaymentId,
          message: nfErr?.message || 'Falha desconhecida ao emitir NF-e',
          step: 'emitirNFeSaas',
        });
        console.error(`[PAYMENT PROCESSOR] Erro ao emitir NF-e para ${tenantId}:`, nfErr.message);
      }
    } 
    
    // CASO 3: Patrocinadores (Holding)
    else if (saasType === 'sponsor') {
      console.log(`[PAYMENT PROCESSOR] Ativando Patrocinador: ${tenantId}`);
      
      const { data: sponsor, error: fError } = await holdingSupabase
        .from('patrocinadores')
        .select('*')
        .eq('id', tenantId)
        .single();

      if (fError || !sponsor) {
        console.error(`[PAYMENT PROCESSOR] Patrocinador ${tenantId} não encontrado!`);
        return;
      }

      // Cálculo de validade baseado no ciclo
      const cycle = sponsor.ciclo || 'MONTHLY';
      let daysToAdd = 31;
      
      if (cycle === 'QUARTERLY') daysToAdd = 92;
      else if (cycle === 'SEMI_ANNUAL') daysToAdd = 183;
      else if (cycle === 'YEARLY') daysToAdd = 366;

      const currentExp = sponsor.data_expiracao ? new Date(sponsor.data_expiracao) : new Date();
      // Se já estiver expirado, começa de hoje. Se não, soma à data atual.
      const baseDate = currentExp > new Date() ? currentExp : new Date();
      
      const nextExpiration = new Date(baseDate);
      nextExpiration.setDate(nextExpiration.getDate() + daysToAdd);

      console.log(`[PAYMENT PROCESSOR] Patrocinador ${sponsor.nome} ativado até ${nextExpiration.toISOString()} (Ciclo: ${cycle})`);

      const { error: uError } = await holdingSupabase
        .from('patrocinadores')
        .update({
          status: 'ativo',
          data_expiracao: nextExpiration.toISOString().split('T')[0],
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantId);

      if (uError) {
        console.error(`[PAYMENT PROCESSOR] Erro ao atualizar Patrocinador:`, uError.message);
      }
    }
    
    // TODO: Adicionar lógica para o Barber se necessário (embora já esteja integrado lá)
  }

  /**
   * Gera uma cobrança via Asaas (Cartão)
   */
  static async createAsaasSubscription(customerData: any, planData: any) {
    // Lógica para criar assinatura recorrente no Asaas
    // ...
  }

  /**
   * Gera um Pix via Banco Inter
   */
  static async createInterPix(customerData: any, amount: number) {
    // Lógica para criar Pix/Boleto no Inter
    // ...
  }
}

function getPreviousMonthWindow(now = new Date()) {
  const currentStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const previousStart = new Date(currentStart);
  previousStart.setMonth(previousStart.getMonth() - 1);

  const refMonth = `${previousStart.getFullYear()}-${String(previousStart.getMonth() + 1).padStart(2, '0')}`;
  return {
    refMonth,
    startIso: previousStart.toISOString(),
    endIso: currentStart.toISOString(),
  };
}

function getOverageDueDateFromRefMonth(refMonth: string) {
  const [yearStr, monthStr] = refMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    const fallback = new Date();
    fallback.setDate(5);
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }

  // refMonth referencia o mes de consumo; vencimento fixo no dia 5 do mes seguinte.
  const dueDate = new Date(year, month, 5, 0, 0, 0, 0);
  return dueDate;
}

export async function scheduleMonthlyOverageChargeForTenant({
  holdingSupabase,
  glassSupabase,
  tenantId,
}: {
  holdingSupabase: SupabaseClient<any, 'public', any, any, any>;
  glassSupabase: SupabaseClient<any, 'public', any, any, any>;
  tenantId: string;
}) {
  const { refMonth, startIso, endIso } = getPreviousMonthWindow();
  const dueDate = getOverageDueDateFromRefMonth(refMonth);

  const { data: existingOverage } = await holdingSupabase
    .from('system_finance_records')
    .select('id')
    .eq('metadata->>tenant_id', tenantId)
    .eq('metadata->>kind', 'overage')
    .eq('metadata->>ref_month', refMonth)
    .maybeSingle();

  if (existingOverage?.id) {
    return { created: false, reason: 'already_exists' as const };
  }

  const [
    { data: tenant, error: tenantErr },
    { data: planConfig, error: planErr },
    { count: registeredUsers, error: usersErr },
    { data: sectorsData, error: sectorsErr },
    { count: messagesSent, error: messagesErr },
  ] = await Promise.all([
    glassSupabase
      .from('vidracarias')
      .select('id, nome, email, cnpj, limite_usuarios, limite_usuarios_whats, limite_mensagens_whatsapp')
      .eq('id', tenantId)
      .single(),
    holdingSupabase
      .from('system_plans')
      .select('system_limits')
      .eq('sistema', '791glass')
      .single(),
    glassSupabase
      .from('user_profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('vidracaria_id', tenantId),
    glassSupabase
      .from('whatsapp_sectors')
      .select('id')
      .eq('vidracaria_id', tenantId),
    glassSupabase
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('vidracaria_id', tenantId)
      .in('sender_type', ['user', 'system'])
      .gte('created_at', startIso)
      .lt('created_at', endIso),
  ]);

  const firstError = tenantErr || planErr || usersErr || sectorsErr || messagesErr;
  if (firstError) {
    throw new Error(firstError.message);
  }

  const sectorIds = (sectorsData || []).map((row: any) => row.id).filter(Boolean);
  let whatsappUsers = 0;

  if (sectorIds.length > 0) {
    const { data: sectorUsers, error: sectorUsersErr } = await glassSupabase
      .from('whatsapp_sector_users')
      .select('user_id')
      .in('sector_id', sectorIds);

    if (sectorUsersErr) {
      throw new Error(sectorUsersErr.message);
    }

    whatsappUsers = new Set((sectorUsers || []).map((row: any) => row.user_id).filter(Boolean)).size;
  }

  const limits = {
    users: Number(tenant?.limite_usuarios || 0),
    whatsappUsers: Number(tenant?.limite_usuarios_whats || 0),
    messages: Number(tenant?.limite_mensagens_whatsapp || 0),
  };

  const prices = {
    extraUserPrice: Number((planConfig as any)?.system_limits?.extraUserPrice || 0),
    extraDevicePrice: Number((planConfig as any)?.system_limits?.extraDevicePrice || 0),
    extraMessagePrice: Number((planConfig as any)?.system_limits?.extraMessagePrice || (planConfig as any)?.system_limits?.wppMessagesPrice || 0),
  };

  const extras = {
    users: Math.max(0, Number(registeredUsers || 0) - limits.users),
    whatsappUsers: Math.max(0, whatsappUsers - limits.whatsappUsers),
    messages: Math.max(0, Number(messagesSent || 0) - limits.messages),
  };

  const values = {
    users: extras.users * prices.extraUserPrice,
    whatsappUsers: extras.whatsappUsers * prices.extraDevicePrice,
    messages: extras.messages * prices.extraMessagePrice,
  };
  const totalOverage = values.users + values.whatsappUsers + values.messages;

  if (totalOverage <= 0) {
    return { created: false, reason: 'no_overage' as const };
  }

  const itemLabels: string[] = [];
  if (extras.users > 0) itemLabels.push(`Usuários extras (${extras.users})`);
  if (extras.whatsappUsers > 0) itemLabels.push(`Usuários WhatsApp extras (${extras.whatsappUsers})`);
  if (extras.messages > 0) itemLabels.push(`Mensagens extras (${extras.messages})`);

  const description = `Excedente 791glass ${refMonth} - ${itemLabels.join(' + ')}`;

  const baseMetadata = {
    tenant_id: tenantId,
    kind: 'overage',
    ref_month: refMonth,
    period_start: startIso,
    period_end: endIso,
    limits,
    extras,
    prices,
    values: {
      ...values,
      total: totalOverage,
    },
    due_date: dueDate.toISOString().split('T')[0],
  };

  const { data: overageRecord, error: overageInsertErr } = await holdingSupabase
    .from('system_finance_records')
    .insert({
      business_unit: 'glass',
      type: 'revenue',
      status: 'pending',
      value: totalOverage,
      description,
      payment_method: 'Asaas',
      bank_id: 'Asaas',
      category: 'SaaS Overage',
      metadata: baseMetadata,
    })
    .select('id')
    .single();

  if (overageInsertErr || !overageRecord?.id) {
    throw new Error(overageInsertErr?.message || 'Falha ao criar lançamento de excedente');
  }

  const tenantDocument = String(tenant?.cnpj || '').replace(/\D/g, '');
  const tenantEmail = String(tenant?.email || '').trim();

  const { data: financeApiData } = await holdingSupabase
    .from('system_settings')
    .select('value')
    .eq('id', 'finance_api')
    .single();

  const financeApiConfig = (financeApiData?.value || {}) as any;
  const asaasApiKey = financeApiConfig.asaasApiKey;
  const asaasEnv = financeApiConfig.asaasEnv || 'sandbox';

  if (!asaasApiKey || !tenantDocument) {
    await holdingSupabase
      .from('system_finance_records')
      .update({
        metadata: {
          ...baseMetadata,
          charge_status: 'manual_required',
          charge_reason: !asaasApiKey ? 'asaas_not_configured' : 'missing_tenant_document',
        },
      })
      .eq('id', overageRecord.id);
    return { created: true, reason: 'manual_required' as const, recordId: overageRecord.id };
  }

  const asaas = new AsaasClient({ apiKey: asaasApiKey, environment: asaasEnv });

  const effectiveEmail = tenantEmail && tenantEmail.includes('@')
    ? tenantEmail
    : `financeiro+${tenantId}@791solucoes.com.br`;

  let customer = await asaas.getCustomerByEmail(effectiveEmail);
  if (!customer) {
    customer = await asaas.createCustomer({
      name: tenant?.nome || `Cliente ${tenantId}`,
      email: effectiveEmail,
      cpfCnpj: tenantDocument,
      notificationDisabled: false,
    });
  }

  try {
    const payment = await asaas.createPayment({
      customer: customer.id,
      billingType: 'UNDEFINED',
      value: Number(totalOverage.toFixed(2)),
      dueDate: dueDate.toISOString().split('T')[0],
      description,
      externalReference: `finance_record|${overageRecord.id}`,
    });

    await holdingSupabase
      .from('system_finance_records')
      .update({
        metadata: {
          ...baseMetadata,
          charge_status: 'created',
          asaas_payment_id: payment?.id || null,
          invoice_url: payment?.invoiceUrl || null,
        },
      })
      .eq('id', overageRecord.id);
  } catch (chargeErr: any) {
    await holdingSupabase
      .from('system_finance_records')
      .update({
        metadata: {
          ...baseMetadata,
          charge_status: 'charge_error',
          charge_error: chargeErr?.message || 'Falha ao gerar cobrança no Asaas',
        },
      })
      .eq('id', overageRecord.id);
  }

  return { created: true, reason: 'created' as const, recordId: overageRecord.id };
}

async function persistInvoiceFailure({
  holdingSupabase,
  tenantId,
  valor,
  ciclo,
  asaasPaymentId,
  message,
  step,
}: {
  holdingSupabase: SupabaseClient<any, 'public', any, any, any>;
  tenantId: string;
  valor: number;
  ciclo: string;
  asaasPaymentId?: string | null;
  message: string;
  step: string;
}) {
  try {
    await holdingSupabase.from('system_invoices').insert({
      invoice_number: `HOLD-ERR-${Date.now()}`,
      status: 'rejected',
      client_name: tenantId,
      client_document: null,
      value: valor,
      access_link: null,
      error_message: message,
      metadata: {
        vidracaria_id: tenantId,
        mes_ref: new Date().toISOString().slice(0, 7),
        ciclo,
        asaas_payment_id: asaasPaymentId,
        origem: 'webhook_asaas',
        step,
      },
    });
  } catch (persistErr: any) {
    console.error('[PAYMENT PROCESSOR] Erro ao salvar falha de NF-e em system_invoices:', persistErr.message);
  }
}

/**
 * Emite NF-e para assinatura SaaS 791glass após pagamento confirmado.
 * Busca dados da vidraçaria no Glass, configurações do prestador na Holding,
 * emite via IPM e salva em system_invoices.
 */
async function emitirNFeSaas({
  holdingSupabase,
  glassSupabase,
  vidracariaId,
  valor,
  ciclo,
  asaasPaymentId,
}: {
  holdingSupabase: SupabaseClient<any, 'public', any, any, any>;
  glassSupabase: SupabaseClient<any, 'public', any, any, any>;
  vidracariaId: string;
  valor: number;
  ciclo: string;
  asaasPaymentId?: string | null;
}) {
  // Evita NF-e duplicada para o mesmo pagamento do Asaas (idempotência de webhook)
  if (asaasPaymentId) {
    const { data: existingByPaymentId } = await holdingSupabase
      .from('system_invoices')
      .select('id')
      .eq('metadata->>asaas_payment_id', asaasPaymentId)
      .maybeSingle();

    if (existingByPaymentId) {
      console.log(`[NF-e SAAS] Pagamento ${asaasPaymentId} já processado — pulando.`);
      return;
    }
  }

  const mesRef = new Date().toISOString().slice(0, 7); // "2026-06"

  // Busca dados da vidraçaria (Tomador)
  const { data: vidracaria, error: vErr } = await glassSupabase
    .from('vidracarias')
    .select('nome, cnpj, email, endereco, endereco_completo, complemento, numero, bairro, cep, cidade, estado, inscricao_municipal')
    .eq('id', vidracariaId)
    .single();

  if (vErr || !vidracaria) throw new Error('Vidraçaria não encontrada no Glass: ' + vErr?.message);

  const docTomador = vidracaria.cnpj;
  if (!docTomador) {
    throw new Error('Vidraçaria sem CNPJ/CPF para emissão de NF-e.');
  }

  const logradouroTomador = vidracaria.endereco || vidracaria.endereco_completo;
  if (!logradouroTomador) {
    throw new Error('Vidraçaria sem endereço/logradouro para emissão de NF-e.');
  }

  // Busca configurações NFS-e da Holding (Prestador)
  const { data: configData, error: cErr } = await holdingSupabase
    .from('system_settings')
    .select('value')
    .eq('id', 'nfse_config')
    .single();

  if (cErr || !configData?.value) throw new Error('Configurações NFS-e não encontradas na Holding.');
  const config = configData.value as any;

  const mesAno = new Date().toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' });
  const dpsData = {
    numero: `HOLD-${Date.now()}`,
    serie: '1',
    dataEmissao: getLocalIsoTimestamp(),
    prestador: {
      cnpj: config.prestador_cnpj,
      razaoSocial: config.razao_social,
      inscricaoMunicipal: config.inscricao_municipal,
      endereco: {
        logradouro: config.logradouro,
        numero: config.numero,
        bairro: config.bairro,
        cep: config.cep,
        cidade: config.cidade,
        uf: config.estado,
      },
    },
    tomador: {
      cnpj: docTomador,
      razaoSocial: vidracaria.nome,
      email: vidracaria.email,
      inscricaoMunicipal: vidracaria.inscricao_municipal,
      endereco: {
        logradouro: logradouroTomador,
        numero: vidracaria.numero,
        bairro: vidracaria.bairro,
        cep: vidracaria.cep,
        cidade: vidracaria.cidade,
        uf: vidracaria.estado,
      },
    },
    servico: {
      valorServicos: valor,
      codigoItemListaServico: config.tax_code || '01.01.01',
      discriminacao: `Assinatura 791glass - Ciclo ${ciclo} - Ref. ${mesAno}`,
      aliquota: 0,
    },
  };

  const result = await ipmProvider.emit(
    dpsData as any,
    config.pfxBase64,
    config.passphrase,
    {
      username: config.ipm_username,
      password: config.ipm_password,
      municipal_code: config.municipal_code,
      isTest: config.environment === 'homologacao',
    }
  );

  await holdingSupabase.from('system_invoices').insert({
    invoice_number: result.invoiceId || dpsData.numero,
    status: result.status,
    client_name: vidracaria.nome,
    client_document: docTomador,
    value: valor,
    access_link: result.accessLink,
    error_message: result.success ? null : result.message,
    metadata: {
      vidracaria_id: vidracariaId,
      mes_ref: mesRef,
      ciclo,
      asaas_payment_id: asaasPaymentId,
      xml: result.xml,
      origem: 'webhook_asaas',
    },
  });

  if (result.success) {
    console.log(`[NF-e SAAS] NF-e emitida com sucesso para ${vidracaria.nome} (${vidracariaId})`);
  } else {
    console.error(`[NF-e SAAS] Prefeitura retornou erro para ${vidracariaId}:`, result.message);
  }
}
