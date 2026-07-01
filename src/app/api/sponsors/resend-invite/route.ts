import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const PRODUCTION_URL = 'https://admin.791solucoes.com.br';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      throw new Error('E-mail não fornecido.');
    }

    const holdingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const holdingServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(holdingUrl, holdingServiceKey);

    // Verificar se o usuário já existe no Auth
    const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const existingUser = listData?.users?.find(u => u.email === email);

    if (existingUser) {
      // Caso 1: Usuário já existe -> Enviar e-mail de redefinição de senha (recuperação) via Supabase SMTP
      console.log(`[RESEND-INVITE] Usuário já existe (${existingUser.id}). Enviando e-mail de recuperação...`);
      
      const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo: `${PRODUCTION_URL}/set-password`
      });

      if (resetError) {
        console.error('[RESEND-INVITE] Erro ao enviar resetPasswordForEmail:', resetError.message);
        
        // Fallback: gerar link manualmente se o SMTP falhar
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: `${PRODUCTION_URL}/set-password` }
        });

        if (linkError) throw linkError;

        return NextResponse.json({
          success: true,
          link: linkData?.properties?.action_link || null,
          message: 'SMTP indisponível. Copie o link abaixo para enviar manualmente.'
        });
      }

      return NextResponse.json({
        success: true,
        link: null,
        message: `✅ E-mail de redefinição de senha enviado com sucesso para ${email}!`
      });

    } else {
      // Caso 2: Usuário não existe -> Enviar convite (cria o usuário + envia e-mail) via Supabase SMTP
      console.log(`[RESEND-INVITE] Usuário não existe. Enviando convite para ${email}...`);

      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${PRODUCTION_URL}/set-password`,
        data: { role: 'sponsor' }
      });

      if (inviteError) {
        console.error('[RESEND-INVITE] Erro ao enviar convite por e-mail:', inviteError.message);

        // Fallback: criar usuário e gerar link manualmente
        const tempPassword = 'Temp791!' + Math.random().toString(36).substring(2, 8) + '!';
        const { error: createError } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { role: 'sponsor' }
        });

        if (createError && !createError.message.includes('already')) throw createError;

        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: `${PRODUCTION_URL}/login` }
        });

        if (linkError) throw linkError;

        return NextResponse.json({
          success: true,
          link: linkData?.properties?.action_link || null,
          message: 'SMTP indisponível. Copie o link abaixo para enviar manualmente.'
        });
      }

      return NextResponse.json({
        success: true,
        link: null,
        message: `✅ Convite enviado com sucesso para ${email}!`
      });
    }

  } catch (err: any) {
    console.error('[RESEND INVITE ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
