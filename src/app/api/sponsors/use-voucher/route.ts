import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const { code, vidracariaId } = await req.json();

    if (!code || !vidracariaId) {
      return NextResponse.json({ error: 'Código e ID da vidracaria são obrigatórios' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Buscar o voucher na Holding
    const { data: voucher, error: vError } = await supabase
      .from('vouchers')
      .select('*, patrocinadores(*)')
      .eq('codigo', code.toUpperCase())
      .single();

    if (vError || !voucher) {
      return NextResponse.json({ error: 'Token inválido ou não encontrado' }, { status: 404 });
    }

    if (voucher.usado_por_vidracaria_id) {
      return NextResponse.json({ error: 'Este token já foi utilizado' }, { status: 400 });
    }

    // 2. Verificar se o patrocinador está ativo
    if (voucher.patrocinadores?.status !== 'ativo') {
      return NextResponse.json({ error: 'O patrocínio vinculado a este token não está ativo' }, { status: 400 });
    }

    // 3. Marcar voucher como usado na Holding
    const { error: uError } = await supabase
      .from('vouchers')
      .update({
        usado_por_vidracaria_id: vidracariaId,
        data_uso: new Date().toISOString()
      })
      .eq('id', voucher.id);

    if (uError) throw uError;

    // 4. Vincular patrocinador na Vidraçaria (Banco Glass)
    const glassSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL!,
      process.env.SUPABASE_GLASS_SERVICE_ROLE_KEY!
    );

    const { error: gError } = await glassSupabase
      .from('vidracarias')
      .update({
        patrocinador_id: voucher.patrocinador_id
      })
      .eq('id', vidracariaId);

    if (gError) {
      console.error('Erro ao atualizar patrocinador no Glass:', gError);
      // Não damos throw aqui para não invalidar o uso do voucher na Holding, 
      // mas o ideal é que os dois bancos fiquem sincronizados.
    }

    return NextResponse.json({ 
      success: true, 
      patrocinador: voucher.patrocinadores.nome,
      patrocinadorId: voucher.patrocinador_id
    });

  } catch (err: any) {
    console.error('[USE VOUCHER ERROR]:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
