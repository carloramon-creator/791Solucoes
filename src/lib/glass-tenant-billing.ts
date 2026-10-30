import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase-server';
import { AsaasClient } from '@/services/asaas-service';
import type { GlassModule, GlassPlan } from '@/lib/glass-pricing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, 'public', any, any, any>;
type Metadata = Record<string, any>;

export type TenantInvoice = {
  id: string;
  source: 'invoice' | 'record' | 'asaas';
  createdAt: string;
  dueDate: string | null;
  reference: string;
  type: 'Assinatura' | 'Excedente';
  description: string;
  status: string;
  /** pending | overdue | paid | cancelled | other */
  situation: 'pending' | 'overdue' | 'paid' | 'cancelled' | 'other';
  value: number;
  recordId?: string;
  asaasPaymentId?: string | null;
  settleable?: boolean;
  cancellable?: boolean;
  paymentUrl: string | null;
  fiscalUrl: string | null;
  reportUrl: string | null;
};

export const metadataOf = (value: unknown): Metadata =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Metadata : {};

const formatOverageReference = (value: unknown) => {
  const raw = String(value || '');
  const match = raw.match(/^(?:EXC[-\s]*)?(\d{4})[-/](\d{2})$/i);
  return match ? `EXC - ${match[2]}/${match[1]}` : raw;
};

export function todayBrt() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const PAID = new Set(['paid', 'authorized', 'received', 'confirmed', 'received_in_cash', 'dunning_received', 'emitida', 'issued']);
const CANCELLED = new Set(['cancelled', 'canceled', 'deleted', 'refunded', 'cancelada']);

function situationOf(status: string, dueDate: string | null): TenantInvoice['situation'] {
  const s = status.toLowerCase();
  if (PAID.has(s)) return 'paid';
  if (CANCELLED.has(s)) return 'cancelled';
  if (s === 'overdue') return 'overdue';
  if (s === 'pending') return dueDate && dueDate < todayBrt() ? 'overdue' : 'pending';
  return 'other';
}

export async function getAsaasClient() {
  const { data } = await supabaseServer.from('system_settings').select('value').eq('id', 'finance_api').single();
  const config = metadataOf(data?.value);
  const apiKey = String(config.asaasApiKey || '');
  if (!apiKey) return null;
  return new AsaasClient({ apiKey, environment: String(config.asaasEnv || 'sandbox') as 'sandbox' | 'production' });
}

/** A referência externa do 791glass é "glass|<tenantId>|..."; só aceita a do próprio tenant. */
export const belongsToTenant = (externalReference: unknown, tenantId: string) => {
  const parts = String(externalReference || '').split('|');
  return parts[0] === 'glass' && parts[1] === tenantId;
};

/** Clientes do Asaas do tenant (pelo CNPJ e pelo e-mail). */
export async function findTenantAsaasCustomers(asaas: AsaasClient, tenant: { cnpj?: string | null; email?: string | null }) {
  const ids = new Set<string>();
  const cnpj = String(tenant.cnpj || '').replace(/\D/g, '');
  const email = String(tenant.email || '').trim();
  const lookups = [
    cnpj ? asaas.listCustomers({ cpfCnpj: cnpj }) : Promise.resolve([]),
    email ? asaas.listCustomers({ email }) : Promise.resolve([]),
  ];
  for (const list of await Promise.all(lookups)) {
    list.filter((c) => !c.deleted).forEach((c) => ids.add(c.id));
  }
  return [...ids];
}

export async function listTenantAsaasPayments(asaas: AsaasClient, customerIds: string[], tenantId: string) {
  const lists = await Promise.all(customerIds.map((customer) => asaas.listPayments({ customer })));
  const byId = new Map<string, any>();
  lists.flat().filter((p) => !p?.deleted && belongsToTenant(p?.externalReference, tenantId)).forEach((p) => byId.set(p.id, p));
  return [...byId.values()];
}

