import { supabaseServer as db } from '@/lib/supabase-server';
import type { HoldingCustomer } from '@/lib/holding-customers';
import { createWebsiteAsaas, type WebsiteAsaas, type WebsiteAsaasPayment } from '@/lib/website-asaas';
import type { WebsiteContract } from '@/lib/website-contracts';

type Customer = HoldingCustomer & {
  asaas_customer_id: string | null;
  asaas_environment: string | null;
  asaas_state: 'local' | 'processing' | 'review' | 'ready';
};
export const websiteReference = (id: string, kind: 'deposit' | 'balance', revision = 0) =>
  `website|${id}|${kind}${revision ? `|r${revision}` : ''}`;

export async function customerForAsaas(id: string, asaas: WebsiteAsaas, allowCreate: boolean) {
  const { data, error } = await db.from('holding_customers').select('*').eq('id', id).single();
  if (error) throw new Error('Não foi possível consultar o cliente da Holding.');
  const customer: Customer = data;
  if (!customer.active) throw new Error('O cliente está inativo.');
  if (customer.asaas_environment && customer.asaas_environment !== asaas.environment) throw new Error('O cliente está vinculado a outro ambiente Asaas. Revisão administrativa necessária.');
  if (customer.asaas_state === 'processing') throw new Error('O cadastro deste cliente está em processamento no Asaas. Confira o painel antes de continuar.');
  if (customer.asaas_state === 'ready' && customer.asaas_customer_id) {
    const remote = await asaas.getCustomer(customer.asaas_customer_id);
    if (remote.cpfCnpj !== customer.document) throw new Error('O documento do cliente vinculado no Asaas diverge da Holding. Revise antes de cobrar.');
    if (!remote.deleted) return remote.id;
  }

  const { data: claimed, error: claimError } = await db.from('holding_customers')
    .update({ asaas_state: 'processing', asaas_environment: asaas.environment })
    .eq('id', id).eq('asaas_state', customer.asaas_state).select('id').maybeSingle();
  if (claimError || !claimed) throw new Error('Cliente em integração por outra operação. Atualize e tente novamente.');
  try {
    let remoteId = await asaas.findCustomer(customer.document);
    if (!remoteId && (customer.asaas_state === 'review' || !allowCreate)) {
      throw new Error('Cadastro Asaas inconclusivo. Revise o cliente no painel Asaas; não foi criado outro cadastro.');
    }
    remoteId ||= await asaas.createCustomer(customer);
    const { error: saveError } = await db.from('holding_customers')
      .update({ asaas_state: 'ready', asaas_customer_id: remoteId })
      .eq('id', id).eq('asaas_state', 'processing');
    if (saveError) throw new Error('Asaas confirmou o cliente, mas o vínculo local falhou. Não repita o cadastro.');
    return remoteId;
  } catch (error) {
    const { error: reviewError } = await db.from('holding_customers').update({ asaas_state: 'review' })
      .eq('id', id).eq('asaas_state', 'processing');
    if (reviewError) console.error('[WEBSITE BILLING] Falha ao sinalizar revisão de cliente.');
    throw error;
  }
}

export function matchWebsitePayments(
  contract: WebsiteContract,
  kind: 'deposit' | 'balance',
  customer: string,
  rows: WebsiteAsaasPayment[],
) {
  const local = contract.holding_website_installments.filter((row) => row.kind === kind).sort((a, b) => a.number - b.number);
  const remote = [...rows].sort((a, b) => (a.installmentNumber || 1) - (b.installmentNumber || 1));
  if (remote.length !== local.length || new Set(remote.map((row) => row.id)).size !== remote.length) {
    throw new Error('O número de parcelas no Asaas não corresponde ao contrato. Nenhuma nova cobrança será emitida.');
  }
  if (remote.length > 1 && (!remote[0].installment
    || remote.some((row, i) => row.installment !== remote[0].installment || row.installmentNumber !== i + 1))) {
    throw new Error('Parcelamento Asaas inconsistente.');
  }
  return local.map((row, index) => {
    const payment = remote[index];
    if (payment.deleted || payment.customer !== customer || payment.externalReference !== websiteReference(contract.id, kind, contract.edit_revision)
      || payment.billingType !== contract.payment_method || Math.round(payment.value * 100) !== row.amount_cents
      || payment.dueDate !== row.due_date || (row.asaas_payment_id && row.asaas_payment_id !== payment.id)) {
      throw new Error('Valor, cliente, referência ou vencimento divergente no Asaas. Revisão necessária.');
    }
    return { local: row, remote: payment };
  });
}

