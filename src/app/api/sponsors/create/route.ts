import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const payload = await req.json();

    const holdingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const holdingServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(holdingUrl, holdingServiceKey);

    // 1. Criar Usuário via Supabase Auth
    // Para evitar erros de SMTP embutido do Supabase, criamos o usuário e geramos o link de definição de senha (recovery) manualmente.
    let authId = null;
    let inviteLink = null;
    
    // Senha aleatória temporária segura
    const tempPassword = 'Temp791!' + Math.random().toString(36).substring(2, 8) + '!';

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: payload.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        role: 'sponsor',
        name: payload.nome
      }
    });

    if (authError) {
      if (authError.message.includes('already exists') || authError.message.includes('already registered') || authError.message.includes('already been invited')) {
        console.log(`Usuário ${payload.email} já existe no Auth.`);
        // Procurar o id caso já exista
        const { data: searchUser } = await supabaseAdmin.auth.admin.listUsers();
        const existing = searchUser.users.find(u => u.email === payload.email);
        if (existing) authId = existing.id;
      } else {
         throw authError;
      }
    } else {
      authId = authData?.user?.id;
      console.log(`[SUPABASE] Usuário de autenticação criado para ${payload.email}`);
    }

    // Gerar link de recuperação de senha (funciona como link de ativação/primeiro acesso)
    try {
      const origin = req.headers.get('origin') || 'http://localhost:3000';
      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email: payload.email,
        redirectTo: `${origin}/login`
      });

      if (!linkError && linkData?.properties?.action_link) {
        inviteLink = linkData.properties.action_link;
      }
    } catch (linkErr) {
      console.error('Erro ao gerar link de convite:', linkErr);
    }

    // 2. Inserir Patrocinador
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
      message: 'Patrocinador criado e link de ativação gerado!'
    });

  } catch (err: any) {
    console.error('[SPONSOR CREATE ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
