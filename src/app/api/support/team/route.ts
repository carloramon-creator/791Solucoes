import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

const AVATAR_BUCKET = 'equipe-avatars';

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem consultar equipe de suporte.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { data, error } = await supabaseServer
      .from('equipe_791')
      .select('nome, email, cargo, foto_path')
      .not('email', 'is', null)
      .order('nome', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message || 'Falha ao carregar equipe.' }, { status: 500 });
    }

    const normalized = new Map<string, { name: string | null; email: string; cargo: string | null; avatarUrl: string | null }>();

    for (const row of data || []) {
      const email = String(row.email || '').trim().toLowerCase();
      if (!email) continue;

      let avatarUrl: string | null = null;
      const fotoPath = row.foto_path ? String(row.foto_path).trim() : '';
      if (fotoPath) {
        const { data: signedAvatar } = await supabaseServer.storage
          .from(AVATAR_BUCKET)
          .createSignedUrl(fotoPath, 60 * 60);
        avatarUrl = signedAvatar?.signedUrl || null;
      }

      normalized.set(email, {
        name: row.nome ? String(row.nome) : null,
        email,
        cargo: row.cargo ? String(row.cargo) : null,
        avatarUrl,
      });
    }

    if (auth.user.email) {
      const own = String(auth.user.email).trim().toLowerCase();
      if (own && !normalized.has(own)) {
        normalized.set(own, { name: null, email: own, cargo: null, avatarUrl: null });
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
