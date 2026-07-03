import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function generateVoucherCode(sponsorName: string) {
  const base = String(sponsorName || 'SPON').trim().toUpperCase().replace(/\s+/g, '');
  const prefix = (base || 'SPON').slice(0, 4);
  const random = Math.floor(1000 + Math.random() * 9000);
  const suffix = Math.random().toString(36).substring(2, 4).toUpperCase();
  return `791-${prefix}-${random}-${suffix}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sponsorId = String(body?.sponsorId || '');
    const tokenId = String(body?.tokenId || '');

    if (!sponsorId || !tokenId) {
      return NextResponse.json({ success: false, error: 'sponsorId e tokenId são obrigatórios.' }, { status: 400 });
    }

    const holdingSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const glassSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL!,
      process.env.SUPABASE_GLASS_SERVICE_ROLE_KEY!
    );

    const { data: sponsor, error: sponsorError } = await holdingSupabase
      .from('patrocinadores')
      .select('id, nome')
      .eq('id', sponsorId)
      .single();

    if (sponsorError || !sponsor) {
      return NextResponse.json({ success: false, error: 'Patrocinador não encontrado.' }, { status: 404 });
    }

    const { data: token, error: tokenError } = await holdingSupabase
      .from('vouchers')
      .select('id, codigo, patrocinador_id, usado_por_vidracaria_id')
      .eq('id', tokenId)
      .single();

    if (tokenError || !token) {
      return NextResponse.json({ success: false, error: 'Token não encontrado.' }, { status: 404 });
    }

    if (String(token.patrocinador_id || '') !== sponsorId) {
      return NextResponse.json({ success: false, error: 'Token não pertence a este patrocinador.' }, { status: 403 });
    }

    const vidracariaId = token.usado_por_vidracaria_id ? String(token.usado_por_vidracaria_id) : '';

    if (vidracariaId) {
      const { error: unlinkError } = await glassSupabase
        .from('vidracarias')
        .update({ patrocinador_id: null })
        .eq('id', vidracariaId);

      if (unlinkError) {
        console.error('[SPONSOR TOKEN REVOKE] Erro ao desvincular vidraçaria no Glass:', unlinkError.message);
      }
    }

    const { error: deleteTokenError } = await holdingSupabase
      .from('vouchers')
      .delete()
      .eq('id', token.id)
      .eq('patrocinador_id', sponsorId);

    if (deleteTokenError) {
      throw deleteTokenError;
    }

    const newVoucherCode = generateVoucherCode(sponsor.nome || 'SPON');

    const { data: newVoucher, error: newVoucherError } = await holdingSupabase
      .from('vouchers')
      .insert({
        codigo: newVoucherCode,
        patrocinador_id: sponsorId,
      })
      .select('id, codigo, created_at')
      .single();

    if (newVoucherError) {
      throw newVoucherError;
    }

    return NextResponse.json({
      success: true,
      removedTokenId: token.id,
      removedVidracariaId: vidracariaId || null,
      newToken: newVoucher,
    });
  } catch (err: any) {
    console.error('[SPONSOR TOKEN REVOKE ERROR]', err?.message || err);
    return NextResponse.json({ success: false, error: err?.message || 'Falha ao revogar token.' }, { status: 500 });
  }
}
