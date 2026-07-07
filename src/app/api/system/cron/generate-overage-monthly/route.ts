import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { scheduleMonthlyOverageChargeForTenant } from '@/services/payment-processor';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get('secret');
    const force = searchParams.get('force') === 'true';
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    if (!force && now.getDate() !== 1) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'outside_generation_day',
        message: 'Geração mensal configurada para ocorrer apenas no dia 01.',
      });
    }

    const holdingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const holdingServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const glassUrl = process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL!;
    const glassServiceKey = process.env.SUPABASE_GLASS_SERVICE_ROLE_KEY!;

    const holdingSupabase = createClient(holdingUrl, holdingServiceKey);
    const glassSupabase = createClient(glassUrl, glassServiceKey);

    const { data: tenants, error: tenantsError } = await glassSupabase
      .from('vidracarias')
      .select('id, nome');

    if (tenantsError) throw tenantsError;

    const report = {
      scanned: tenants?.length || 0,
      created: 0,
      skipped: 0,
      errors: 0,
      projectedRevenueTotal: 0,
      skippedByReason: {} as Record<string, number>,
      samples: [] as Array<{ tenantId: string; tenantName: string; status: 'created' | 'skipped' | 'error'; reason?: string; details?: any }>,
      tenantBreakdown: [] as Array<{
        tenantId: string;
        tenantName: string;
        status: 'created' | 'skipped' | 'error';
        reason?: string;
        refMonth?: string;
        dueDate?: string;
        chargeStatus?: string;
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
        error?: string;
      }>,
    };

    for (const tenant of tenants || []) {
      try {
        const result = await scheduleMonthlyOverageChargeForTenant({
          holdingSupabase,
          glassSupabase,
          tenantId: tenant.id,
          force,
          now,
        });

        if (result?.created) {
          report.created += 1;
          const details = (result as any)?.details || null;
          const total = Number(details?.values?.total || 0);
          report.projectedRevenueTotal += Number.isFinite(total) ? total : 0;

          report.tenantBreakdown.push({
            tenantId: tenant.id,
            tenantName: tenant.nome || '',
            status: 'created',
            reason: String((result as any)?.reason || 'created'),
            refMonth: details?.refMonth,
            dueDate: details?.dueDate,
            chargeStatus: details?.chargeStatus || 'created',
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
          });

          if (report.samples.length < 20) {
            report.samples.push({
              tenantId: tenant.id,
              tenantName: tenant.nome || '',
              status: 'created',
              reason: String((result as any)?.reason || 'created'),
              details,
            });
          }
        } else {
          report.skipped += 1;
          const reason = String((result as any)?.reason || 'skipped');
          const details = (result as any)?.details || null;
          report.skippedByReason[reason] = (report.skippedByReason[reason] || 0) + 1;

          report.tenantBreakdown.push({
            tenantId: tenant.id,
            tenantName: tenant.nome || '',
            status: 'skipped',
            reason,
            refMonth: details?.refMonth,
            dueDate: details?.dueDate,
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
              total: Number(details?.values?.total || 0),
            },
          });

          if (report.samples.length < 20) {
            report.samples.push({
              tenantId: tenant.id,
              tenantName: tenant.nome || '',
              status: 'skipped',
              reason,
              details,
            });
          }
        }
      } catch (err) {
        report.errors += 1;
        report.tenantBreakdown.push({
          tenantId: tenant.id,
          tenantName: tenant.nome || '',
          status: 'error',
          reason: 'error',
          error: err instanceof Error ? err.message : 'unknown_error',
        });
        if (report.samples.length < 20) {
          report.samples.push({
            tenantId: tenant.id,
            tenantName: tenant.nome || '',
            status: 'error',
            reason: err instanceof Error ? err.message : 'unknown_error',
          });
        }
      }
    }

    return NextResponse.json({ success: true, report });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Falha ao gerar excedentes mensais.' }, { status: 500 });
  }
}
