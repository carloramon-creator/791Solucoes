/**
 * /api/admin/rh
 * API de Gestão de RH da Holding:
 * - Funcionários (listar, criar, atualizar, excluir)
 * - Cargos e Níveis
 * - Batidas de Ponto
 * - Escalas e Turnos
 * - Folha de Pagamento / Banco de Horas
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
      return NextResponse.json({ cargos: data || [] });
    }

    if (tipo === 'escalas') {
      const { data, error } = await supabaseServer
        .from('rh_escalas')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return NextResponse.json({ escalas: data || [] });
    }

    if (tipo === 'folha') {
      const mes = url.searchParams.get('mes') || new Date().toISOString().slice(0, 7);
      
      // Busca funcionários e banco de horas correspondente ao mês
      const [funcRes, bancoRes] = await Promise.all([
        supabaseServer.from('rh_funcionarios').select('*, cargo:rh_cargos(nome)'),
        supabaseServer.from('rh_banco_horas').select('*').eq('mes_referencia', mes)
      ]);

      if (funcRes.error) throw funcRes.error;

      return NextResponse.json({
        competencia: mes,
        funcionarios: funcRes.data || [],
        bancoHoras: bancoRes.data || []
      });
    }

    if (tipo === 'ponto') {
      const { data, error } = await supabaseServer
        .from('rh_ponto_registros')
        .select('*, funcionario:rh_funcionarios(nome, matricula)')
        .order('marcada_em', { ascending: false })
        .limit(100);
      if (error) throw error;
      return NextResponse.json({ pontos: data || [] });
    }

    // Padrão: funcionários
    const { data, error } = await supabaseServer
      .from('rh_funcionarios')
      .select('*, cargo:rh_cargos(nome), setor:rh_pessoal_setores(nome)')
      .order('nome');

    if (error) throw error;
    return NextResponse.json({ funcionarios: data || [] });
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

    if (acao === 'criar_escala') {
      const { nome, tipo, jornada_diaria_minutos, dias_trabalho } = body;
      const { data, error } = await supabaseServer
        .from('rh_escalas')
        .insert({
          nome,
          tipo: tipo || '5x2',
          jornada_diaria_minutos: Number(jornada_diaria_minutos) || 480,
          dias_trabalho: dias_trabalho || ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'],
          ativo: true
        })
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ escala: data });
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

    if (acao === 'fechar_banco_horas') {
      const { funcionario_id, mes_referencia, saldo_minutos, horas_trabalhadas_minutos, horas_esperadas_minutos } = body;
      const { data, error } = await supabaseServer
        .from('rh_banco_horas')
        .upsert({
          funcionario_id,
          mes_referencia,
          saldo_minutos: saldo_minutos || 0,
          horas_trabalhadas_minutos: horas_trabalhadas_minutos || 0,
          horas_esperadas_minutos: horas_esperadas_minutos || 0,
          fechado: true,
          fechado_em: new Date().toISOString()
        })
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ banco_horas: data });
    }

    // Criar funcionário
    const { nome, matricula, email, telefone, cargo_id, situacao, cpf, admissao } = body;
    const { data, error } = await supabaseServer
      .from('rh_funcionarios')
      .insert({
        nome,
        matricula,
        cpf: cpf || null,
        email: email || null,
        telefone: telefone || null,
        cargo_id: cargo_id || null,
        admissao: admissao || new Date().toISOString().slice(0, 10),
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
