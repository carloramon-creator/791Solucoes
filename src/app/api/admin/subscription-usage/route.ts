import { NextResponse } from 'next/server';
import { getGlassClient } from '@/lib/glass-client';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { glassAccessChargesForMonth } from '@/lib/glass-access-charges';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type StatusTone = 'ok' | 'warning' | 'exceeded';

type ConsultflexExecutionStatus = 'success' | 'failed' | 'unknown';
type AutentiqueSignatureUsageRow = {
  id: string;
  vidracaria_id: string;
  status: string;
  created_at: string;
};
type AutentiqueSignatureEventRow = {
  assinatura_id: string;
  tipo: string;
  signatario: string | null;
  detalhes: unknown;
};

function getStatusTone(current: number, limit: number): StatusTone {
  if (!limit || limit <= 0) return 'ok';
  const ratio = current / limit;
  if (ratio >= 1) return 'exceeded';
  if (ratio >= 0.8) return 'warning';
  return 'ok';
}

function toNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isMissingSchemaObjectError(error: unknown) {
  const candidate = error as { message?: string; details?: string };
  const msg = normalizeText(candidate?.message || candidate?.details || '');
  return (
    msg.includes('does not exist')
    || msg.includes('could not find the table')
    || msg.includes('schema cache')
  );
}

function normalizeText(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function toFiniteNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toOptionalNonNegative(value: unknown, integer = false) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || (integer && !Number.isSafeInteger(num))) return null;
  return num;
}

function getBrtMonthKey(value: unknown) {
  const timestamp = value ? new Date(String(value)).getTime() : Number.NaN;
  if (!Number.isFinite(timestamp)) return '';
  const brt = new Date(timestamp - 3 * 60 * 60 * 1000);
  return `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, '0')}`;
}

function splitInChunks<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function getConsultflexAttemptKey(row: Record<string, any>) {
  const explicitKey = firstNonEmptyString(
    row.consulta_id,
    row.consult_id,
    row.request_id,
    row.requisicao_id,
    row.protocolo,
    row.protocolo_consulta,
    row.transaction_id,
    row.external_reference,
    row.reference,
    row.id_consulta,
  );

  if (explicitKey) return explicitKey;

  const createdAt = String(row.created_at || '');
  const createdAtSec = createdAt ? createdAt.slice(0, 19) : '';
  const product = firstNonEmptyString(row.produto, row.produto_consulta, row.tipo_consulta, row.consulta_tipo, row.tipo);
  const document = firstNonEmptyString(row.cpf, row.cnpj, row.documento, row.document);
  const budget = firstNonEmptyString(row.orcamento_id);
  return `${createdAtSec}|${product}|${document}|${budget}`;
}

function isConsultflexHistoryRow(_row: Record<string, any>) {
  return false;
}

function classifyConsultflexExecutionStatus(row: Record<string, any>): ConsultflexExecutionStatus {
  const status = normalizeText(row.status_consulta);
  if (!status) return 'unknown';
  if (status.includes('erro')) return 'failed';
  if (status.includes('atencao') || status.includes('atenção') || status.includes('sucesso') || status.includes('ok')) return 'success';
  return 'unknown';
}

function classifyConsultflexType(row: Record<string, any>): 'basic' | 'complete' | 'unknown' {
  const type = normalizeText(row.tipo_consulta);
  if (!type) return 'unknown';
  if (type.includes('basico') || type.includes('básico') || type.includes('basic')) return 'basic';
  if (type.includes('completo') || type.includes('complete') || type.includes('full')) return 'complete';
  return 'unknown';
}

