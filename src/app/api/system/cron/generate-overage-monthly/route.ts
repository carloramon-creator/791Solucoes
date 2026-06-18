import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { scheduleMonthlyOverageChargeForTenant } from '@/services/payment-processor';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get('secret');
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    };

    for (const tenant of tenants || []) {
      try {
        const result = await scheduleMonthlyOverageChargeForTenant({
          holdingSupabase,
          glassSupabase,
          tenantId: tenant.id,
        });

        if (result?.created) report.created += 1;
        else report.skipped += 1;
      } catch (err) {
        report.errors += 1;
      }
    }

    return NextResponse.json({ success: true, report });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Falha ao gerar excedentes mensais.' }, { status: 500 });
  }
}
