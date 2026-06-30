import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      throw new Error('E-mail não fornecido.');
    }

    const holdingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const holdingServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(holdingUrl, holdingServiceKey);

    // 1. Verificar se o usuário já existe no Auth
    const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const existingUser = listData?.users?.find(u => u.email === email);

    if (!existingUser) {
      // Criar o usuário pela primeira vez (patrocinador antigo, sem acesso ainda)
      const tempPassword = 'Temp791!' + Math.random().toString(36).substring(2, 8) + '!';
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          role: 'sponsor'
        }
      });

      if (createError) {
        throw new Error(`Falha ao criar usuário no Auth: ${createError.message}`);
      }

      console.log(`[RESEND-INVITE] Usuário criado no Supabase Auth: ${newUser.user?.id}`);
    } else {
      console.log(`[RESEND-INVITE] Usuário já existe no Auth: ${existingUser.id}`);
    }

    // 2. Gerar link de ativação/recuperação de senha
    const origin = req.headers.get('origin') || 'https://admin.791solucoes.com.br';
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${origin}/login`
      }
    });

    if (linkError) {
      throw linkError;
    }

    return NextResponse.json({
      success: true,
      link: linkData?.properties?.action_link || null,
      message: 'Link de acesso gerado com sucesso!'
    });

  } catch (err: any) {
    console.error('[RESEND INVITE ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
