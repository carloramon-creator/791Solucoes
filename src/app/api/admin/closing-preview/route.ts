import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { scheduleMonthlyOverageChargeForTenant } from '@/services/payment-processor';

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem visualizar previa de fechamento.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const holdingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const holdingServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const glassUrl = process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL!;
    const glassServiceKey = process.env.SUPABASE_GLASS_SERVICE_ROLE_KEY!;

    const holdingSupabase = createClient(holdingUrl, holdingServiceKey);
    const glassSupabase = createClient(glassUrl, glassServiceKey);

    const { data: tenants, error: tenantsError } = await glassSupabase
      .from('vidracarias')
      .select('id, nome')
      .order('nome');

    if (tenantsError) throw tenantsError;

    const report = {
      scanned: tenants?.length || 0,
      withCharge: 0,
      withoutCharge: 0,
      errors: 0,
      projectedRevenueTotal: 0,
      refMonth: null as string | null,
      dueDate: null as string | null,
      tenantBreakdown: [] as Array<{
        tenantId: string;
        tenantName: string;
        status: 'with_charge' | 'without_charge' | 'error';
        reason?: string;
        consultflex?: {
          basic?: number;
          complete?: number;
          failed?: number;
          unknown?: number;
          amountFinal?: number;
        };
        extras?: {
          users?: number;
          whatsappUsers?: number;
          messages?: number;
        };
        values?: {
          users?: number;
          whatsappUsers?: number;
          messages?: number;
          consultflexTotal?: number;
          total?: number;
        };
        existingRecordId?: string | null;
        error?: string;
      }>,
    };

    for (const tenant of tenants || []) {
      try {
        const result = await scheduleMonthlyOverageChargeForTenant({
          holdingSupabase,
          glassSupabase,
          tenantId: tenant.id,
          force: true,
          previewOnly: true,
          now: new Date(),
        });

        const details = (result as any)?.details || null;
        const total = Number(details?.values?.total || 0);
        if (!report.refMonth && details?.refMonth) report.refMonth = String(details.refMonth);
        if (!report.dueDate && details?.dueDate) report.dueDate = String(details.dueDate);

        if (total > 0) {
          report.withCharge += 1;
          report.projectedRevenueTotal += total;
          report.tenantBreakdown.push({
            tenantId: tenant.id,
            tenantName: tenant.nome || '',
            status: 'with_charge',
            reason: String((result as any)?.reason || 'preview'),
            consultflex: {
              basic: Number(details?.consultflex?.basic || 0),
              complete: Number(details?.consultflex?.complete || 0),
              failed: Number(details?.consultflex?.failed || 0),
              unknown: Number(details?.consultflex?.unknown || 0),
              amountFinal: Number(details?.consultflex?.amountFinal || 0),
            },
            extras: {
              users: Number(details?.extras?.users || 0),
              whatsappUsers: Number(details?.extras?.whatsappUsers || 0),
              messages: Number(details?.extras?.messages || 0),
            },
            values: {
              users: Number(details?.values?.users || 0),
              whatsappUsers: Number(details?.values?.whatsappUsers || 0),
              messages: Number(details?.values?.messages || 0),
              consultflexTotal: Number(details?.values?.consultflexTotal || 0),
              total,
            },
            existingRecordId: details?.existingRecordId || null,
          });
        } else {
          report.withoutCharge += 1;
          report.tenantBreakdown.push({
            tenantId: tenant.id,
            tenantName: tenant.nome || '',
            status: 'without_charge',
            reason: String((result as any)?.reason || 'no_overage'),
            consultflex: {
              basic: Number(details?.consultflex?.basic || 0),
              complete: Number(details?.consultflex?.complete || 0),
              failed: Number(details?.consultflex?.failed || 0),
              unknown: Number(details?.consultflex?.unknown || 0),
              amountFinal: Number(details?.consultflex?.amountFinal || 0),
            },
            extras: {
              users: Number(details?.extras?.users || 0),
              whatsappUsers: Number(details?.extras?.whatsappUsers || 0),
              messages: Number(details?.extras?.messages || 0),
            },
            values: {
              users: Number(details?.values?.users || 0),
              whatsappUsers: Number(details?.values?.whatsappUsers || 0),
              messages: Number(details?.values?.messages || 0),
              consultflexTotal: Number(details?.values?.consultflexTotal || 0),
              total,
            },
            existingRecordId: details?.existingRecordId || null,
          });
        }
      } catch (err) {
        report.errors += 1;
        report.tenantBreakdown.push({
          tenantId: tenant.id,
          tenantName: tenant.nome || '',
          status: 'error',
          error: err instanceof Error ? err.message : 'unknown_error',
        });
      }
    }

    report.tenantBreakdown.sort((a, b) => Number(b.values?.total || 0) - Number(a.values?.total || 0));

    return NextResponse.json({ success: true, generatedAt: new Date().toISOString(), report });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Falha ao gerar previa de fechamento.' }, { status: 500 });
  }
}
