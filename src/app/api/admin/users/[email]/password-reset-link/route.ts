import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

type RouteContext = {
  params: Promise<{ email: string }>;
};

function normalizeEmail(value: string): string {
  return decodeURIComponent(String(value || '').trim().toLowerCase());
}

function getRedirectBase(req: Request): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');
  const origin = req.headers.get('origin');
  if (origin) return origin.replace(/\/$/, '');
  return 'https://admin.791solucoes.com.br';
}

export async function POST(req: Request, context: RouteContext) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem gerar link de senha.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { email } = await context.params;
  const userEmail = normalizeEmail(email);
  if (!userEmail) {
    return NextResponse.json({ error: 'E-mail invalido.' }, { status: 400 });
  }

  const redirectTo = `${getRedirectBase(req)}/set-password`;

  try {
    const { data: listedUsers, error: listError } = await supabaseServer.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) {
      return NextResponse.json({ error: listError.message || 'Falha ao consultar usuarios do Auth.' }, { status: 500 });
    }

    const existingUser = (listedUsers?.users || []).find((user) => String(user.email || '').trim().toLowerCase() === userEmail);
    let actionLink: string | null = null;

    if (existingUser) {
      const { data, error } = await supabaseServer.auth.admin.generateLink({
        type: 'recovery',
        email: userEmail,
        options: { redirectTo },
      });

      if (!error && data?.properties?.action_link) {
        actionLink = data.properties.action_link;
      }
    } else {
      const { error: inviteError } = await supabaseServer.auth.admin.inviteUserByEmail(userEmail, {
        redirectTo,
        data: { generatedBy: auth.user.email || null },
      });

      if (inviteError) {
        const inviteMessage = String(inviteError.message || '').toLowerCase();
        if (!inviteMessage.includes('already exists')) {
          return NextResponse.json({ error: inviteError.message || 'Falha ao enviar convite.' }, { status: 500 });
        }
      }

      const { data, error } = await supabaseServer.auth.admin.generateLink({
        type: 'recovery',
        email: userEmail,
        options: { redirectTo },
      });

      if (!error && data?.properties?.action_link) {
        actionLink = data.properties.action_link;
      }
    }

    if (!actionLink) {
      return NextResponse.json({
        ok: true,
        email: userEmail,
        generatedBy: auth.user.email,
        message: 'Nao foi possivel gerar o link automaticamente. Verifique se o usuario tem conta no Auth.',
      });
    }

    return NextResponse.json({
      ok: true,
      actionLink,
      email: userEmail,
      generatedBy: auth.user.email,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao gerar link de senha.' }, { status: 500 });
  }
}