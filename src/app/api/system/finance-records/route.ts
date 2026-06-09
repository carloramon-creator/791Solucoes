import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase-server';

export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from('system_finance_records')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const records = data || [];
    const tenantIds = Array.from(new Set(
      records
        .map((record: any) => record?.metadata?.tenant_id)
        .filter((id: string | undefined) => Boolean(id))
    ));

    let tenantNameById: Record<string, string> = {};
    if (tenantIds.length > 0 && process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL && process.env.SUPABASE_GLASS_SERVICE_ROLE_KEY) {
      const glassSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL,
        process.env.SUPABASE_GLASS_SERVICE_ROLE_KEY
      );

      const { data: tenants } = await glassSupabase
        .from('vidracarias')
        .select('id, nome')
        .in('id', tenantIds);

      tenantNameById = (tenants || []).reduce((acc: Record<string, string>, tenant: any) => {
        acc[tenant.id] = tenant.nome;
        return acc;
      }, {});
    }

    const enrichedRecords = records.map((record: any) => ({
      ...record,
      tenant_name: tenantNameById[record?.metadata?.tenant_id] || null,
    }));

    return NextResponse.json({ success: true, records: enrichedRecords });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const { data, error } = await supabaseServer
      .from('system_finance_records')
      .insert([body])
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, record: data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) throw new Error('ID é obrigatório');

    const { data, error } = await supabaseServer
      .from('system_finance_records')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, record: data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) throw new Error('ID é obrigatório');

    const { error } = await supabaseServer
      .from('system_finance_records')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}