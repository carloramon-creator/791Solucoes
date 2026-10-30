import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

export async function POST(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await req.json();

    const { data, error } = await supabaseServer
      .from('system_bank_cards')
      .insert([body])
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, card: data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) throw new Error('ID é obrigatório');

    if ('statement_subcategory_id' in updates) {
      updates.statement_subcategory_id = updates.statement_subcategory_id || null;
    }

    const { data, error } = await supabaseServer
      .from('system_bank_cards')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, card: data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) throw new Error('ID é obrigatório');

    const { error } = await supabaseServer
      .from('system_bank_cards')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}