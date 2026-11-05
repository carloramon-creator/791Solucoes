import { supabaseServer as db } from '@/lib/supabase-server';
import { createWebsiteAsaas, type WebsiteAsaasPayment } from '@/lib/website-asaas';
import { websiteReference } from '@/lib/website-billing';
import { type WebsiteContract, validateWebsiteContract } from '@/lib/website-contracts';
import { isUuid } from '@/lib/holding-customers';

const unpaidDeleted = (payment: WebsiteAsaasPayment) => payment.deleted === true
  && !payment.confirmedDate && !payment.paymentDate && ['PENDING', 'OVERDUE', 'DELETED'].includes(payment.status);

export async function editWebsiteContract(body: unknown, authorizeScopeChange?: () => Promise<string>) {
  if (!body || typeof body !== 'object' || !('id' in body) || !isUuid(body.id)
    || !('revision' in body) || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0
    || ('subscription' in body && body.subscription != null)) throw new Error('Edição de contratação inválida.');
  const input = validateWebsiteContract(body);
  const { data, error } = await db.from('holding_website_contracts')
    .select('*,holding_website_installments(*),holding_website_invoices(id)').eq('id', body.id).single();
  if (error || !data) throw new Error('Contratação não encontrada.');
  const contract: WebsiteContract = data;
  const changedPlan = contract.plan_id !== input.plan_id;
  let scopeActor: string | null = null;
  if (changedPlan) {
    if (!authorizeScopeChange) throw new Error('Somente gestores podem trocar o produto contratado na Holding.');
    scopeActor = await authorizeScopeChange();
  }
  if (contract.customer_id !== input.customer_id) throw new Error('Não é permitido trocar o cliente de uma contratação. Crie outra contratação.');
  if (contract.billing_state === 'processing' || contract.edit_revision !== body.revision) throw new Error('Contratação alterada ou em processamento. Atualize antes de editar.');
  if (contract.holding_website_invoices?.length) throw new Error('Contratação com nota reservada ou emitida não pode ser editada.');
  const { data: lock, error: lockError } = await db.from('holding_website_contracts')
    .update({ billing_state: 'processing' }).eq('id', contract.id).eq('billing_state', contract.billing_state)
    .eq('edit_revision', body.revision).eq('updated_at', contract.updated_at).select('updated_at').single();
  if (lockError || !lock) throw new Error('Outra operação está processando a contratação.');
  try {
    const linked = contract.holding_website_installments.filter((row) => row.asaas_payment_id);
    if (contract.asaas_environment || linked.length || contract.billing_state !== 'local') {
      const asaas = await createWebsiteAsaas();
      if (contract.asaas_environment !== asaas.environment) throw new Error('Ambiente Asaas divergente ou desconhecido. Revisão administrativa necessária.');
      for (const kind of ['deposit', 'balance'] as const) {
        const payments = await asaas.findPayments(websiteReference(contract.id, kind, contract.edit_revision));
        if (payments.some((payment) => !unpaidDeleted(payment))) throw new Error('Existem cobranças ativas ou com indício de pagamento no Asaas. Revise os testes no Asaas antes de editar; nenhuma cobrança foi alterada aqui.');
      }
      for (const row of linked) {
        const payment = await asaas.getPayment(row.asaas_payment_id!);
        if (!unpaidDeleted(payment)) {
          throw new Error('Cobrança anterior não confirmada como excluída sem pagamento. Revise no Asaas antes de editar.');
        }
      }
    }
    const { data: saved, error: saveError } = await db.rpc(changedPlan ? 'holding_correct_website_contract' : 'holding_edit_website_contract', {
      ...(changedPlan ? { p_actor: scopeActor } : {}),
      p_id: contract.id, p_revision: body.revision, p_locked_at: lock.updated_at,
      p_previous_state: contract.billing_state, p_plan_id: input.plan_id, p_total_cents: input.total_cents,
      p_payment_method: input.payment_method, p_schedule: input.schedule,
    });
    if (saveError || saved !== contract.id) {
      console.error('[WEBSITE EDIT] Edição rejeitada.', { code: saveError?.code });
      throw new Error(saveError?.code === 'P0001' ? saveError.message : 'Não foi possível salvar a edição. Confira a migração e se há nota fiscal vinculada; atualize antes de tentar novamente.');
    }
    return { id: saved, message: 'Contratação editada e histórico preservado. Nenhuma cobrança foi criada. A assinatura recorrente, se houver, não foi alterada.' };
  } catch (failure) {
    const { error: restoreError } = await db.from('holding_website_contracts')
      .update({ billing_state: contract.billing_state }).eq('id', contract.id).eq('billing_state', 'processing')
      .eq('edit_revision', body.revision).eq('updated_at', lock.updated_at);
    if (restoreError) console.error('[WEBSITE EDIT] Falha ao liberar contratação; revisão administrativa necessária.');
    throw failure;
  }
}
