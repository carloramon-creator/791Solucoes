import { randomBytes, randomInt } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeSponsorManagement, findHoldingAuthUserByEmail } from '@/lib/sponsor-management-auth';

export async function POST(req: Request) {
  const auth = await authorizeSponsorManagement(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  try {
    const payload = await req.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json({ success: false, error: 'Dados do patrocinador inválidos.' }, { status: 400 });
    }
    const nome = String(payload?.nome || '').trim();
    const email = String(payload?.email || '').trim().toLowerCase();
    const totalLicencas = Number(payload?.total_licencas);
    const valorMensal = Number(payload?.valor_mensal);
    if (!nome || nome.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, error: 'Nome ou e-mail do patrocinador inválido.' }, { status: 400 });
    }
    if (!Number.isInteger(totalLicencas) || totalLicencas < 1 || totalLicencas > 1000) {
      return NextResponse.json({ success: false, error: 'A quantidade de licenças deve ser um inteiro entre 1 e 1000.' }, { status: 400 });
    }
    if (!Number.isFinite(valorMensal) || valorMensal < 0) {
      return NextResponse.json({ success: false, error: 'Valor mensal inválido.' }, { status: 400 });
    }

    const holdingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const holdingServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(holdingUrl, holdingServiceKey);

    const { data: duplicateSponsor, error: duplicateError } = await supabaseAdmin
      .from('patrocinadores')
      .select('id')
      .ilike('email', email)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicateSponsor) {
      return NextResponse.json({ success: false, error: 'Já existe um patrocinador cadastrado com este e-mail.' }, { status: 409 });
    }

    const origin = 'https://admin.791solucoes.com.br/set-password';
    let authId = null;
    let inviteLink = null;
    let createdAuthUserId: string | null = null;

    // 1. Convidar Usuário via Supabase Auth (Envia e-mail automático via SMTP)
    try {
      console.log(`[SPONSOR CREATE] Enviando convite para ${email}...`);
      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        email,
        {
          redirectTo: origin,
          data: {
            role: 'sponsor',
            name: nome
          }
        }
      );

      if (inviteError) throw inviteError;
      
      authId = inviteData?.user?.id;
      createdAuthUserId = authId;
      if (authId) {
        const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(authId, {
          app_metadata: { ...(inviteData.user?.app_metadata || {}), role: 'sponsor' }
        });
        if (metadataError) throw metadataError;
      }
      console.log(`[SPONSOR CREATE] Convite enviado via SMTP com ID: ${authId}`);
    } catch (err: any) {
      console.warn('[SPONSOR CREATE] Falha no convite direto, tentando criar acesso manual:', err.message);

      // Fallback: Criar usuário manualmente sem e-mail e gerar link para copiar
      const tempPassword = `Temp791!${randomBytes(18).toString('base64url')}!`;
      const existing = await findHoldingAuthUserByEmail(email);
      if (existing) {
        if (existing.app_metadata?.role !== 'sponsor' && existing.user_metadata?.role !== 'sponsor') {
          return NextResponse.json({ success: false, error: 'Este e-mail já pertence a uma conta que não é de patrocinador.' }, { status: 409 });
        }
        authId = existing.id;
        const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
          app_metadata: { ...existing.app_metadata, role: 'sponsor' }
        });
        if (metadataError) throw metadataError;
      } else {
        const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          app_metadata: { role: 'sponsor' },
          user_metadata: {
            role: 'sponsor',
            name: nome
          }
        });
        if (createError) throw createError;
        authId = authData?.user?.id;
        createdAuthUserId = authId;
      }

      // Gerar o link de recuperação manualmente para copiar
      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: origin }
      });
      if (linkError) throw linkError;
      inviteLink = linkData?.properties?.action_link || null;
    }

    // 2. Inserir Patrocinador no Banco
    const slug = nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

    const sponsorToInsert = {
      nome,
      razao_social: String(payload.razao_social || '').trim() || null,
      email,
      cpf_cnpj: String(payload.cpf_cnpj || '').replace(/\D/g, ''),
      telefone: String(payload.telefone || '').replace(/\D/g, ''),
      nome_responsavel: String(payload.nome_responsavel || '').trim() || null,
      endereco: String(payload.endereco || '').trim() || null,
      numero: String(payload.numero || '').trim() || null,
      bairro: String(payload.bairro || '').trim() || null,
      cidade: String(payload.cidade || '').trim() || null,
      estado: String(payload.estado || '').trim().toUpperCase() || null,
      cep: String(payload.cep || '').replace(/\D/g, ''),
      total_licencas: totalLicencas,
      valor_mensal: valorMensal,
      ciclo: String(payload.ciclo || 'MONTHLY'),
      slug,
      status: 'ativo'
    };
    
    const { data: sponsor, error: sponsorError } = await supabaseAdmin
      .from('patrocinadores')
      .insert([sponsorToInsert])
      .select()
      .single();

    if (sponsorError) {
      if (createdAuthUserId) await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId);
      throw sponsorError;
    }

    // 3. Gerar Tokens Iniciais
    const prefix = nome.substring(0, 4).toUpperCase().replace(/\s/g, '');
    const vouchersToInsert = Array.from({ length: totalLicencas }, () => {
      const random = randomInt(1000, 10000);
      const suffix = randomBytes(2).toString('hex').toUpperCase();
      return {
        codigo: `791-${prefix}-${random}-${suffix}`,
        patrocinador_id: sponsor.id
      };
    });

    if (vouchersToInsert.length > 0) {
      const { error: vouchersError } = await supabaseAdmin.from('vouchers').insert(vouchersToInsert);
      if (vouchersError) {
        await supabaseAdmin.from('patrocinadores').delete().eq('id', sponsor.id);
        if (createdAuthUserId) await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId);
        throw vouchersError;
      }
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
