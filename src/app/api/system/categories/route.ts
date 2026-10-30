import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { data, error } = await supabaseServer
      .from('system_finance_categories')
      .select('*')
      .order('name');

    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Dados inválidos para criar classe/subclasse.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('name' in body) ||
      typeof body.name !== 'string' || !body.name.trim() || !('type' in body) ||
      (body.type !== 'revenue' && body.type !== 'expense')) {
    return NextResponse.json({ error: 'Informe o nome e o tipo da classe/subclasse.' }, { status: 400 });
  }
  const name = body.name.trim();
  const type = body.type;
  const parentId = 'parent_id' in body ? body.parent_id : null;
  const useWebhook = 'use_webhook' in body ? body.use_webhook : false;
  const subcategoryName = 'subcategory_name' in body ? body.subcategory_name : undefined;
  if ((parentId !== null && (typeof parentId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parentId))) ||
      typeof useWebhook !== 'boolean' ||
      (subcategoryName !== undefined && (parentId !== null ||
        typeof subcategoryName !== 'string' || !subcategoryName.trim()))) {
    return NextResponse.json({ error: 'Classe principal ou subclasse inválida.' }, { status: 400 });
  }
  try {
    if (parentId) {
      const { data: parent, error: parentError } = await supabaseServer
        .from('system_finance_categories').select('id, type, parent_id').eq('id', parentId).maybeSingle();
      if (parentError) throw parentError;
      if (!parent || parent.parent_id || parent.type !== type) {
        return NextResponse.json({ error: 'Escolha uma classe principal do mesmo tipo.' }, { status: 400 });
      }
    }

    if (typeof subcategoryName === 'string') {
      const rootId = randomUUID();
      const { data, error } = await supabaseServer
        .from('system_finance_categories')
        .insert([
          { id: rootId, name, type, parent_id: null, use_webhook: useWebhook },
          { id: randomUUID(), name: subcategoryName.trim(), type, parent_id: rootId, use_webhook: useWebhook },
        ])
        .select();
      if (error) throw error;
      return NextResponse.json({ categories: data });
    }

    const { data, error } = await supabaseServer
      .from('system_finance_categories')
      .insert([{ name, type, parent_id: parentId, use_webhook: useWebhook }])
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
      ? err.message : 'Falha ao criar classe/subclasse.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) throw new Error('ID é obrigatório para atualização');

    const { data, error } = await supabaseServer
      .from('system_finance_categories')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
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
      .from('system_finance_categories')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
