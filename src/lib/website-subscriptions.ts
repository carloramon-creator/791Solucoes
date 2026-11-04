import { supabaseServer as db } from '@/lib/supabase-server';
import { createWebsiteAsaas, type WebsiteAsaasPayment, type WebsiteAsaasSubscription } from '@/lib/website-asaas';
import { customerForAsaas } from '@/lib/website-billing';
import { validDate } from '@/lib/website-contracts';
import { emitWebsiteSubscriptionInvoice, validateWebsiteSubscriptionFiscal } from '@/lib/website-invoices';
import { websiteSubscriptionReference, type WebsiteSubscription } from '@/lib/website-subscription-terms';
import type { WebsiteRecurringCycle } from '@/lib/website-plans';
import { dataHoraNacional } from '@/services/nfse/data-hora';

const ASAAS_CYCLES: Record<WebsiteRecurringCycle, WebsiteAsaasSubscription['cycle']> = {
  monthly: 'MONTHLY', quarterly: 'QUARTERLY', semiannual: 'SEMIANNUALLY', annual: 'YEARLY',
};

const sourceForInvoice = (row: WebsiteSubscription) => ({
  id: row.id, total_cents: row.amount_cents, customer_snapshot: row.customer_snapshot, plan_snapshot: row.plan_snapshot,
});
const paid = (status: string) => status === 'RECEIVED' || status === 'CONFIRMED';

export function matchWebsiteSubscription(row: WebsiteSubscription, remote: WebsiteAsaasSubscription, customer: string) {
  if (remote.deleted || remote.externalReference !== websiteSubscriptionReference(row.id)
    || remote.customer !== customer || remote.billingType !== row.payment_method
    || Math.round(remote.value * 100) !== row.amount_cents
    || remote.cycle !== ASAAS_CYCLES[row.plan_snapshot.billing_cycle]
    || (row.asaas_subscription_id && row.asaas_subscription_id !== remote.id)) {
    throw new Error('Assinatura Asaas divergente em cliente, valor, periodicidade ou referência. Revise sem criar outra.');
  }
}

export function validateSubscriptionPayment(row: WebsiteSubscription, payment: WebsiteAsaasPayment) {
  if (!row.asaas_subscription_id || payment.subscription !== row.asaas_subscription_id
    || payment.customer !== row.asaas_customer_id || payment.billingType !== row.payment_method
    || Math.round(payment.value * 100) !== row.amount_cents || payment.installment
    || (payment.externalReference && payment.externalReference !== websiteSubscriptionReference(row.id))
    || !validDate(payment.dueDate) || payment.dueDate < row.first_due_date) {
    throw new Error('Cobrança não corresponde à assinatura Websites. Nenhuma nota será enviada.');
  }
  if (paid(payment.status) && !payment.deleted) {
    const date = payment.confirmedDate || payment.paymentDate;
    if (!validDate(date)) throw new Error('Pagamento sem data de confirmação válida no Asaas. Revisão fiscal necessária.');
    return date;
  }
  return null;
}

