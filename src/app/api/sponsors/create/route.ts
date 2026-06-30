import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const payload = await req.json();

    const holdingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const holdingServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(holdingUrl, holdingServiceKey);

    const origin = 'https://admin.791solucoes.com.br';
    let authId = null;
    let inviteLink = null;

    // 1. Convidar Usuário via Supabase Auth (Envia e-mail automático via SMTP)
    try {
      console.log(`[SPONSOR CREATE] Enviando convite para ${payload.email}...`);
      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        payload.email,
        {
          redirectTo: `${origin}/login`,
          data: {
            role: 'sponsor',
            name: payload.nome
          }
        }
      );

      if (inviteError) throw inviteError;
      
      authId = inviteData?.user?.id;
      console.log(`[SPONSOR CREATE] Convite enviado via SMTP com ID: ${authId}`);
    } catch (err: any) {
      console.warn('[SPONSOR CREATE] Falha no convite direto (SMTP/Geral), usando fallback de criação manual:', err.message);

      // Fallback: Criar usuário manualmente sem e-mail e gerar link para copiar
      const tempPassword = 'Temp791!' + Math.random().toString(36).substring(2, 8) + '!';
      const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: payload.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          role: 'sponsor',
          name: payload.nome
        }
      });

      if (createError) {
        if (createError.message.includes('already')) {
          const { data: searchUser } = await supabaseAdmin.auth.admin.listUsers();
          const existing = searchUser.users.find(u => u.email === payload.email);
          if (existing) authId = existing.id;
        } else {
          throw createError;
        }
      } else {
        authId = authData?.user?.id;
      }

      // Gerar o link de recuperação manualmente para copiar
      try {
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email: payload.email,
          options: {
            redirectTo: `${origin}/login`
          }
        });

        if (!linkError && linkData?.properties?.action_link) {
          inviteLink = linkData.properties.action_link;
        }
      } catch (linkErr) {
        console.error('Erro ao gerar link de fallback:', linkErr);
      }
    }

    // 2. Inserir Patrocinador no Banco
    const slug = payload.nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

    const sponsorToInsert: any = {
      ...payload,
      slug,
      status: 'ativo'
    };
    
    const { data: sponsor, error: sponsorError } = await supabaseAdmin
      .from('patrocinadores')
      .insert([sponsorToInsert])
      .select()
      .single();

    if (sponsorError) throw sponsorError;

    // 3. Gerar Tokens Iniciais
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

    return NextResponse.json({
      success: true,
      sponsor,
      voucherCode: vouchersToInsert.length > 0 ? vouchersToInsert[0].codigo : null,
      inviteLink,
      message: inviteLink 
        ? 'Patrocinador criado! Copie o link abaixo para enviar manualmente.'
        : 'Patrocinador criado e e-mail de acesso enviado com sucesso!'
    });

  } catch (err: any) {
    console.error('[SPONSOR CREATE ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
