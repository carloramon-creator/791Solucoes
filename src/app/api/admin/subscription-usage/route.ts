import { NextResponse } from 'next/server';
import { getGlassClient } from '@/lib/glass-client';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type StatusTone = 'ok' | 'warning' | 'exceeded';

type ConsultflexExecutionStatus = 'success' | 'failed' | 'unknown';

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

function classifyConsultflexExecutionStatus(row: Record<string, any>): ConsultflexExecutionStatus {
  const successBooleanKeys = ['success', 'sucesso', 'ok'];
  for (const key of successBooleanKeys) {
    if (!(key in row)) continue;
    const value = row[key];
    if (typeof value === 'boolean') return value ? 'success' : 'failed';
    const text = normalizeText(value);
    if (['true', '1', 'sim', 'success', 'sucesso', 'ok'].includes(text)) return 'success';
    if (['false', '0', 'nao', 'não', 'erro', 'error', 'fail', 'falha'].includes(text)) return 'failed';
  }

  const statusKeys = ['status', 'resultado', 'result', 'retorno'];
  for (const key of statusKeys) {
    if (!(key in row)) continue;
    const text = normalizeText(row[key]);
    if (!text) continue;
    if (/(erro|error|falha|failed|invalid|timeout|denied|negado|rejeitad)/.test(text)) return 'failed';
    if (/(sucesso|success|aprovad|ok|complet)/.test(text)) return 'success';
  }

  const httpStatusKeys = ['http_status', 'status_code', 'statuscode', 'response_status'];
  for (const key of httpStatusKeys) {
    if (!(key in row)) continue;
    const code = toFiniteNumber(row[key]);
    if (code == null) continue;
    if (code >= 200 && code < 300) return 'success';
    return 'failed';
  }

  const errorKeys = ['error', 'erro', 'error_message', 'erro_mensagem', 'mensagem_erro'];
  for (const key of errorKeys) {
    if (!(key in row)) continue;
    const text = normalizeText(row[key]);
    if (text) return 'failed';
  }

  return 'unknown';
}

