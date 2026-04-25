import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from('system_settings')
      .select('value')
      .eq('id', 'finance_api')
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    return NextResponse.json(data?.value || {});
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const { error } = await supabaseServer
      .from('system_settings')
      .upsert({
        id: 'finance_api',
        value: body,
        updated_at: new Date().toISOString()
      });

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
