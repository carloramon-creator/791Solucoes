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

    const origin = 'https://admin.791solucoes.com.br';

    // Verificar se o usuário já existe no Auth
    const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const existingUser = listData?.users?.find(u => u.email === email);

    if (existingUser) {
      // Usuário já existe: gerar link de redefinição de senha e enviar por e-mail via Supabase
      console.log(`[RESEND-INVITE] Usuário já existe: ${existingUser.id}. Gerando link de recuperação...`);

      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${origin}/login` }
      });

      if (linkError) throw linkError;

      // Enviar o e-mail de acesso usando o template de recuperação do próprio Supabase Auth
      // O link já terá sido enviado via inviteUserByEmail, mas se precisar de reenvio usamos sendRawEmail
      // Alternativa simples: apenas retornar o link para o admin enviar manualmente se necessário
      return NextResponse.json({
        success: true,
        link: linkData?.properties?.action_link || null,
        message: 'Link de acesso gerado! Use o botão de copiar para enviar ao patrocinador.'
      });
    } else {
      // Novo usuário: enviar convite via Supabase (cria o usuário + envia e-mail automático)
      console.log(`[RESEND-INVITE] Usuário não existe. Enviando convite para ${email}...`);

      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        options: { redirectTo: `${origin}/login` },
        data: { role: 'sponsor' }
      } as any);

      if (inviteError) {
        // Fallback: criar usuário + gerar link manualmente
        console.warn('[RESEND-INVITE] inviteUserByEmail falhou, usando fallback:', inviteError.message);

        const tempPassword = 'Temp791!' + Math.random().toString(36).substring(2, 8) + '!';
        const { error: createError } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { role: 'sponsor' }
        });

        if (createError) throw new Error(`Falha ao criar usuário: ${createError.message}`);

        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: `${origin}/login` }
        });

        if (linkError) throw linkError;

        return NextResponse.json({
          success: true,
          link: linkData?.properties?.action_link || null,
          message: 'Usuário criado! Copie o link e envie ao patrocinador (SMTP indisponível no momento).'
        });
      }

      return NextResponse.json({
        success: true,
        link: null,
        message: `✅ Convite enviado com sucesso para ${email}! O patrocinador receberá o e-mail em instantes.`
      });
    }

  } catch (err: any) {
    console.error('[RESEND INVITE ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
