/**
 * /api/admin/rh
 * API de Gestão de RH da Holding:
 * - Funcionários (listar, criar, atualizar, excluir)
 * - Cargos e Níveis
 * - Batidas de Ponto
 */

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const tipo = url.searchParams.get('tipo') || 'funcionarios';

  try {
    if (tipo === 'cargos') {
      const { data, error } = await supabaseServer
        .from('rh_cargos')
        .select('*, niveis:rh_niveis_carreira(*)')
        .order('nome');
      if (error) throw error;
      return NextResponse.json({ cargos: data });
    }

    if (tipo === 'ponto') {
      const { data, error } = await supabaseServer
        .from('rh_ponto_registros')
        .select('*, funcionario:rh_funcionarios(nome, matricula)')
        .order('marcada_em', { ascending: false })
        .limit(100);
      if (error) throw error;
      return NextResponse.json({ pontos: data });
    }

    // Padrão: funcionários
    const { data, error } = await supabaseServer
      .from('rh_funcionarios')
      .select('*, cargo:rh_cargos(nome), setor:rh_pessoal_setores(nome)')
      .order('nome');

    if (error) throw error;
    return NextResponse.json({ funcionarios: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao buscar dados do RH.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json();
    const { acao } = body;

    if (acao === 'criar_cargo') {
      const { nome, setor, responsabilidades } = body;
      const { data, error } = await supabaseServer
        .from('rh_cargos')
        .insert({ nome, setor: setor || '', responsabilidades: responsabilidades || '' })
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ cargo: data });
    }

    if (acao === 'registrar_ponto') {
      const { funcionario_id, tipo, latitude, longitude, origem } = body;
      const { data, error } = await supabaseServer
        .from('rh_ponto_registros')
        .insert({
          funcionario_id,
          tipo: tipo || 'entrada',
          origem: origem || 'web',
          latitude: latitude || null,
          longitude: longitude || null,
        })
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ ponto: data });
    }

    // Criar funcionário
    const { nome, matricula, email, telefone, cargo_id, situacao } = body;
    const { data, error } = await supabaseServer
      .from('rh_funcionarios')
      .insert({
        nome,
        matricula,
        email: email || null,
        telefone: telefone || null,
        cargo_id: cargo_id || null,
        situacao: situacao || 'ativo',
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ funcionario: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao salvar registro de RH.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
