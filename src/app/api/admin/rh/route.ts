/**
 * /api/admin/rh
 * API de Gestão de RH da Holding:
 * - Sincronização automática com equipe_791 (Configurações / Usuários)
 * - Funcionários (listar, criar, atualizar, excluir)
 * - Cargos e Níveis
 * - Batidas de Ponto
 * - Escalas e Turnos
 * - Folha de Pagamento Oficial (CLT / eSocial)
 */

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { processarFolhaColaborador, arredondar, PARAMETROS_LEGAIS_PADRAO } from '@/lib/folha-pagamento';

export const dynamic = 'force-dynamic';

async function syncEquipeComRH() {
  try {
    // 1. Busca todos da equipe_791
    const { data: equipe } = await supabaseServer.from('equipe_791').select('*');
    if (!equipe || equipe.length === 0) return;

    // 2. Busca cargos existentes em rh_cargos
    const { data: cargosExistentes } = await supabaseServer.from('rh_cargos').select('id, nome');
    const mapaCargos = new Map<string, string>();
    (cargosExistentes || []).forEach(c => mapaCargos.set(c.nome.toLowerCase().trim(), c.id));

    // 3. Garante que os cargos mencionados na equipe existam em rh_cargos
    for (const mem of equipe) {
      const cargoNome = (mem.cargo || 'Colaborador').trim();
      if (cargoNome && !mapaCargos.has(cargoNome.toLowerCase())) {
        const { data: novoCargo } = await supabaseServer
          .from('rh_cargos')
          .insert({ nome: cargoNome, setor: 'Geral', responsabilidades: `Atribuições do cargo de ${cargoNome}` })
          .select('id, nome')
          .single();
        if (novoCargo) {
          mapaCargos.set(novoCargo.nome.toLowerCase().trim(), novoCargo.id);
        }
      }
    }

    // 4. Busca funcionários já cadastrados em rh_funcionarios
    const { data: funcAtuais } = await supabaseServer.from('rh_funcionarios').select('id, email, matricula, cargo_id');
    const mapaFuncPorEmail = new Map<string, any>();
    (funcAtuais || []).forEach(f => mapaFuncPorEmail.set((f.email || '').toLowerCase().trim(), f));

    // 5. Insere ou atualiza quem estiver na equipe_791
    let seq = (funcAtuais?.length || 0) + 1;
    for (const mem of equipe) {
      const email = (mem.email || '').toLowerCase().trim();
      if (!email) continue;
      const cargoNome = (mem.cargo || '').toLowerCase().trim();
      const cargoId = mapaCargos.get(cargoNome) || null;

      const jaExiste = mapaFuncPorEmail.get(email);
      const salarioBase = Number(mem.salario_mensal) || 0;

      if (!jaExiste) {
        const matricula = String(seq++).padStart(3, '0');
        await supabaseServer.from('rh_funcionarios').insert({
          nome: mem.nome || email.split('@')[0],
          email,
          cpf: mem.cpf || null,
          telefone: mem.whatsapp || null,
          matricula,
          cargo_id: cargoId,
          admissao: mem.periodo_trabalho_inicio || mem.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
          situacao: 'ativo',
          dados_bancarios: { salario_base: salarioBase, foto_path: mem.foto_path || null }
        });
      } else {
        await supabaseServer.from('rh_funcionarios').update({
          nome: mem.nome || jaExiste.nome,
          cpf: mem.cpf || null,
          telefone: mem.whatsapp || null,
          cargo_id: cargoId || jaExiste.cargo_id,
          dados_bancarios: { salario_base: salarioBase, foto_path: mem.foto_path || null }
        }).eq('id', jaExiste.id);
      }
    }
  } catch (err) {
    console.error('Erro na sincronização equipe -> RH:', err);
  }
}

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
      await syncEquipeComRH();
      const mes = url.searchParams.get('mes') || new Date().toISOString().slice(0, 7);

      const { data: funcionarios, error } = await supabaseServer
        .from('rh_funcionarios')
        .select('*, cargo:rh_cargos(nome)')
        .order('nome');

      if (error) throw error;

      // Processa a folha oficial com deduções legais progressivas para cada colaborador
      const demonstrativo = (funcionarios || []).map(f => {
        const salario = Number(f.dados_bancarios?.salario_base) || 3500;
        return processarFolhaColaborador({
          id: f.id,
          nome: f.nome,
          matricula: f.matricula,
          cargo: f.cargo?.nome || 'Colaborador',
          cpf: f.cpf || '',
          admissao: f.admissao || '',
          salario
        });
      });

      const totais = {
        totalColaboradores: demonstrativo.length,
        totalProventos: arredondar(demonstrativo.reduce((acc, d) => acc + d.totalProventos, 0)),
        totalDescontos: arredondar(demonstrativo.reduce((acc, d) => acc + d.totalDescontos, 0)),
        totalLiquido: arredondar(demonstrativo.reduce((acc, d) => acc + d.salarioLiquido, 0)),
        totalInss: arredondar(demonstrativo.reduce((acc, d) => acc + d.inss, 0)),
        totalIrrf: arredondar(demonstrativo.reduce((acc, d) => acc + d.irrf, 0)),
        totalFgts: arredondar(demonstrativo.reduce((acc, d) => acc + d.fgts, 0))
      };

      return NextResponse.json({
        competencia: mes,
        demonstrativo,
        totais,
        parametros: PARAMETROS_LEGAIS_PADRAO
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

    // Padrão: funcionários (sincroniza com equipe_791)
    await syncEquipeComRH();

    const { data, error } = await supabaseServer
      .from('rh_funcionarios')
      .select('*, cargo:rh_cargos(nome), setor:rh_pessoal_setores(nome)')
      .order('matricula');

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