export async function listTenantAsaasSubscriptions(asaas: AsaasClient, customerIds: string[], tenantId: string) {
  const lists = await Promise.all(customerIds.map((customer) => asaas.listSubscriptions({ customer, status: 'ACTIVE' })));
  const byId = new Map<string, any>();
  lists.flat().filter((s) => !s?.deleted && belongsToTenant(s?.externalReference, tenantId)).forEach((s) => byId.set(s.id, s));
  return [...byId.values()];
}

const asaasIdOf = (metadata: Metadata) => {
  const direct = String(metadata.asaas_payment_id || '');
  if (direct) return direct;
  const id = String(metadata.id || '');
  return id.startsWith('pay_') ? id : '';
};

/**
 * Todas as faturas do tenant: notas emitidas, lançamentos da holding e cobranças do Asaas
 * (mensalidades ainda não pagas existem só no Asaas).
 */
export async function loadTenantInvoices(tenantId: string, tenant?: { cnpj?: string | null; email?: string | null } | null) {
  const warnings: string[] = [];
  const [invoicesResult, recordsResult] = await Promise.all([
    supabaseServer.from('system_invoices').select('*').eq('metadata->>vidracaria_id', tenantId).order('created_at', { ascending: false }),
    supabaseServer.from('system_finance_records').select('id, value, description, status, category, payment_link, metadata, created_at').eq('metadata->>tenant_id', tenantId).eq('business_unit', 'glass').eq('type', 'revenue').order('created_at', { ascending: false }),
  ]);
  if (invoicesResult.error || recordsResult.error) {
    throw new Error(invoicesResult.error?.message || recordsResult.error?.message);
  }

  const invoicePaymentIds = new Set((invoicesResult.data || []).map((row: any) => String(metadataOf(row.metadata).asaas_payment_id || '')).filter(Boolean));
  const knownPaymentIds = new Set(invoicePaymentIds);

  const invoiceItems: TenantInvoice[] = (invoicesResult.data || []).map((row: any) => {
    const metadata = metadataOf(row.metadata);
    const status = String(row.status || '');
    return {
      id: row.id,
      source: 'invoice',
      createdAt: row.created_at,
      dueDate: null,
      reference: row.invoice_number,
      type: metadata.kind === 'overage' ? 'Excedente' : 'Assinatura',
      description: metadata.kind === 'overage' ? `${metadata?.consultflex?.basic || 0} Consultas básicas; ${metadata?.consultflex?.complete || 0} Consultas completas` : 'Assinatura 791glass',
      status,
      situation: situationOf(status, null) === 'cancelled' ? 'cancelled' : 'paid',
      value: Number(row.value || 0),
      paymentUrl: null,
      fiscalUrl: `/notas-fiscais/${row.id}/pdf`,
      reportUrl: metadata.finance_record_id ? `/api/admin/tenant-invoices/${metadata.finance_record_id}/consultflex-report` : null,
    };
  });

  const recordItems: TenantInvoice[] = (recordsResult.data || [])
    .filter((row: any) => {
      const paymentId = asaasIdOf(metadataOf(row.metadata));
      if (paymentId) knownPaymentIds.add(paymentId);
      return !invoicePaymentIds.has(paymentId);
    })
    .map((row: any) => {
      const metadata = metadataOf(row.metadata);
      const isOverage = metadata.kind === 'overage';
      const status = String(row.status || '');
      const dueDate = String(metadata.due_date || metadata.dueDate || '') || null;
      const situation = situationOf(status, dueDate);
      const open = situation === 'pending' || situation === 'overdue';
      return {
        id: `finance-${row.id}`,
        source: 'record',
        createdAt: row.created_at,
        dueDate,
        reference: isOverage ? formatOverageReference(metadata.ref_month || String(row.id).slice(0, 8)) : `COB-${String(row.id).slice(0, 8)}`,
        type: isOverage ? 'Excedente' : 'Assinatura',
        description: row.description || 'Cobrança 791glass',
        status,
        situation,
        value: Number(row.value || 0),
        recordId: row.id,
        asaasPaymentId: asaasIdOf(metadata) || null,
        settleable: isOverage && status === 'pending',
        cancellable: open,
        paymentUrl: status === 'cancelled' ? null : row.payment_link || metadata.invoice_url || metadata.invoiceUrl || null,
        fiscalUrl: null,
        reportUrl: isOverage ? `/api/admin/tenant-invoices/${row.id}/consultflex-report` : null,
      };
    });

  let asaasItems: TenantInvoice[] = [];
  if (tenant && (tenant.cnpj || tenant.email)) {
    try {
      const asaas = await getAsaasClient();
      if (asaas) {
        const customers = await findTenantAsaasCustomers(asaas, tenant);
        const payments = await listTenantAsaasPayments(asaas, customers, tenantId);
        asaasItems = payments
          .filter((p) => !knownPaymentIds.has(String(p.id)))
          .map((p) => {
            const status = String(p.status || '');
            const dueDate = String(p.dueDate || '') || null;
            const situation = situationOf(status, dueDate);
            return {
              id: `asaas-${p.id}`,
              source: 'asaas',
              createdAt: String(p.dateCreated || p.dueDate || ''),
              dueDate,
              reference: p.invoiceNumber ? `ASAAS-${p.invoiceNumber}` : String(p.id),
              type: 'Assinatura',
              description: p.description || 'Mensalidade 791glass',
              status,
              situation,
              value: Number(p.value || 0),
              asaasPaymentId: String(p.id),
              cancellable: situation === 'pending' || situation === 'overdue',
              paymentUrl: p.invoiceUrl || null,
              fiscalUrl: null,
              reportUrl: null,
            } satisfies TenantInvoice;
          });
      }
    } catch (err) {
      warnings.push(`Não foi possível consultar o Asaas: ${err instanceof Error ? err.message : 'erro desconhecido'}.`);
    }
  }

  const invoices = [...invoiceItems, ...recordItems, ...asaasItems]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { invoices, warnings };
}

