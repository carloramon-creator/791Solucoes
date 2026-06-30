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

    if (!existingUser) {
      // Criar usuário primeiro para garantir que existe
      const tempPassword = 'Temp791!' + Math.random().toString(36).substring(2, 8) + '!';
      const { error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { role: 'sponsor' }
      });
      if (createError && !createError.message.includes('already')) {
        throw new Error(`Falha ao criar usuário: ${createError.message}`);
      }
      console.log(`[RESEND-INVITE] Usuário criado para ${email}`);
    } else {
      console.log(`[RESEND-INVITE] Usuário já existe: ${existingUser.id}`);
    }

    // Gerar link de ativação/recuperação de senha com a URL de produção
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${PRODUCTION_URL}/login`
      }
    });

    if (linkError) throw linkError;

    const link = linkData?.properties?.action_link || null;
    console.log(`[RESEND-INVITE] Link gerado para ${email}: ${link}`);

    // Tentar enviar via inviteUserByEmail (usa SMTP configurado no Supabase)
    try {
      await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${PRODUCTION_URL}/login`,
        data: { role: 'sponsor' }
      });
      // Se chegou aqui, o email foi enviado com sucesso
      return NextResponse.json({
        success: true,
        link: null,
        message: `E-mail de acesso enviado com sucesso para ${email}!`
      });
    } catch (smtpErr: any) {
      // SMTP falhou — retornar o link para o admin enviar manualmente
      console.warn('[RESEND-INVITE] SMTP falhou:', smtpErr.message);
      return NextResponse.json({
        success: true,
        link,
        message: 'SMTP indisponível. Use o link abaixo para enviar manualmente ao patrocinador.'
      });
    }

  } catch (err: any) {
    console.error('[RESEND INVITE ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