async function recordSubscriptionPayment(row: WebsiteSubscription, payment: WebsiteAsaasPayment, environment: string) {
  const paidOn = validateSubscriptionPayment(row, payment);
  const { data: id, error } = await db.rpc('holding_record_website_subscription_payment', {
    p_subscription_id: row.id, p_payment_id: payment.id, p_amount_cents: Math.round(payment.value * 100),
    p_due_date: payment.dueDate, p_paid_on: paidOn, p_status: payment.deleted ? 'DELETED' : payment.status,
    p_invoice_url: payment.invoiceUrl,
  });
  if (error || typeof id !== 'string') throw new Error('Não foi possível registrar a cobrança. Confira duplicidades e a migração.');
  const { data: existing, error: lookupError } = await db.from('holding_website_invoices')
    .select('id,status,system_invoice_id').eq('subscription_payment_id', id).maybeSingle();
  if (lookupError) throw new Error('Não foi possível consultar a operação fiscal do pagamento.');
  if (!paidOn || payment.deleted) {
    if (existing && existing.status === 'authorized' && payment.status !== 'PENDING' && payment.status !== 'OVERDUE') {
      const { error: saveError } = await db.from('holding_website_subscription_payments').update({
        fiscal_error: 'Pagamento alterado/estornado após emissão. Revise a NFS-e no histórico/portal; cancelamento não é automático.',
      }).eq('id', id);
      if (saveError) throw new Error('Falha ao registrar alerta de revisão fiscal.');
      console.warn('[WEBSITE SUBSCRIPTIONS] Pagamento com nota exige revisão fiscal.');
    }
    return;
  }
  if (environment !== 'production') return; // Sandbox nunca usa o certificado de producao.
  if (existing) {
    if (existing.status !== 'authorized' || !existing.system_invoice_id) {
      console.warn('[WEBSITE SUBSCRIPTIONS] Operação fiscal reservada/pendente; reenvio bloqueado.');
    }
    return;
  }
  try {
    // Recupera a primeira confirmacao preservada, nao a data de um webhook posterior.
    const { data: saved, error: savedError } = await db.from('holding_website_subscription_payments')
      .select('paid_on').eq('id', id).single();
    if (savedError || !saved?.paid_on) throw new Error('Data fiscal preservada não encontrada.');
    const result = await emitWebsiteSubscriptionInvoice(id, sourceForInvoice(row), saved.paid_on);
    if (!result.sent) return;
    const { error: clearError } = await db.from('holding_website_subscription_payments').update({ fiscal_error: null }).eq('id', id);
    if (clearError) throw new Error('Nota autorizada, mas o alerta fiscal não pôde ser atualizado.');
  } catch (failure) {
    const { error: alertError } = await db.from('holding_website_subscription_payments').update({
      fiscal_error: failure instanceof Error ? failure.message : 'Falha fiscal. Confira o portal antes de reenviar.',
    }).eq('id', id);
    console.error('[WEBSITE SUBSCRIPTIONS] NFS-e pendente de revisão; sem reenvio de operação reservada.');
    if (alertError) throw new Error('Falha fiscal e falha ao persistir alerta. Revisão administrativa necessária.');
  }
}

export async function billWebsiteSubscription(id: string, generate: boolean) {
  const { data, error } = await db.from('holding_website_subscriptions').select('*').eq('id', id).single();
  if (error || !data) throw new Error('Assinatura Websites não encontrada.');
  const row: WebsiteSubscription = data;
  if (row.billing_state === 'processing') throw new Error('Assinatura em processamento. Confira o Asaas antes de liberar o estado.');
  if (generate && row.billing_state !== 'local') throw new Error('Assinatura já enviada ou em revisão. Use Consultar Asaas, sem gerar outra.');
  const asaas = await createWebsiteAsaas();
  if (row.asaas_environment && row.asaas_environment !== asaas.environment) throw new Error('Assinatura vinculada a outro ambiente Asaas.');
  if (!generate && !row.asaas_environment) throw new Error('Assinatura ainda não enviada ao Asaas.');
  if (generate) {
    if (!validDate(row.first_due_date) || row.first_due_date < dataHoraNacional().slice(0, 10)) throw new Error('Primeiro vencimento passado. Cadastre uma assinatura com vencimento atual/futuro.');
    // Em sandbox a validacao tambem e local, sem assinar/enviar nota.
    await validateWebsiteSubscriptionFiscal(sourceForInvoice(row));
  }
  const { data: claimed, error: claimError } = await db.from('holding_website_subscriptions')
    .update({ billing_state: 'processing', asaas_environment: asaas.environment })
    .eq('id', id).eq('billing_state', row.billing_state).select('id').maybeSingle();
  if (claimError || !claimed) throw new Error('Outra operação está processando a assinatura.');
  try {
    const customer = row.asaas_customer_id || await customerForAsaas(row.customer_id, asaas, generate);
    let remote: WebsiteAsaasSubscription;
    if (row.asaas_subscription_id) {
      remote = await asaas.getSubscription(row.asaas_subscription_id);
    } else {
      const matches = await asaas.findSubscriptions(websiteSubscriptionReference(id));
      if (matches.length > 1) throw new Error('Mais de uma assinatura Asaas para esta referência. Revisão necessária.');
      if (!matches.length && !generate) throw new Error('Assinatura não encontrada. Confira o Asaas; nenhuma nova assinatura foi criada.');
      remote = matches[0] || await asaas.createSubscription({
        customer, method: row.payment_method, cycle: ASAAS_CYCLES[row.plan_snapshot.billing_cycle],
        amount_cents: row.amount_cents, due_date: row.first_due_date,
        reference: websiteSubscriptionReference(id), description: `Website: ${row.plan_snapshot.name}`,
      });
    }
    matchWebsiteSubscription(row, remote, customer);
    const { error: linkError } = await db.from('holding_website_subscriptions').update({
      asaas_subscription_id: remote.id, asaas_customer_id: customer, remote_status: remote.status,
    }).eq('id', id).eq('billing_state', 'processing').select('id').single();
    if (linkError) throw new Error('Assinatura criada, mas vínculo local falhou. Não gere outra.');
    const linked = { ...row, asaas_subscription_id: remote.id, asaas_customer_id: customer };
    for (const payment of await asaas.subscriptionPayments(remote.id)) {
      // Listagens podem ficar desatualizadas; sempre reconsultar a cobranca antes de emitir.
      await recordSubscriptionPayment(linked, await asaas.getPayment(payment.id), asaas.environment);
    }
    const { error: doneError } = await db.from('holding_website_subscriptions').update({ billing_state: 'issued', last_error: null })
      .eq('id', id).eq('billing_state', 'processing').select('id').single();
    if (doneError) throw new Error('Falha ao concluir a conciliação da assinatura.');
    return { message: 'Assinatura conciliada. Confira cobranças e eventuais alertas fiscais abaixo.' };
  } catch (failure) {
    const { error: reviewError } = await db.from('holding_website_subscriptions').update({
      billing_state: 'review', last_error: failure instanceof Error ? failure.message : 'Falha ao integrar assinatura.',
    })
      .eq('id', id).eq('billing_state', 'processing');
    if (reviewError) console.error('[WEBSITE SUBSCRIPTIONS] Falha ao sinalizar revisão.');
    throw failure;
  }
}