/** Dados do tenant e do plano usados pelo painel e pela troca de módulos. */
export async function loadTenantContext(glass: AnyClient, tenantId: string) {
  const [tenantResult, modulesResult, planResult, vouchersResult] = await Promise.all([
    glass.from('vidracarias').select('id, nome, nome_fantasia, slug, email, cnpj, ativa, status_assinatura, vencimento_assinatura, ciclo_pagamento, modulos_ativos, limite_usuarios, limite_usuarios_whats, created_at, updated_at').eq('id', tenantId).maybeSingle(),
    glass.from('modules').select('id, slug, nome, parent_slug, ordem').order('ordem'),
    supabaseServer.from('system_plans').select('*').eq('sistema', '791glass').maybeSingle(),
    supabaseServer.from('vouchers').select('patrocinador_id').eq('usado_por_vidracaria_id', tenantId).limit(1),
  ]);
  if (tenantResult.error) throw new Error(tenantResult.error.message);
  if (modulesResult.error) throw new Error(modulesResult.error.message);

  let sponsorName: string | null = null;
  const sponsorId = vouchersResult.data?.[0]?.patrocinador_id;
  if (sponsorId) {
    const { data } = await supabaseServer.from('patrocinadores').select('nome').eq('id', sponsorId).maybeSingle();
    sponsorName = data?.nome || 'Patrocinador';
  }

  return {
    tenant: tenantResult.data as (Record<string, any> & { id: string; cnpj: string | null; email: string | null; modulos_ativos: string[] | null; updated_at: string | null }) | null,
    modules: (modulesResult.data || []) as GlassModule[],
    plan: (planResult.data || null) as GlassPlan | null,
    sponsorName,
  };
}
