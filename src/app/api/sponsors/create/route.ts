import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

export async function POST(req: Request) {
  try {
    const payload = await req.json();

    const holdingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const holdingServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(holdingUrl, holdingServiceKey);

    // 1. Gerar senha aleatória forte
    const password = Math.random().toString(36).slice(-6) + Math.random().toString(36).slice(-6).toUpperCase() + "791!";

    // 2. Criar ou Obter Usuário no Supabase Auth
    let authId = null;
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: payload.email,
      password: password,
      email_confirm: true,
      user_metadata: {
        role: 'sponsor',
        name: payload.nome
      }
    });

    if (authError) {
      if (authError.message.includes('already registered')) {
        console.log(`Usuário ${payload.email} já existe no Auth. Não enviaremos e-mail com senha nova.`);
        // Procurar o id caso já exista
        const { data: searchUser } = await supabaseAdmin.auth.admin.listUsers();
        const existing = searchUser.users.find(u => u.email === payload.email);
        if (existing) authId = existing.id;
      } else {
         throw authError;
      }
    } else {
      authId = authData?.user?.id;
    }

    // 3. Inserir Patrocinador
    const slug = payload.nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

    const sponsorToInsert: any = {
      ...payload,
      slug,
      status: 'ativo'
    };
    
    // Tentar adicionar auth_id se a coluna existir, caso contrário falhará, então é melhor associar pelo e-mail se possível
    // Vou omitir auth_id para evitar crash caso não exista a coluna. A busca no portal será pelo e-mail.

    const { data: sponsor, error: sponsorError } = await supabaseAdmin
      .from('patrocinadores')
      .insert([sponsorToInsert])
      .select()
      .single();

    if (sponsorError) throw sponsorError;

    // 4. Gerar Tokens Iniciais
    const prefix = payload.nome.substring(0, 4).toUpperCase().replace(/\s/g, '');
    const vouchersToInsert = Array.from({ length: payload.total_licencas }, () => {
      const random = Math.floor(1000 + Math.random() * 9000);
      const suffix = Math.random().toString(36).substring(2, 4).toUpperCase();
      return {
        codigo: `791-${prefix}-${random}-${suffix}`,
        patrocinador_id: sponsor.id
      };
    });

    if (vouchersToInsert.length > 0) {
      await supabaseAdmin.from('vouchers').insert(vouchersToInsert);
    }

    // 5. Enviar E-mail (somente se foi criado agora)
    if (!authError) {
      const smtpHost = process.env.SMTP_HOST;
      const smtpPort = process.env.SMTP_PORT;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;

      if (smtpHost && smtpUser && smtpPass) {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: Number(smtpPort) || 587,
          secure: Number(smtpPort) === 465,
          auth: {
            user: smtpUser,
            pass: smtpPass
          }
        });

        const mailOptions = {
          from: `"791 Soluções" <${smtpUser}>`,
          to: payload.email,
          subject: 'Bem-vindo ao Portal de Patrocinadores 791',
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
              <h2 style="color: #3b597b;">Bem-vindo ao Portal de Patrocinadores 791!</h2>
              <p>Olá ${payload.nome_responsavel || payload.nome},</p>
              <p>Sua conta como Patrocinador foi criada com sucesso. Abaixo estão suas credenciais exclusivas de acesso ao Portal de Licenciamento.</p>
              <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e2e8f0;">
                <p style="margin: 0 0 10px 0;"><strong>Login:</strong> ${payload.email}</p>
                <p style="margin: 0;"><strong>Senha:</strong> <span style="font-family: monospace; font-size: 16px;">${password}</span></p>
              </div>
              <p>Acesse o portal e comece a distribuir suas licenças patrocinadas copiando a URL abaixo no seu navegador:</p>
              <a href="https://admin.791solucoes.com.br/login" style="display: inline-block; padding: 12px 24px; background-color: #3b597b; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">Acessar Meu Portal</a>
              <p style="margin-top: 30px; font-size: 12px; color: #999; text-align: center;">Esta é uma mensagem automática, não responda a este e-mail.</p>
            </div>
          `
        };

        try {
          await transporter.sendMail(mailOptions);
          console.log(`[EMAIL ENVIADO] Senha para ${payload.email}`);
        } catch (mailErr) {
          console.error('[ERRO SMTP]', mailErr);
        }
      } else {
        console.warn("SMTP não configurado em .env.local (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS).");
        console.warn(`[SENHA GERADA PARA ${payload.email}]: ${password}`);
      }
    }

    return NextResponse.json({
      success: true,
      sponsor,
      voucherCode: vouchersToInsert.length > 0 ? vouchersToInsert[0].codigo : null,
      password: authError ? null : password
    });

  } catch (err: any) {
    console.error('[SPONSOR CREATE ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