// Recebe somente uma pista do webhook: dados e pagamento sao reconsultados com a chave da Holding.
export async function processWebsiteSubscriptionPayment(hint: unknown): Promise<boolean> {
  if (!hint || typeof hint !== 'object') return false;
  const candidate = hint as Record<string, unknown>;
  if (typeof candidate.externalReference === 'string' && /^(glass|barber|finance_record)\|/.test(candidate.externalReference)) return false;
  const tagged = typeof candidate.externalReference === 'string' && candidate.externalReference.startsWith('website-subscription|');
  if (!tagged && !(typeof candidate.subscription === 'string' && /^sub_[A-Za-z0-9]+$/.test(candidate.subscription))) return false;
  if (typeof candidate.id !== 'string') throw new Error('Notificação de assinatura sem pagamento válido.');
  const asaas = await createWebsiteAsaas();
  const payment = await asaas.getPayment(candidate.id);
  if (/^(glass|barber|finance_record)\|/.test(payment.externalReference)) return false;
  if (!payment.subscription) {
    if (payment.externalReference.startsWith('website-subscription|')) throw new Error('Cobrança Websites sem assinatura Asaas.');
    return false;
  }
  const remoteReference = await asaas.subscriptionReference(payment.subscription);
  if (/^(glass|barber|finance_record)\|/.test(remoteReference)) return false;
  const { data, error } = await db.from('holding_website_subscriptions').select('*')
    .eq('asaas_subscription_id', payment.subscription).maybeSingle();
  if (error) throw new Error('Falha ao localizar assinatura Websites.');
  if (!data) {
    if (payment.externalReference.startsWith('website-subscription|') || remoteReference.startsWith('website-subscription|')) {
      throw new Error('Assinatura Websites ainda sem vínculo local. Consultar Asaas para recuperar; reenvio de webhook permitido.');
    }
    return false;
  }
  const row: WebsiteSubscription = data;
  try {
    if (row.asaas_environment !== asaas.environment) throw new Error('Ambiente do pagamento diverge da assinatura.');
    matchWebsiteSubscription(row, await asaas.getSubscription(payment.subscription), row.asaas_customer_id || '');
    await recordSubscriptionPayment(row, payment, asaas.environment);
  } catch (failure) {
    const { error: alertError } = await db.from('holding_website_subscriptions').update({
      last_error: failure instanceof Error ? failure.message : 'Falha ao processar pagamento recorrente.',
    }).eq('id', row.id);
    console.error('[WEBSITE SUBSCRIPTIONS] Pagamento bloqueado; revisão necessária.');
    if (alertError) throw new Error('Falha ao processar pagamento e persistir alerta de revisão.');
    throw failure;
  }
  return true;
}
