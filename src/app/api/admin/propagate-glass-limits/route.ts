import { NextRequest, NextResponse } from 'next/server';
import { getGlassClient } from '@/lib/glass-client';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

type PropagationMode = 'none' | 'default' | 'all';

type IaLimits = {
  iaEstoqueUsos: number | null;
  iaEstoquePeriodo: string | null;
  iaFinanceiroUsos: number | null;
  iaFinanceiroPeriodo: string | null;
  iaBalanceteUsos?: number | null;
  iaBalancetePeriodo?: string | null;
};

type Body = {
  mode: PropagationMode;
  plano?: 'padrao' | 'mini';
  nextLimits: {
    usersIncluded: number;
    wppDevices: number;
    wppMessages: number;
    mktMessages: number;
    extraMktMessagePrice: number;
    extraMessagePrice?: number;
  };
  iaLimits?: IaLimits | null;
  trialDias?: number | null;
  loadedLimits?: {
    usersIncluded: number;
    wppDevices: number;
    wppMessages: number;
  } | null;
};

const PERIODOS_IA = ['semana', 'mes'];
function normalizarCotaIa(usos: unknown, periodo: unknown): { limite: number | null; periodo: string | null } {
  const limite = Number(usos);
  const janela = typeof periodo === 'string' && PERIODOS_IA.includes(periodo) ? periodo : null;
  if (!Number.isFinite(limite) || limite < 0 || !janela) return { limite: null, periodo: null };
  return { limite: Math.floor(limite), periodo: janela };
}