export async function billWebsiteContract(id: string, generate: boolean) {
  const { data, error } = await db.from('holding_website_contracts')
    .select('*,holding_website_installments(*)').eq('id', id).single();
  if (error || !data) throw new Error('Contratação não encontrada.');
  const contract: WebsiteContract = data;
  if (contract.billing_state === 'processing') throw new Error('Emissão já em andamento. Em caso de interrupção, confira o Asaas antes de liberar o processamento.');
  if (generate && contract.billing_state !== 'local') throw new Error('Esta contratação já foi emitida ou requer revisão. Use Consultar Asaas, sem gerar novamente.');
  const asaas = await createWebsiteAsaas();
  if (contract.asaas_environment && contract.asaas_environment !== asaas.environment) throw new Error('O contrato pertence a outro ambiente Asaas.');
  if (!generate && !contract.asaas_environment) throw new Error('Esta contratação ainda não foi enviada ao Asaas.');
  const { data: lock, error: lockError } = await db.from('holding_website_contracts')
    .update({ billing_state: 'processing', asaas_environment: asaas.environment })
    .eq('id', id).eq('billing_state', contract.billing_state).select('id').maybeSingle();
  if (lockError || !lock) throw new Error('Outra operação está processando esta contratação.');
  try {
    const remoteCustomer = await customerForAsaas(contract.customer_id, asaas, generate);
    for (const kind of ['deposit', 'balance'] as const) {
      const local = contract.holding_website_installments.filter((row) => row.kind === kind).sort((a, b) => a.number - b.number);
      if (!local.length) continue;
      let remote = await asaas.findPayments(websiteReference(id, kind, contract.edit_revision));
      if (!remote.length && generate) {
        // Nunca repetir POST após resposta incerta; o contrato passa a revisão.
        await asaas.createPayments({
          customer: remoteCustomer, method: contract.payment_method, count: local.length,
          total_cents: local.reduce((sum, row) => sum + row.amount_cents, 0), due_date: local[0].due_date,
          reference: websiteReference(id, kind, contract.edit_revision),
          description: `Website: ${contract.plan_snapshot.name} - ${kind === 'deposit' ? 'entrada' : 'saldo'}`,
        });
        remote = await asaas.findPayments(websiteReference(id, kind, contract.edit_revision));
      }
      const matches = matchWebsitePayments(contract, kind, remoteCustomer, remote);
      for (const { local: row, remote: payment } of matches) {
        const { error: saveError } = await db.from('holding_website_installments').update({
          asaas_payment_id: payment.id, invoice_url: payment.invoiceUrl, status: payment.status,
        }).eq('id', row.id).eq('contract_id', id);
        if (saveError) throw new Error('Cobrança encontrada no Asaas, mas o vínculo local falhou. Use Consultar Asaas.');
      }
    }
    const { error: doneError } = await db.from('holding_website_contracts').update({ billing_state: 'issued' })
      .eq('id', id).eq('billing_state', 'processing');
    if (doneError) throw new Error('Falha ao concluir a conciliação local. Confira o Asaas.');
    return { message: 'Cobranças conciliadas com o Asaas. Nenhuma nota fiscal foi emitida.' };
  } catch (error) {
    const { error: reviewError } = await db.from('holding_website_contracts').update({ billing_state: 'review' })
      .eq('id', id).eq('billing_state', 'processing');
    if (reviewError) console.error('[WEBSITE BILLING] Falha ao sinalizar revisão do contrato.');
    throw error;
  }
}
