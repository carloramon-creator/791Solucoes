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
      skippedByReason: {} as Record<string, number>,
      samples: [] as Array<{ tenantId: string; tenantName: string; status: 'created' | 'skipped' | 'error'; reason?: string; details?: any }>,
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
          if (report.samples.length < 20) {
            report.samples.push({
              tenantId: tenant.id,
              tenantName: tenant.nome || '',
              status: 'created',
            });
          }
        } else {
          report.skipped += 1;
          const reason = String((result as any)?.reason || 'skipped');
          report.skippedByReason[reason] = (report.skippedByReason[reason] || 0) + 1;
          if (report.samples.length < 20) {
            report.samples.push({
              tenantId: tenant.id,
              tenantName: tenant.nome || '',
              status: 'skipped',
              reason,
              details: (result as any)?.details || null,
            });
          }
        }
      } catch (err) {
        report.errors += 1;
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