function getPeriodStart(period: string) {
  const now = new Date();
  const startDate = new Date(now);

  switch (period) {
    case 'dia':
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'semana':
      startDate.setDate(now.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'quinzena':
      startDate.setDate(now.getDate() - 14);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'mes':
      startDate.setDate(now.getDate() - 29);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'trimestre':
      startDate.setDate(now.getDate() - 89);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'semestre':
      startDate.setDate(now.getDate() - 179);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'ano':
      startDate.setDate(now.getDate() - 364);
      startDate.setHours(0, 0, 0, 0);
      break;
    default:
      startDate.setDate(now.getDate() - 29);
      startDate.setHours(0, 0, 0, 0);
      break;
  }

  return startDate;
}

function getDateFromParam(value: string | null, fallback: Date) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const url = new URL(req.url);
    const period = url.searchParams.get('period') || 'mes';
    const startDateParam = url.searchParams.get('startDate');
    const endDateParam = url.searchParams.get('endDate');
    const glass = await getGlassClient();
    const now = new Date();
    const periodStart = getDateFromParam(startDateParam, getPeriodStart(period));
    const periodEnd = getDateFromParam(endDateParam, now);
    const rangeStart = periodStart <= periodEnd ? periodStart : periodEnd;
    const rangeEnd = periodStart <= periodEnd ? periodEnd : periodStart;
    const messagesPeriodStart = rangeStart.toISOString();

    const [
      { data: tenants, error: tenantsError },
      { data: userProfiles, error: profilesError },
      { data: sectors, error: sectorsError },
      { data: accessUsers, error: accessUsersError },
      { data: messages, error: messagesError },
      { data: budgets, error: budgetsError },
      { data: clients, error: clientsError },
      { data: projects, error: projectsError },
      { data: sacadas, error: sacadasError },
      { data: workOrders, error: workOrdersError },
      { data: auditedDeletes, error: auditedDeletesError },
      { data: planConfig, error: planConfigError },
      { data: miniPlanConfig, error: miniPlanConfigError },
      { data: invoices, error: invoicesError },
      { data: whatsappUso, error: whatsappUsoError },
      { data: accessOrders, error: accessOrdersError },
    ] = await Promise.all([
      glass
        .from('vidracarias')
        .select('*')
        .order('nome'),
      glass
        .from('user_profiles')
        .select('vidracaria_id, user_id, ativo, created_at'),
      glass
        .from('whatsapp_sectors')
        .select('id, vidracaria_id'),
      glass
        .from('glass_whatsapp_access_users')
        .select('vidracaria_id, user_id'),
      glass
        .from('whatsapp_messages')
        .select('vidracaria_id, sender_type, created_at')
        .gte('created_at', messagesPeriodStart)
        .lte('created_at', rangeEnd.toISOString())
        .eq('sender_type', 'contact'),
      glass
        .from('orcamentos')
        .select('vidracaria_id, status, valor_total, created_at')
        .gte('created_at', messagesPeriodStart)
        .lte('created_at', rangeEnd.toISOString()),
      glass
        .from('pessoas')
        .select('vidracaria_id, created_at')
        .eq('is_cliente', true)
        .gte('created_at', messagesPeriodStart)
        .lte('created_at', rangeEnd.toISOString()),
      glass
        .from('projetos')
        .select('vidracaria_id, created_at')
        .gte('created_at', messagesPeriodStart)
        .lte('created_at', rangeEnd.toISOString()),
      glass
        .from('sacadas')
        .select('vidracaria_id, created_at')
        .gte('created_at', messagesPeriodStart)
        .lte('created_at', rangeEnd.toISOString()),
      glass
        .from('ordens_servico')
        .select('vidracaria_id, created_at')
        .gte('created_at', messagesPeriodStart)
        .lte('created_at', rangeEnd.toISOString()),
      glass
        .from('audit_logs')
        .select('vidracaria_id, tabela, created_at')
        .eq('operacao', 'DELETE')
        .gte('created_at', messagesPeriodStart)
        .lte('created_at', rangeEnd.toISOString()),
      supabaseServer
        .from('system_plans')
        .select('system_limits')
        .eq('sistema', '791glass')
        .single(),
      supabaseServer
        .from('system_plans')
        .select('system_limits')
        .eq('sistema', '791glass-mini')
        .maybeSingle(),
      supabaseServer
        .from('system_invoices')
        .select('value, status, created_at, metadata')
        .gte('created_at', messagesPeriodStart)
        .lte('created_at', rangeEnd.toISOString())
        .in('status', ['pago', 'authorized']),
      // Enviadas vêm do ledger do glass, já separadas em SAC e Marketing.
      glass.rpc('whatsapp_uso_mensal', {
        p_vidracaria: null,
        p_inicio: messagesPeriodStart,
        p_fim: rangeEnd.toISOString(),
      }),
      glass.from('glass_access_orders')
        .select('id,vidracaria_id,kind,quantity,unit_cents,cycle,status,billing_from,billing_until')
        .eq('status', 'confirmed').in('cycle', ['semiannual', 'annual']),
    ]);

    const firstError =
      tenantsError ||
      profilesError ||
      sectorsError ||
      accessUsersError ||
      messagesError ||
      budgetsError ||
      clientsError ||
      projectsError ||
      sacadasError ||
      workOrdersError ||
      auditedDeletesError ||
      planConfigError ||
      miniPlanConfigError ||
      invoicesError ||
      whatsappUsoError ||
      accessOrdersError;

    if (firstError) {
      return NextResponse.json({ error: firstError.message }, { status: 500 });
    }

    const autentiqueDocuments: AutentiqueSignatureUsageRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: signaturePage, error: signaturePageError } = await glass
        .from('orcamento_assinaturas_autentique')
        .select('id,vidracaria_id,status,created_at')
        .not('autentique_document_id', 'is', null)
        .gte('created_at', messagesPeriodStart)
        .lte('created_at', rangeEnd.toISOString())
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + 999);
      if (signaturePageError) return NextResponse.json({ error: signaturePageError.message }, { status: 500 });
      autentiqueDocuments.push(...(signaturePage || []));
      if ((signaturePage || []).length < 1000) break;
    }

    const signatureTenantById = new Map<string, string>();
    autentiqueDocuments.forEach((row) => {
      if (row?.id && row?.vidracaria_id) signatureTenantById.set(String(row.id), String(row.vidracaria_id));
    });
    const assinaturaIds = Array.from(signatureTenantById.keys());
    const signatureEvents: AutentiqueSignatureEventRow[] = [];
    for (const ids of splitInChunks(assinaturaIds, 500)) {
      for (let offset = 0; ids.length > 0; offset += 1000) {
        const { data: events, error: eventsError } = await glass
          .from('orcamento_assinaturas_autentique_eventos')
          .select('assinatura_id,tipo,signatario,detalhes')
          .in('assinatura_id', ids)
          .order('recebido_em', { ascending: true })
          .order('autentique_event_id', { ascending: true })
          .range(offset, offset + 999);
        if (eventsError) return NextResponse.json({ error: eventsError.message }, { status: 500 });
        signatureEvents.push(...((events || []) as AutentiqueSignatureEventRow[]));
        if ((events || []).length < 1000) break;
      }
    }

    const rangeStartTime = rangeStart.getTime();
    const rangeEndTime = rangeEnd.getTime();

    const isWithinRange = (value: unknown) => {
      const time = value ? new Date(String(value)).getTime() : Number.NaN;
      return Number.isFinite(time) && time >= rangeStartTime && time <= rangeEndTime;
    };

    // Calcular faturamento real das notas pagas
    let faturamentoMesAtual = 0;
    (invoices || []).forEach((invoice: any) => {
      faturamentoMesAtual += toNumber(invoice?.value, 0);
    });

    // Calcular faturamento acumulado total (todas as notas com status pago)
    const { data: allPaidInvoices, error: allInvoicesError } = await supabaseServer
      .from('system_invoices')
      .select('value')
      .in('status', ['pago', 'authorized']);

    let faturamentoAcumulado = 0;
    if (!allInvoicesError) {
      (allPaidInvoices || []).forEach((invoice: any) => {
        faturamentoAcumulado += toNumber(invoice?.value, 0);
      });
    }

    const usersByTenant = new Map<string, Set<string>>();
    const activeUsersByTenant = new Map<string, Set<string>>();
    (userProfiles || []).forEach((profile: any) => {
      const tenantId = String(profile?.vidracaria_id || '');
      const userId = String(profile?.user_id || '');
      if (!tenantId || !userId) return;

      if (!usersByTenant.has(tenantId)) usersByTenant.set(tenantId, new Set());
      usersByTenant.get(tenantId)?.add(userId);

      if (profile?.ativo) {
        if (!activeUsersByTenant.has(tenantId)) activeUsersByTenant.set(tenantId, new Set());
        activeUsersByTenant.get(tenantId)?.add(userId);
      }
    });

    const sectorsByTenant = new Map<string, number>();
    (sectors || []).forEach((sector: any) => {
      const tenantId = String(sector?.vidracaria_id || '');
      if (!tenantId) return;
      sectorsByTenant.set(tenantId, (sectorsByTenant.get(tenantId) || 0) + 1);
    });

    const whatsappUsersByTenant = new Map<string, Set<string>>();
    (accessUsers || []).forEach((row: any) => {
      const tenantId = String(row?.vidracaria_id || '');
      const userId = String(row?.user_id || '');
      if (!tenantId || !userId) return;

      if (!whatsappUsersByTenant.has(tenantId)) whatsappUsersByTenant.set(tenantId, new Set());
      whatsappUsersByTenant.get(tenantId)?.add(userId);
    });

    let lojasAtivasPeriodo = 0;
    (tenants || []).forEach((tenant: any) => {
      if (!isWithinRange(tenant?.created_at)) return;
      if (tenant?.ativa === false) return;
      lojasAtivasPeriodo += 1;
    });

    let usuariosCadastradosPeriodo = 0;
    let usuariosWhatsappPeriodo = 0;
    (userProfiles || []).forEach((profile: any) => {
      if (!isWithinRange(profile?.created_at)) return;

      usuariosCadastradosPeriodo += 1;

      const tenantId = String(profile?.vidracaria_id || '');
      const userId = String(profile?.user_id || '');
      if (!tenantId || !userId) return;

      if (whatsappUsersByTenant.get(tenantId)?.has(userId)) {
        usuariosWhatsappPeriodo += 1;
      }
    });

    const messagesByTenant = new Map<string, number>();
    const marketingMessagesByTenant = new Map<string, number>();
    ((whatsappUso || []) as Array<{ vidracaria_id?: string; sac?: number; marketing?: number }>).forEach((row) => {
      const tenantId = String(row?.vidracaria_id || '');
      if (!tenantId) return;
      messagesByTenant.set(tenantId, Number(row?.sac || 0));
      marketingMessagesByTenant.set(tenantId, Number(row?.marketing || 0));
    });

    const whatsappReceivedByTenant = new Map<string, number>();
    (messages || []).forEach((msg: any) => {
      const tenantId = String(msg?.vidracaria_id || '');
      if (!tenantId) return;
      whatsappReceivedByTenant.set(tenantId, (whatsappReceivedByTenant.get(tenantId) || 0) + 1);
    });

    const autentiqueByTenant = new Map<string, {
      documents: number;
      pending: number;
      signed: number;
      rejected: number;
      byMonth: Map<string, number>;
      delivered: Set<string>;
      viewed: Set<string>;
      accepted: Set<string>;
      deliveryFailed: Set<string>;
    }>();
    (autentiqueDocuments || []).forEach((row: any) => {
      const tenantId = String(row?.vidracaria_id || '');
      const month = getBrtMonthKey(row?.created_at);
      if (!tenantId || !month) return;
      if (!autentiqueByTenant.has(tenantId)) {
        autentiqueByTenant.set(tenantId, {
          documents: 0,
          pending: 0,
          signed: 0,
          rejected: 0,
          byMonth: new Map(),
          delivered: new Set(),
          viewed: new Set(),
          accepted: new Set(),
          deliveryFailed: new Set(),
        });
      }
      const usage = autentiqueByTenant.get(tenantId)!;
      usage.documents += 1;
      usage.byMonth.set(month, (usage.byMonth.get(month) || 0) + 1);
      if (['criando', 'aguardando_assinaturas'].includes(String(row?.status || ''))) usage.pending += 1;
      if (row?.status === 'assinado') usage.signed += 1;
      if (row?.status === 'recusado') usage.rejected += 1;
    });
    signatureEvents.forEach((event) => {
      const signatureId = String(event?.assinatura_id || '');
      const tenantId = signatureTenantById.get(signatureId);
      const role = event?.signatario;
      if (!tenantId || (role !== 'cliente' && role !== 'vendedor')) return;
      const usage = autentiqueByTenant.get(tenantId);
      if (!usage) return;
      const signerKey = `${signatureId}:${role}`;
      const details = event.detalhes && typeof event.detalhes === 'object'
        ? event.detalhes as Record<string, unknown>
        : {};
      const viewed = event.tipo === 'signature.viewed' || event.tipo === 'signature.accepted';
      const accepted = event.tipo === 'signature.accepted';
      if (typeof details.emailEntregueEm === 'string' || viewed || accepted) usage.delivered.add(signerKey);
      if (viewed) usage.viewed.add(signerKey);
      if (accepted) usage.accepted.add(signerKey);
      if (event.tipo === 'signature.delivery_failed') usage.deliveryFailed.add(signerKey);
    });

    const activityByTenant = new Map<string, {
      budgetsCreated: number;
      budgetsApproved: number;
      budgetsApprovedValue: number;
      clientsCreated: number;
      projectsCreated: number;
      sacadasCreated: number;
      workOrdersCreated: number;
      auditedDeletes: number;
    }>();
    const getActivity = (tenantId: string) => {
      if (!activityByTenant.has(tenantId)) {
        activityByTenant.set(tenantId, {
          budgetsCreated: 0,
          budgetsApproved: 0,
          budgetsApprovedValue: 0,
          clientsCreated: 0,
          projectsCreated: 0,
          sacadasCreated: 0,
          workOrdersCreated: 0,
          auditedDeletes: 0,
        });
      }
      return activityByTenant.get(tenantId)!;
    };

    (budgets || []).forEach((row: any) => {
      const tenantId = String(row?.vidracaria_id || '');
      if (!tenantId) return;
      const activity = getActivity(tenantId);
      activity.budgetsCreated += 1;
      if (['aprovado', 'pre_aprovado'].includes(normalizeText(row?.status))) {
        activity.budgetsApproved += 1;
        activity.budgetsApprovedValue += toNumber(row?.valor_total, 0);
      }
    });
    (clients || []).forEach((row: any) => {
      const tenantId = String(row?.vidracaria_id || '');
      if (tenantId) getActivity(tenantId).clientsCreated += 1;
    });
    (projects || []).forEach((row: any) => {
      const tenantId = String(row?.vidracaria_id || '');
      if (tenantId) getActivity(tenantId).projectsCreated += 1;
    });
    (sacadas || []).forEach((row: any) => {
      const tenantId = String(row?.vidracaria_id || '');
      if (tenantId) getActivity(tenantId).sacadasCreated += 1;
    });
    (workOrders || []).forEach((row: any) => {
      const tenantId = String(row?.vidracaria_id || '');
      if (tenantId) getActivity(tenantId).workOrdersCreated += 1;
    });
    (auditedDeletes || []).forEach((row: any) => {
      const tenantId = String(row?.vidracaria_id || '');
      if (tenantId) getActivity(tenantId).auditedDeletes += 1;
    });

    const consultflexByTenant = new Map<string, {
      basicSuccess: number;
      completeSuccess: number;
      failed: number;
      unknown: number;
    }>();

    // Fonte oficial: tabela de consultas de credito.
    const { data: consultRowsByPeriod, error: consultRowsError } = await glass
      .from('orcamento_credito_consultas')
      .select('*')
      .gte('created_at', messagesPeriodStart)
      .lte('created_at', rangeEnd.toISOString());

    if (consultRowsError && !isMissingSchemaObjectError(consultRowsError)) {
      return NextResponse.json({ error: consultRowsError.message }, { status: 500 });
    }

    const safeConsultRows = consultRowsError && isMissingSchemaObjectError(consultRowsError)
      ? []
      : (consultRowsByPeriod || []);

    const sourceRows: any[] = safeConsultRows;

    // Vinculo primario por orcamento_id para evitar atribuicao incorreta por colunas genericas.
    const linkedOrcamentoIds = Array.from(new Set(
      sourceRows
        .map((row: any) => String(row?.orcamento_id || ''))
        .filter(Boolean)
    ));

    const orcamentoTenantMap = new Map<string, string>();
    const missingTenantChunks = splitInChunks(linkedOrcamentoIds, 500);
    for (const ids of missingTenantChunks) {
      const { data: linkedOrcamentos, error: linkedOrcamentosError } = await glass
        .from('orcamentos')
        .select('id, vidracaria_id')
        .in('id', ids);

      if (linkedOrcamentosError) {
        if (isMissingSchemaObjectError(linkedOrcamentosError)) {
          continue;
        }
        return NextResponse.json({ error: linkedOrcamentosError.message }, { status: 500 });
      }

      (linkedOrcamentos || []).forEach((row: any) => {
        const orcamentoId = String(row?.id || '');
        const tenantId = String(row?.vidracaria_id || '');
        if (!orcamentoId || !tenantId) return;
        orcamentoTenantMap.set(orcamentoId, tenantId);
      });
    }

    const groupedByAttempt = new Map<string, any[]>();

    sourceRows.forEach((row: any) => {
      const key = getConsultflexAttemptKey(row as Record<string, any>);
      if (!groupedByAttempt.has(key)) groupedByAttempt.set(key, []);
      groupedByAttempt.get(key)?.push(row);
    });

    groupedByAttempt.forEach((rows) => {
      const canonicalRow = rows[0] as Record<string, any>;
      const linkedTenantId = orcamentoTenantMap.get(String(canonicalRow?.orcamento_id || ''));
      const tenantId = String(
        linkedTenantId
        || canonicalRow?.vidracaria_id
        || canonicalRow?.tenant_id
        || ''
      );
      if (!tenantId) return;

      // Consolidacao: se qualquer linha da tentativa sinalizar erro, a tentativa inteira e erro.
      let execution: ConsultflexExecutionStatus = 'unknown';
      for (const item of rows) {
        const status = classifyConsultflexExecutionStatus(item as Record<string, any>);
        if (status === 'failed') {
          execution = 'failed';
          break;
        }
        if (status === 'success') execution = 'success';
      }

      let consultType: 'basic' | 'complete' | 'unknown' = 'unknown';
      for (const item of rows) {
        const type = classifyConsultflexType(item as Record<string, any>);
        if (type !== 'unknown') {
          consultType = type;
          break;
        }
      }

      if (!consultflexByTenant.has(tenantId)) {
        consultflexByTenant.set(tenantId, {
          basicSuccess: 0,
          completeSuccess: 0,
          failed: 0,
          unknown: 0,
        });
      }

      const bucket = consultflexByTenant.get(tenantId)!;

      if (execution === 'failed') {
        bucket.failed += 1;
        return;
      }

      if (consultType === 'basic') bucket.basicSuccess += 1;
      else if (consultType === 'complete') bucket.completeSuccess += 1;
      else bucket.unknown += 1;
    });

    const systemLimits = (planConfig as any)?.system_limits || {};
    const miniSystemLimits = (miniPlanConfig as any)?.system_limits || {};
    const defaultUsersLimit = toNumber(systemLimits.usersIncluded, 10);
    const defaultWhatsappUsersLimit = toNumber(systemLimits.wppDevices, 1);
    const defaultMessagesLimit = toNumber(systemLimits.wppMessages, 1000);
    const extraUserPrice = toNumber(systemLimits.extraUserPrice, 0);
    const extraDevicePrice = toNumber(systemLimits.extraDevicePrice, 0);
    const extraMessagePrice = toNumber(systemLimits.extraMessagePrice, toNumber(systemLimits.wppMessagesPrice, 0));
    const defaultMarketingLimit = toNumber(systemLimits.mktMessages, 0);
    const extraMktMessagePrice = toNumber(systemLimits.extraMktMessagePrice, 0);
    const consultflexBasicPrice = toNumber(systemLimits.consultflexBasicPrice, toNumber(systemLimits.consultBasicPrice, 0));
    const consultflexCompletePrice = toNumber(systemLimits.consultflexCompletePrice, toNumber(systemLimits.consultCompletePrice, 0));

    const tenantRows = (tenants || []).map((tenant: any) => {
      const tenantId = String(tenant.id);

      const registeredUsers = usersByTenant.get(tenantId)?.size || 0;
      const activeUsers = activeUsersByTenant.get(tenantId)?.size || 0;
      const whatsappUsers = whatsappUsersByTenant.get(tenantId)?.size || 0;
      const sectorsCount = sectorsByTenant.get(tenantId) || 0;
      const messagesSent = messagesByTenant.get(tenantId) || 0;
      const marketingMessagesSent = marketingMessagesByTenant.get(tenantId) || 0;
      const whatsappReceived = whatsappReceivedByTenant.get(tenantId) || 0;
      const activity = activityByTenant.get(tenantId) || {
        budgetsCreated: 0,
        budgetsApproved: 0,
        budgetsApprovedValue: 0,
        clientsCreated: 0,
        projectsCreated: 0,
        sacadasCreated: 0,
        workOrdersCreated: 0,
        auditedDeletes: 0,
      };
      const consultflexUsage = consultflexByTenant.get(tenantId) || {
        basicSuccess: 0,
        completeSuccess: 0,
        failed: 0,
        unknown: 0,
      };
      const autentiqueUsage = autentiqueByTenant.get(tenantId) || {
        documents: 0,
        pending: 0,
        signed: 0,
        rejected: 0,
        byMonth: new Map<string, number>(),
        delivered: new Set<string>(),
        viewed: new Set<string>(),
        accepted: new Set<string>(),
        deliveryFailed: new Set<string>(),
      };
      const tenantPlanLimits = tenant.plano_codigo === 'mini' ? miniSystemLimits : systemLimits;
      const autentiqueFranquia = toOptionalNonNegative(tenantPlanLimits.autentiqueDocsIncluded, true);
      const autentiquePreco = toOptionalNonNegative(tenantPlanLimits.autentiqueExtraDocPrice);
      const extraAutentiqueDocuments = autentiqueFranquia === null
        ? null
        : Array.from(autentiqueUsage.byMonth.values()).reduce(
          (sum, count) => sum + Math.max(0, count - autentiqueFranquia),
          0,
        );
      const autentiqueOverage = extraAutentiqueDocuments === null || autentiquePreco === null
        ? null
        : Math.round(extraAutentiqueDocuments * autentiquePreco * 100) / 100;

      const usersLimit = tenant.limite_usuarios == null
        ? defaultUsersLimit
        : toNumber(tenant.limite_usuarios, defaultUsersLimit);
      const whatsappUsersLimit = tenant.limite_usuarios_whats == null
        ? defaultWhatsappUsersLimit
        : toNumber(tenant.limite_usuarios_whats, defaultWhatsappUsersLimit);
      const messagesLimit = tenant.limite_mensagens_whatsapp == null
        ? defaultMessagesLimit
        : toNumber(tenant.limite_mensagens_whatsapp, defaultMessagesLimit);
      const marketingMessagesLimit = tenant.limite_mensagens_marketing == null
        ? defaultMarketingLimit
        : toNumber(tenant.limite_mensagens_marketing, defaultMarketingLimit);
      const tenantMessagePrice = tenant.valor_msg_whatsapp_excedente == null
        ? extraMessagePrice
        : toNumber(tenant.valor_msg_whatsapp_excedente, extraMessagePrice);
      const tenantMktMessagePrice = tenant.valor_msg_marketing_excedente == null
        ? extraMktMessagePrice
        : toNumber(tenant.valor_msg_marketing_excedente, extraMktMessagePrice);

      // O limite controla acessos simultaneos, nao cadastros faturaveis.
      const extraUsers = 0;
      const extraWhatsappUsers = 0;
      const extraMessages = Math.max(0, messagesSent - messagesLimit);
      const extraMarketingMessages = Math.max(0, marketingMessagesSent - marketingMessagesLimit);

      const usersOverage = 0;
      const whatsappUsersOverage = 0;
      const messagesOverage = extraMessages * tenantMessagePrice;
      const marketingMessagesOverage = extraMarketingMessages * tenantMktMessagePrice;
      const consultflexBasicOverage = consultflexUsage.basicSuccess * consultflexBasicPrice;
      const consultflexCompleteOverage = consultflexUsage.completeSuccess * consultflexCompletePrice;
      const consultflexOverage = consultflexBasicOverage + consultflexCompleteOverage;
      const accessCharges = glassAccessChargesForMonth((accessOrders || []).filter((order) => order.vidracaria_id === tenantId), rangeEnd.toISOString().slice(0, 7));
      const overageTotal = messagesOverage + marketingMessagesOverage + consultflexOverage + accessCharges.total + (autentiqueOverage || 0);

      return {
        ...tenant,
        vidracariaId: tenantId,
        usage: {
          registeredUsers,
          activeUsers,
          whatsappUsers,
          sectors: sectorsCount,
          messagesSent,
          marketingMessagesSent,
          whatsappReceived,
          consultflexBasicSuccess: consultflexUsage.basicSuccess,
          consultflexCompleteSuccess: consultflexUsage.completeSuccess,
          consultflexSuccessTotal: consultflexUsage.basicSuccess + consultflexUsage.completeSuccess,
          consultflexFailed: consultflexUsage.failed,
          consultflexUnknown: consultflexUsage.unknown,
          autentiqueDocuments: autentiqueUsage.documents,
          autentiquePending: autentiqueUsage.pending,
          autentiqueSigned: autentiqueUsage.signed,
          autentiqueRejected: autentiqueUsage.rejected,
          autentiqueDelivered: autentiqueUsage.delivered.size,
          autentiqueViewed: autentiqueUsage.viewed.size,
          autentiqueAccepted: autentiqueUsage.accepted.size,
          autentiqueDeliveryFailed: autentiqueUsage.deliveryFailed.size,
          consultflexCountedRows:
            consultflexUsage.basicSuccess
            + consultflexUsage.completeSuccess
            + consultflexUsage.failed
            + consultflexUsage.unknown,
        },
          activity,
        limits: {
          users: usersLimit,
          whatsappUsers: whatsappUsersLimit,
          messages: messagesLimit,
          marketingMessages: marketingMessagesLimit,
          autentiqueDocuments: autentiqueFranquia,
        },
        status: {
          users: 'ok' as StatusTone,
          whatsappUsers: getStatusTone(whatsappUsers, whatsappUsersLimit),
          messages: getStatusTone(messagesSent, messagesLimit),
          marketingMessages: getStatusTone(marketingMessagesSent, marketingMessagesLimit),
          autentiqueDocuments: autentiqueFranquia === null ? 'ok' as StatusTone : getStatusTone(autentiqueUsage.documents, autentiqueFranquia),
        },
        overage: {
          extraUsers,
          extraWhatsappUsers,
          extraMessages,
          extraMarketingMessages,
          extraAutentiqueDocuments,
          consultflexBasicSuccess: consultflexUsage.basicSuccess,
          consultflexCompleteSuccess: consultflexUsage.completeSuccess,
          prices: {
            extraUserPrice,
            extraDevicePrice,
            extraMessagePrice: tenantMessagePrice,
            extraMktMessagePrice: tenantMktMessagePrice,
            consultflexBasicPrice,
            consultflexCompletePrice,
          },
          values: {
            users: usersOverage,
            whatsappUsers: whatsappUsersOverage,
            messages: messagesOverage,
            marketingMessages: marketingMessagesOverage,
            consultflexBasic: consultflexBasicOverage,
            consultflexComplete: consultflexCompleteOverage,
            consultflexTotal: consultflexOverage,
            accessAddons: accessCharges.total,
            autentique: autentiqueOverage,
            total: overageTotal,
          },
        },
      };
    });

    const totals = tenantRows.reduce(
      (acc, tenant) => {
        acc.tenants += 1;
        acc.registeredUsers += tenant.usage.registeredUsers;
        acc.activeUsers += tenant.usage.activeUsers;
        acc.whatsappUsers += tenant.usage.whatsappUsers;
        acc.sectors += tenant.usage.sectors;
        acc.messagesSent += tenant.usage.messagesSent;
        acc.marketingMessagesSent += tenant.usage.marketingMessagesSent;
        acc.whatsappReceived += tenant.usage.whatsappReceived;
        acc.autentiqueDocuments += tenant.usage.autentiqueDocuments;
        acc.autentiquePending += tenant.usage.autentiquePending;
        acc.autentiqueSigned += tenant.usage.autentiqueSigned;
        acc.autentiqueRejected += tenant.usage.autentiqueRejected;
        acc.autentiqueDelivered += tenant.usage.autentiqueDelivered;
        acc.autentiqueViewed += tenant.usage.autentiqueViewed;
        acc.autentiqueAccepted += tenant.usage.autentiqueAccepted;
        acc.autentiqueDeliveryFailed += tenant.usage.autentiqueDeliveryFailed;
        acc.consultflexBasicSuccess += tenant.usage.consultflexBasicSuccess;
        acc.consultflexCompleteSuccess += tenant.usage.consultflexCompleteSuccess;
        acc.consultflexSuccess += tenant.usage.consultflexSuccessTotal;
        acc.budgetsCreated += tenant.activity.budgetsCreated;
        acc.budgetsApproved += tenant.activity.budgetsApproved;
        acc.budgetsApprovedValue += tenant.activity.budgetsApprovedValue;
        acc.clientsCreated += tenant.activity.clientsCreated;
        acc.projectsCreated += tenant.activity.projectsCreated;
        acc.sacadasCreated += tenant.activity.sacadasCreated;
        acc.workOrdersCreated += tenant.activity.workOrdersCreated;
        acc.auditedDeletes += tenant.activity.auditedDeletes;
        // Não adiciona mais o overage, pois usaremos o faturamento real

        if (tenant.status.users === 'exceeded') acc.usersExceeded += 1;
        if (tenant.status.whatsappUsers === 'exceeded') acc.whatsappUsersExceeded += 1;
        if (tenant.status.messages === 'exceeded') acc.messagesExceeded += 1;
        if (tenant.status.marketingMessages === 'exceeded') acc.marketingMessagesExceeded += 1;
        return acc;
      },
      {
        tenants: 0,
        registeredUsers: 0,
        activeUsers: 0,
        whatsappUsers: 0,
        sectors: 0,
        messagesSent: 0,
        marketingMessagesSent: 0,
        whatsappReceived: 0,
        budgetsCreated: 0,
        budgetsApproved: 0,
        budgetsApprovedValue: 0,
        clientsCreated: 0,
        projectsCreated: 0,
        sacadasCreated: 0,
        workOrdersCreated: 0,
        auditedDeletes: 0,
        autentiqueDocuments: 0,
        autentiquePending: 0,
        autentiqueSigned: 0,
        autentiqueRejected: 0,
        autentiqueDelivered: 0,
        autentiqueViewed: 0,
        autentiqueAccepted: 0,
        autentiqueDeliveryFailed: 0,
        consultflexBasicSuccess: 0,
        consultflexCompleteSuccess: 0,
        consultflexSuccess: 0,
        overageMonthly: faturamentoMesAtual, // Usar faturamento real em vez de overage
        usersExceeded: 0,
        whatsappUsersExceeded: 0,
        messagesExceeded: 0,
        marketingMessagesExceeded: 0,
      }
    );

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      messagesPeriodStart,
      rangeEnd: rangeEnd.toISOString(),
      totals,
      periodSummary: {
        lojasAtivas: lojasAtivasPeriodo,
        usuariosCadastrados: usuariosCadastradosPeriodo,
        usuariosWhatsapp: usuariosWhatsappPeriodo,
      },
      faturamentoMesAtual, // MRR do período
      faturamentoAcumulado, // Total acumulado
      tenants: tenantRows,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Falha ao consolidar consumo de assinatura' },
      { status: 500 }
    );
  }
}