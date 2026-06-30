import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const payload = await req.json();

    const holdingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const holdingServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(holdingUrl, holdingServiceKey);

    // 1. Criar ou Convidar Usuário via Supabase Auth
    // Isso usa o SMTP embutido do próprio Supabase para enviar um e-mail de Convite (Magic Link).
    let authId = null;
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(payload.email, {
      data: {
        role: 'sponsor',
        name: payload.nome
      }
    });

    if (authError) {
      if (authError.message.includes('already registered') || authError.message.includes('already been invited')) {
        console.log(`Usuário ${payload.email} já existe no Auth. Convite não enviado.`);
        // Procurar o id caso já exista
        const { data: searchUser } = await supabaseAdmin.auth.admin.listUsers();
        const existing = searchUser.users.find(u => u.email === payload.email);
        if (existing) authId = existing.id;
      } else {
         throw authError;
      }
    } else {
      authId = authData?.user?.id;
      console.log(`[SUPABASE] Convite enviado automaticamente para ${payload.email}`);
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
      message: 'Patrocinador criado e convite enviado via Supabase!'
    });

  } catch (err: any) {
    console.error('[SPONSOR CREATE ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