export async function POST(request: NextRequest) {
  const auth = await authenticateHoldingAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await request.json()) as Body;
    const mode = body?.mode;

    if (!mode || !['none', 'default', 'all'].includes(mode)) {
      return NextResponse.json({ error: 'Modo de propagacao invalido.' }, { status: 400 });
    }

    if (mode === 'none') {
      return NextResponse.json({ updated: 0, scanned: 0 });
    }

    const nextUsersIncluded = Number(body?.nextLimits?.usersIncluded ?? 0);
    const nextWppDevices = Number(body?.nextLimits?.wppDevices ?? 0);
    const nextWppMessages = Number(body?.nextLimits?.wppMessages ?? 0);
    const nextMktMessages = Number(body?.nextLimits?.mktMessages ?? 0);
    const nextExtraMktPrice = Number(body?.nextLimits?.extraMktMessagePrice ?? 0);
    const nextExtraMessagePrice = body?.nextLimits?.extraMessagePrice;

    if (mode === 'default' && !body?.loadedLimits) {
      return NextResponse.json(
        { error: 'Nao foi possivel identificar os limites anteriores para aplicacao seletiva.' },
        { status: 400 }
      );
    }

    const glass = await getGlassClient();

    // Propagação restrita às vidracarias do plano editado (padrão quando não informado).
    const planoAlvo = body?.plano === 'mini' ? 'mini' : 'padrao';
    const cotaEstoque = normalizarCotaIa(body?.iaLimits?.iaEstoqueUsos, body?.iaLimits?.iaEstoquePeriodo);
    const cotaFinanceiro = normalizarCotaIa(body?.iaLimits?.iaFinanceiroUsos, body?.iaLimits?.iaFinanceiroPeriodo);
    const cotaBalancete = normalizarCotaIa(body?.iaLimits?.iaBalanceteUsos, body?.iaLimits?.iaBalancetePeriodo);

    const { data: tenants, error: tenantsError } = await glass
      .from('vidracarias')
      .select('id, plano_codigo, limite_usuarios, limite_usuarios_whats, limite_mensagens_whatsapp, limite_mensagens_marketing, valor_msg_marketing_excedente, ia_estoque_limite, ia_estoque_periodo, ia_financeiro_limite, ia_financeiro_periodo, ia_balancete_limite, ia_balancete_periodo');
    if (tenantsError) {
      return NextResponse.json({ error: tenantsError.message }, { status: 500 });
    }

    let updated = 0;
    const loaded = body.loadedLimits;

    for (const tenant of tenants || []) {
      if ((tenant.plano_codigo || 'padrao') !== planoAlvo) continue;
      const tenantUsers = tenant.limite_usuarios == null ? null : Number(tenant.limite_usuarios);
      const tenantWppDevices = tenant.limite_usuarios_whats == null ? null : Number(tenant.limite_usuarios_whats);
      const tenantWppMessages = tenant.limite_mensagens_whatsapp == null ? null : Number(tenant.limite_mensagens_whatsapp);

      const updatePayload: Record<string, number | string | null> = {};

      if (mode === 'all' || tenantUsers == null || tenantUsers === loaded!.usersIncluded) {
        updatePayload.limite_usuarios = nextUsersIncluded;
      }

      if (mode === 'all' || tenantWppDevices == null || tenantWppDevices === loaded!.wppDevices) {
        updatePayload.limite_usuarios_whats = nextWppDevices;
      }

      if (mode === 'all' || tenantWppMessages == null || tenantWppMessages === loaded!.wppMessages) {
        updatePayload.limite_mensagens_whatsapp = nextWppMessages;
      }

      if (mode === 'all' || tenant.limite_mensagens_marketing == null) {
        updatePayload.limite_mensagens_marketing = nextMktMessages;
      }

      if (mode === 'all' || tenant.valor_msg_marketing_excedente == null) {
        updatePayload.valor_msg_marketing_excedente = nextExtraMktPrice;
      }

      // Preço SAC vazio no tenant já segue o plano; só o modo "todos" sobrescreve preços personalizados.
      if (mode === 'all' && Number.isFinite(Number(nextExtraMessagePrice))) {
        updatePayload.valor_msg_whatsapp_excedente = Number(nextExtraMessagePrice);
      }

      // Cotas de IA: vazias no tenant seguem o plano; o modo "todos" realinha personalizações.
      if (body?.iaLimits) {
        if (mode === 'all' || tenant.ia_estoque_limite == null) {
          updatePayload.ia_estoque_limite = cotaEstoque.limite;
          updatePayload.ia_estoque_periodo = cotaEstoque.periodo;
        }
        if (mode === 'all' || tenant.ia_financeiro_limite == null) {
          updatePayload.ia_financeiro_limite = cotaFinanceiro.limite;
          updatePayload.ia_financeiro_periodo = cotaFinanceiro.periodo;
        }
        if (mode === 'all' || tenant.ia_balancete_limite == null) {
          updatePayload.ia_balancete_limite = cotaBalancete.limite;
          updatePayload.ia_balancete_periodo = cotaBalancete.periodo;
        }
      }
      
      if (Object.keys(updatePayload).length === 0) continue;

      const { data: updatedRows, error: syncError } = await glass
        .from('vidracarias')
        .update(updatePayload)
        .eq('id', tenant.id)
        .select('id');

      if (syncError) {
        return NextResponse.json({ error: syncError.message }, { status: 500 });
      }

      updated += updatedRows?.length || 0;
    }

    // Trials em andamento: no modo "todas", recalcula o fim do teste como cadastro + novos dias.
    // O trial é único e anterior à escolha de plano, então vale para todos os planos.
    let trialsAtualizados = 0;
    const trialDias = Number(body?.trialDias);
    if (mode === 'all' && Number.isFinite(trialDias) && trialDias >= 1 && trialDias <= 365) {
      const { data: emTrial, error: trialError } = await glass
        .from('vidracarias')
        .select('id, created_at')
        .eq('assinatura_confirmada', false);
      if (trialError) {
        return NextResponse.json({ error: trialError.message }, { status: 500 });
      }
      for (const tenant of emTrial || []) {
        const cadastro = new Date(tenant.created_at);
        if (Number.isNaN(cadastro.getTime())) continue;
        const fim = new Date(cadastro.getTime() + Math.trunc(trialDias) * 24 * 60 * 60 * 1000);
        const { error: trialUpdateError } = await glass
          .from('vidracarias')
          .update({ vencimento_assinatura: fim.toISOString().split('T')[0] })
          .eq('id', tenant.id)
          .eq('assinatura_confirmada', false);
        if (trialUpdateError) {
          return NextResponse.json({ error: trialUpdateError.message }, { status: 500 });
        }
        trialsAtualizados++;
      }
    }

    return NextResponse.json({
      updated,
      scanned: tenants?.length || 0,
      trialsAtualizados,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Falha ao propagar limites para vidracarias.' },
      { status: 500 }
    );
  }
}
