"use client";

import {
  WEBSITE_BILLING_CYCLES, WEBSITE_RECURRING_CYCLES, websiteRecurringPrices,
  type WebsitePlan, type WebsiteRecurringCycle,
} from '@/lib/website-plans';
import { WEBSITE_PAYMENT_METHODS, type WebsitePaymentMethod } from '@/lib/website-contracts';
import { commercialInputClass, commercialLabelClass, HoldingCommercialSelect } from '@/components/HoldingCommercialFields';

export type WebsiteSubscriptionForm = {
  plan_id: string; billing_cycle: WebsiteRecurringCycle; amount: string; first_due_date: string;
  payment_method: WebsitePaymentMethod; fiscal_confirmed: boolean;
};
export const EMPTY_WEBSITE_SUBSCRIPTION: WebsiteSubscriptionForm = {
  plan_id: '', billing_cycle: 'monthly', amount: '', first_due_date: '', payment_method: 'PIX', fiscal_confirmed: false,
};

export function WebsiteSubscriptionFields({ value, plans, onChange }: {
  value: WebsiteSubscriptionForm; plans: WebsitePlan[]; onChange: (value: WebsiteSubscriptionForm) => void;
}) {
  const selected = plans.find((plan) => plan.id === value.plan_id);
  const cycles = selected ? WEBSITE_RECURRING_CYCLES.filter((cycle) => websiteRecurringPrices(selected)[cycle]) : [];
  return <div className="space-y-5">
    <div className="grid gap-5 md:grid-cols-2">
      <label className={commercialLabelClass}><span>Produto recorrente *</span>
        <HoldingCommercialSelect required value={value.plan_id} onChange={(event) => {
          const plan = plans.find((row) => row.id === event.target.value);
          const cycle = plan?.billing_cycle === 'one_time' ? 'monthly' : plan?.billing_cycle || 'monthly';
          const price = plan ? websiteRecurringPrices(plan)[cycle] : undefined;
          onChange({ ...value, plan_id: event.target.value, billing_cycle: cycle, amount: price ? (price / 100).toFixed(2) : '', fiscal_confirmed: false });
        }}>
          <option value="">Selecione</option>{plans.map((row) => <option key={row.id} value={row.id}>{row.name}{!row.fiscal_config?.accountant_confirmed ? ' — fiscal pendente' : ''}</option>)}
        </HoldingCommercialSelect>
      </label>
      <label className={commercialLabelClass}><span>Ciclo *</span>
        <HoldingCommercialSelect required value={value.billing_cycle} onChange={(event) => {
          const cycle = event.target.value as WebsiteRecurringCycle;
          const price = selected ? websiteRecurringPrices(selected)[cycle] : undefined;
          onChange({ ...value, billing_cycle: cycle, amount: price ? (price / 100).toFixed(2) : '', fiscal_confirmed: false });
        }}>
          {!selected && <option value="monthly">Selecione o produto</option>}
          {cycles.map((cycle) => <option key={cycle} value={cycle}>{WEBSITE_BILLING_CYCLES[cycle]}</option>)}
        </HoldingCommercialSelect>
      </label>
      <label className={commercialLabelClass}><span>Valor personalizado por período (R$) *</span>
        <input className={commercialInputClass} type="number" step="0.01" min="0.01" max="9999999.99" required value={value.amount}
          onChange={(event) => onChange({ ...value, amount: event.target.value, fiscal_confirmed: false })} />
      </label>
      <label className={commercialLabelClass}><span>Primeiro vencimento da assinatura *</span>
        <input className={commercialInputClass} type="date" required value={value.first_due_date}
          onChange={(event) => onChange({ ...value, first_due_date: event.target.value })} />
      </label>
      <label className={commercialLabelClass}><span>Forma de pagamento da assinatura *</span>
        <HoldingCommercialSelect value={value.payment_method} onChange={(event) => onChange({ ...value, payment_method: event.target.value as WebsitePaymentMethod })}>
          {Object.entries(WEBSITE_PAYMENT_METHODS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </HoldingCommercialSelect>
      </label>
    </div>
    {selected && <p className="whitespace-pre-wrap text-sm text-slate-600">Escopo da assinatura: {selected.scope}</p>}
    <p className="text-xs text-slate-500">A criação é cobrada e faturada separadamente. A assinatura cobra o total do período e emite NFS-e automaticamente após pagamento em produção. Somente ME/EPP do Simples, ISS não retido e prestação no município do emitente. O emissor atual suporta 2026; pagamentos de 2027 ficam em revisão até atualização IBS/CBS.</p>
    <label className="flex items-start gap-2 text-sm text-slate-700">
      <input type="checkbox" required checked={value.fiscal_confirmed} onChange={(event) => onChange({ ...value, fiscal_confirmed: event.target.checked })} />
      Confirmo o enquadramento e percentual vigentes, as condições tributárias acima e autorizo a emissão automática após cada pagamento, pela data de confirmação e total do período.
    </label>
  </div>;
}