function classifyConsultflexType(row: Record<string, any>): 'basic' | 'complete' | 'unknown' {
  const preferredKeys = [
    'tipo_consulta',
    'consulta_tipo',
    'tipo',
    'categoria',
    'modalidade',
    'plano',
    'credit_type',
    'produto',
    'produto_consulta',
    'produto_nome',
    'consulta_produto',
    'descricao',
    'description',
  ];

  for (const key of preferredKeys) {
    if (!(key in row)) continue;
    const text = normalizeText(row[key]);
    if (!text) continue;

    const hasCreditoContext = text.includes('credito') || text.includes('cred');
    if (text.includes('completa') || text.includes('complete') || text.includes('full')) return 'complete';
    if ((text.includes('total') || text.includes('bacen')) && hasCreditoContext) return 'complete';
    if (text.includes('basica') || text.includes('basic')) return 'basic';
  }

  const fallback = normalizeText(JSON.stringify(row));
  if (fallback.includes('completa') || fallback.includes('complete') || fallback.includes('full')) return 'complete';
  if ((fallback.includes('total') || fallback.includes('bacen')) && (fallback.includes('credito') || fallback.includes('credito'))) return 'complete';
  if (fallback.includes('basica') || fallback.includes('basic')) return 'basic';
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
      { data: sectorUsers, error: sectorUsersError },
      { data: messages, error: messagesError },
      { data: planConfig, error: planConfigError },
      { data: invoices, error: invoicesError },
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
        .from('whatsapp_sector_users')
        .select('sector_id, user_id'),
      glass
        .from('whatsapp_messages')
        .select('vidracaria_id, sender_type, created_at')
        .gte('created_at', messagesPeriodStart)
        .lte('created_at', rangeEnd.toISOString())
        .in('sender_type', ['user', 'system']),
      supabaseServer
        .from('system_plans')
        .select('system_limits')
        .eq('sistema', '791glass')
        .single(),
      supabaseServer
        .from('system_invoices')
        .select('value, status, created_at, metadata')
        .gte('created_at', messagesPeriodStart)
        .lte('created_at', rangeEnd.toISOString())
        .in('status', ['pago', 'authorized']),
    ]);

    const firstError =
      tenantsError ||
      profilesError ||
      sectorsError ||
      sectorUsersError ||
      messagesError ||
      planConfigError ||
      invoicesError;

    if (firstError) {
      return NextResponse.json({ error: firstError.message }, { status: 500 });
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

    const sectorToTenantMap = new Map<string, string>();
    (sectors || []).forEach((sector: any) => {
      if (sector?.id && sector?.vidracaria_id) {
        sectorToTenantMap.set(String(sector.id), String(sector.vidracaria_id));
      }
    });

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
    (sectorUsers || []).forEach((row: any) => {
      const sectorId = String(row?.sector_id || '');
      const userId = String(row?.user_id || '');
      if (!sectorId || !userId) return;

      const tenantId = sectorToTenantMap.get(sectorId);
      if (!tenantId) return;

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
    (messages || []).forEach((msg: any) => {
      const tenantId = String(msg?.vidracaria_id || '');
      if (!tenantId) return;
      messagesByTenant.set(tenantId, (messagesByTenant.get(tenantId) || 0) + 1);
    });

    const consultflexByTenant = new Map<string, {
      basicSuccess: number;
      completeSuccess: number;
      failed: number;
      unknown: number;
    }>();

    // Fonte principal: consultas no periodo selecionado (data da consulta).
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

    // Vinculo primario por orcamento_id para evitar atribuicao incorreta por colunas genericas.
    const linkedOrcamentoIds = Array.from(new Set(
      safeConsultRows
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

    safeConsultRows.forEach((row: any) => {
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
    const defaultUsersLimit = toNumber(systemLimits.usersIncluded, 10);
    const defaultWhatsappUsersLimit = toNumber(systemLimits.wppDevices, 1);
    const defaultMessagesLimit = toNumber(systemLimits.wppMessages, 1000);
    const extraUserPrice = toNumber(systemLimits.extraUserPrice, 0);
    const extraDevicePrice = toNumber(systemLimits.extraDevicePrice, 0);
    const extraMessagePrice = toNumber(systemLimits.extraMessagePrice, toNumber(systemLimits.wppMessagesPrice, 0));
    const consultflexBasicPrice = toNumber(systemLimits.consultflexBasicPrice, toNumber(systemLimits.consultBasicPrice, 0));
    const consultflexCompletePrice = toNumber(systemLimits.consultflexCompletePrice, toNumber(systemLimits.consultCompletePrice, 0));

    const tenantRows = (tenants || []).map((tenant: any) => {
      const tenantId = String(tenant.id);

      const registeredUsers = usersByTenant.get(tenantId)?.size || 0;
      const activeUsers = activeUsersByTenant.get(tenantId)?.size || 0;
      const whatsappUsers = whatsappUsersByTenant.get(tenantId)?.size || 0;
      const sectorsCount = sectorsByTenant.get(tenantId) || 0;
      const messagesSent = messagesByTenant.get(tenantId) || 0;
      const consultflexUsage = consultflexByTenant.get(tenantId) || {
        basicSuccess: 0,
        completeSuccess: 0,
        failed: 0,
        unknown: 0,
      };

      const usersLimit = tenant.limite_usuarios == null
        ? defaultUsersLimit
        : toNumber(tenant.limite_usuarios, defaultUsersLimit);
      const whatsappUsersLimit = tenant.limite_usuarios_whats == null
        ? defaultWhatsappUsersLimit
        : toNumber(tenant.limite_usuarios_whats, defaultWhatsappUsersLimit);
      const messagesLimit = tenant.limite_mensagens_whatsapp == null
        ? defaultMessagesLimit
        : toNumber(tenant.limite_mensagens_whatsapp, defaultMessagesLimit);

      const extraUsers = Math.max(0, registeredUsers - usersLimit);
      const extraWhatsappUsers = Math.max(0, whatsappUsers - whatsappUsersLimit);
      const extraMessages = Math.max(0, messagesSent - messagesLimit);

      const usersOverage = extraUsers * extraUserPrice;
      const whatsappUsersOverage = extraWhatsappUsers * extraDevicePrice;
      const messagesOverage = extraMessages * extraMessagePrice;
      const consultflexBasicOverage = consultflexUsage.basicSuccess * consultflexBasicPrice;
      const consultflexCompleteOverage = consultflexUsage.completeSuccess * consultflexCompletePrice;
      const consultflexOverage = consultflexBasicOverage + consultflexCompleteOverage;
      const overageTotal = usersOverage + whatsappUsersOverage + messagesOverage + consultflexOverage;

      return {
        ...tenant,
        vidracariaId: tenantId,
        usage: {
          registeredUsers,
          activeUsers,
          whatsappUsers,
          sectors: sectorsCount,
          messagesSent,
          consultflexBasicSuccess: consultflexUsage.basicSuccess,
          consultflexCompleteSuccess: consultflexUsage.completeSuccess,
          consultflexSuccessTotal: consultflexUsage.basicSuccess + consultflexUsage.completeSuccess,
          consultflexFailed: consultflexUsage.failed,
          consultflexUnknown: consultflexUsage.unknown,
          consultflexCountedRows:
            consultflexUsage.basicSuccess
            + consultflexUsage.completeSuccess
            + consultflexUsage.failed
            + consultflexUsage.unknown,
        },
        limits: {
          users: usersLimit,
          whatsappUsers: whatsappUsersLimit,
          messages: messagesLimit,
        },
        status: {
          users: getStatusTone(registeredUsers, usersLimit),
          whatsappUsers: getStatusTone(whatsappUsers, whatsappUsersLimit),
          messages: getStatusTone(messagesSent, messagesLimit),
        },
        overage: {
          extraUsers,
          extraWhatsappUsers,
          extraMessages,
          consultflexBasicSuccess: consultflexUsage.basicSuccess,
          consultflexCompleteSuccess: consultflexUsage.completeSuccess,
          prices: {
            extraUserPrice,
            extraDevicePrice,
            extraMessagePrice,
            consultflexBasicPrice,
            consultflexCompletePrice,
          },
          values: {
            users: usersOverage,
            whatsappUsers: whatsappUsersOverage,
            messages: messagesOverage,
            consultflexBasic: consultflexBasicOverage,
            consultflexComplete: consultflexCompleteOverage,
            consultflexTotal: consultflexOverage,
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
        acc.consultflexBasicSuccess += tenant.usage.consultflexBasicSuccess;
        acc.consultflexCompleteSuccess += tenant.usage.consultflexCompleteSuccess;
        acc.consultflexSuccess += tenant.usage.consultflexSuccessTotal;
        // Não adiciona mais o overage, pois usaremos o faturamento real

        if (tenant.status.users === 'exceeded') acc.usersExceeded += 1;
        if (tenant.status.whatsappUsers === 'exceeded') acc.whatsappUsersExceeded += 1;
        if (tenant.status.messages === 'exceeded') acc.messagesExceeded += 1;
        return acc;
      },
      {
        tenants: 0,
        registeredUsers: 0,
        activeUsers: 0,
        whatsappUsers: 0,
        sectors: 0,
        messagesSent: 0,
        consultflexBasicSuccess: 0,
        consultflexCompleteSuccess: 0,
        consultflexSuccess: 0,
        overageMonthly: faturamentoMesAtual, // Usar faturamento real em vez de overage
        usersExceeded: 0,
        whatsappUsersExceeded: 0,
        messagesExceeded: 0,
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