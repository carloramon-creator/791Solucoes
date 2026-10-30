import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authorizeSponsorManagement, findHoldingAuthUserByEmail } from '@/lib/sponsor-management-auth';

const PRODUCTION_URL = 'https://admin.791solucoes.com.br';

export async function POST(req: Request) {
  const auth = await authorizeSponsorManagement(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  try {
    const body = await req.json();
    const sponsorId = String(body?.sponsorId || '').trim();
    if (!sponsorId) {
      return NextResponse.json({ success: false, error: 'Patrocinador não informado.' }, { status: 400 });
    }

    const { data: sponsor, error: sponsorError } = await supabaseServer
      .from('patrocinadores')
      .select('id, nome, email')
      .eq('id', sponsorId)
      .maybeSingle();
    if (sponsorError) throw sponsorError;
    if (!sponsor) return NextResponse.json({ success: false, error: 'Patrocinador não encontrado.' }, { status: 404 });

    const email = String(sponsor.email || '').trim().toLowerCase();
    if (!email) return NextResponse.json({ success: false, error: 'Este patrocinador não possui e-mail cadastrado.' }, { status: 400 });

    const existingUser = await findHoldingAuthUserByEmail(email);
    if (existingUser && existingUser.app_metadata?.role !== 'sponsor' && existingUser.user_metadata?.role !== 'sponsor') {
      return NextResponse.json({ success: false, error: 'O e-mail pertence a uma conta que não é de patrocinador.' }, { status: 409 });
    }

    if (existingUser) {
      const { error: metadataError } = await supabaseServer.auth.admin.updateUserById(existingUser.id, {
        app_metadata: { ...existingUser.app_metadata, role: 'sponsor' }
      });
      if (metadataError) throw metadataError;

      const { error: resetError } = await supabaseServer.auth.resetPasswordForEmail(email, {
        redirectTo: `${PRODUCTION_URL}/set-password`
      });

      if (!resetError) {
        return NextResponse.json({
          success: true,
          link: null,
          message: `E-mail de recuperação enviado para ${email}.`
        });
      }

      console.error('[RESEND-INVITE] Erro ao enviar recuperação:', resetError.message);
      const { data: linkData, error: linkError } = await supabaseServer.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${PRODUCTION_URL}/set-password` }
      });
      if (linkError) throw linkError;

      return NextResponse.json({
        success: true,
        link: linkData.properties.action_link,
        message: 'SMTP indisponível. Copie o link e envie manualmente.'
      });
    }

    const { data: inviteData, error: inviteError } = await supabaseServer.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${PRODUCTION_URL}/set-password`,
      data: { role: 'sponsor', name: sponsor.nome }
    });

    if (!inviteError) {
      if (inviteData.user) {
        const { error: metadataError } = await supabaseServer.auth.admin.updateUserById(inviteData.user.id, {
          app_metadata: { ...(inviteData.user.app_metadata || {}), role: 'sponsor' }
        });
        if (metadataError) throw metadataError;
      }
      return NextResponse.json({
        success: true,
        link: null,
        message: `Convite enviado para ${email}.`
      });
    }

    console.error('[RESEND-INVITE] Erro ao enviar convite:', inviteError.message);
    const tempPassword = `Temp791!${crypto.randomUUID()}!`;
    const { data: created, error: createError } = await supabaseServer.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      app_metadata: { role: 'sponsor' },
      user_metadata: { role: 'sponsor', name: sponsor.nome }
    });
    if (createError) throw createError;

    const { data: linkData, error: linkError } = await supabaseServer.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${PRODUCTION_URL}/set-password` }
    });
    if (linkError) {
      await supabaseServer.auth.admin.deleteUser(created.user.id);
      throw linkError;
    }

    return NextResponse.json({
      success: true,
      link: linkData.properties.action_link,
      message: 'SMTP indisponível. Copie o link e envie manualmente.'
    });
  } catch (err) {
    console.error('[RESEND INVITE ERROR]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Erro ao enviar acesso.' }, { status: 500 });
  }
}
