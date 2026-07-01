import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem consultar equipe de suporte.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { data, error } = await supabaseServer
      .from('equipe_791')
      .select('nome, email')
      .not('email', 'is', null)
      .order('nome', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message || 'Falha ao carregar equipe.' }, { status: 500 });
    }

    const normalized = new Map<string, { name: string | null; email: string }>();

    for (const row of data || []) {
      const email = String(row.email || '').trim().toLowerCase();
      if (!email) continue;
      normalized.set(email, {
        name: row.nome ? String(row.nome) : null,
        email,
      });
    }

    if (auth.user.email) {
      const own = String(auth.user.email).trim().toLowerCase();
      if (own && !normalized.has(own)) {
        normalized.set(own, { name: null, email: own });
      }
    }

    return NextResponse.json({
      total: normalized.size,
      members: Array.from(normalized.values()),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao carregar equipe.' }, { status: 500 });
  }
}
