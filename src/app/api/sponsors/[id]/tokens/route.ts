import { randomInt, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authorizeSponsorManagement } from '@/lib/sponsor-management-auth';

function voucherCode(sponsorName: string) {
  const prefix = String(sponsorName || 'SPON').trim().toUpperCase().replace(/\s+/g, '').slice(0, 4) || 'SPON';
  const suffix = randomBytes(2).toString('hex').toUpperCase();
  return `791-${prefix}-${randomInt(1000, 10000)}-${suffix}`;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeSponsorManagement(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  try {
    const { id } = await params;
    const body = await req.json();
    const mode = body?.mode;
    if (mode !== 'sync' && mode !== 'single') {
      return NextResponse.json({ success: false, error: 'Modo de geração inválido.' }, { status: 400 });
    }

    const { data: sponsor, error: sponsorError } = await supabaseServer
      .from('patrocinadores')
      .select('id, nome, total_licencas')
      .eq('id', id)
      .maybeSingle();
    if (sponsorError) throw sponsorError;
    if (!sponsor) return NextResponse.json({ success: false, error: 'Patrocinador não encontrado.' }, { status: 404 });

    let count = 1;
    if (mode === 'sync') {
      const { count: existingCount, error: countError } = await supabaseServer
        .from('vouchers')
        .select('id', { count: 'exact', head: true })
        .eq('patrocinador_id', id);
      if (countError) throw countError;
      count = Math.max(0, Number(sponsor.total_licencas) - (existingCount || 0));
    }

    if (count === 0) return NextResponse.json({ success: true, created: 0, voucherCode: null });
    if (count > 1000) {
      return NextResponse.json({ success: false, error: 'A geração excede o limite de 1000 tokens por solicitação.' }, { status: 400 });
    }

    const vouchers = Array.from({ length: count }, () => ({
      codigo: voucherCode(sponsor.nome),
      patrocinador_id: id,
    }));
    const { data, error } = await supabaseServer
      .from('vouchers')
      .insert(vouchers)
      .select('codigo');
    if (error) throw error;

    return NextResponse.json({
      success: true,
      created: data?.length || 0,
      voucherCode: data?.[0]?.codigo || null,
    });
  } catch (error) {
    console.error('[SPONSOR TOKENS] Erro ao gerar tokens:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Erro ao gerar tokens.' }, { status: 500 });
  }
}
