import { NextResponse } from 'next/server';
import { getGlassClient } from '@/lib/glass-client';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type StatusTone = 'ok' | 'warning' | 'exceeded';

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

export async function GET() {
  try {
    const glass = await getGlassClient();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const messagesPeriodStart = monthStart.toISOString();

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
        .select('vidracaria_id, user_id, ativo'),
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

    const messagesByTenant = new Map<string, number>();
    (messages || []).forEach((msg: any) => {
      const tenantId = String(msg?.vidracaria_id || '');
      if (!tenantId) return;
      messagesByTenant.set(tenantId, (messagesByTenant.get(tenantId) || 0) + 1);
    });

    const systemLimits = (planConfig as any)?.system_limits || {};
    const defaultUsersLimit = toNumber(systemLimits.usersIncluded, 10);
    const defaultWhatsappUsersLimit = toNumber(systemLimits.wppDevices, 1);
    const defaultMessagesLimit = toNumber(systemLimits.wppMessages, 1000);
    const extraUserPrice = toNumber(systemLimits.extraUserPrice, 0);
    const extraDevicePrice = toNumber(systemLimits.extraDevicePrice, 0);
    const extraMessagePrice = toNumber(systemLimits.extraMessagePrice, toNumber(systemLimits.wppMessagesPrice, 0));

    const tenantRows = (tenants || []).map((tenant: any) => {
      const tenantId = String(tenant.id);

      const registeredUsers = usersByTenant.get(tenantId)?.size || 0;
      const activeUsers = activeUsersByTenant.get(tenantId)?.size || 0;
      const whatsappUsers = whatsappUsersByTenant.get(tenantId)?.size || 0;
      const sectorsCount = sectorsByTenant.get(tenantId) || 0;
      const messagesSent = messagesByTenant.get(tenantId) || 0;

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
      const overageTotal = usersOverage + whatsappUsersOverage + messagesOverage;

      return {
        ...tenant,
        vidracariaId: tenantId,
        usage: {
          registeredUsers,
          activeUsers,
          whatsappUsers,
          sectors: sectorsCount,
          messagesSent,
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
          prices: {
            extraUserPrice,
            extraDevicePrice,
            extraMessagePrice,
          },
          values: {
            users: usersOverage,
            whatsappUsers: whatsappUsersOverage,
            messages: messagesOverage,
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
        overageMonthly: faturamentoMesAtual, // Usar faturamento real em vez de overage
        usersExceeded: 0,
        whatsappUsersExceeded: 0,
        messagesExceeded: 0,
      }
    );

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      messagesPeriodStart,
      totals,
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