import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { userCanAccessResource } from '@/lib/holding-permissions';
import { getGlassClient } from '@/lib/glass-client';

// Regras de ST por NCM x UF, globais para todos os tenants do 791glass.
// Só regras "verificadas" e vigentes são usadas pelo motor fiscal do Glass.

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const CAMPOS = 'id, ncm_prefixo, cest, uf, sujeito_st, mva_original, fonte_legal, vigencia_inicio, vigencia_fim, verificada, verificada_em, verificada_por, atualizada_por, observacao, created_at, updated_at';

type Regra = {
  id: string;
  ncm_prefixo: string;
  uf: string;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  verificada: boolean;
};

async function autorizar(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores não podem editar regras fiscais.');
  if (!auth.ok) return auth;
  if (!(await userCanAccessResource(auth.user.email, 'menu.configuracoes'))) {
    return { ok: false as const, status: 403, error: 'Sem permissão para configurações.' };
  }
  return auth;
}

const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const dataValida = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

function validar(body: Record<string, unknown>) {
  const erros: string[] = [];
  const ncm = digitos(body.ncm_prefixo);
  if (ncm.length < 2 || ncm.length > 8) erros.push('NCM (ou prefixo) deve ter de 2 a 8 dígitos.');
  const uf = String(body.uf ?? '').toUpperCase();
  if (!UFS.includes(uf)) erros.push('UF inválida.');
  if (typeof body.sujeito_st !== 'boolean') erros.push('Informe se há ST (sim/não).');
  const cest = digitos(body.cest);
  if (cest && cest.length !== 7) erros.push('CEST deve ter 7 dígitos.');
  const mvaRaw = body.mva_original;
  const mva = mvaRaw === null || mvaRaw === undefined || mvaRaw === '' ? null : Number(String(mvaRaw).replace(',', '.'));
  if (mva !== null && !(mva >= 0 && mva <= 999)) erros.push('MVA deve estar entre 0 e 999%.');
  if (body.sujeito_st === true && mva === null) erros.push('Com ST, informe a MVA original.');
  const fonte = String(body.fonte_legal ?? '').trim();
  if (fonte.length < 5) erros.push('Informe a fonte legal (ex.: RICMS/SC, Anexo 3, Seção ...).');
  if (!dataValida(body.vigencia_inicio)) erros.push('Início da vigência inválido.');
  const fim = body.vigencia_fim ? String(body.vigencia_fim) : null;
  if (fim && !dataValida(fim)) erros.push('Fim da vigência inválido.');
  if (fim && dataValida(body.vigencia_inicio) && fim < String(body.vigencia_inicio)) erros.push('Fim da vigência antes do início.');
  return {
    erros,
    dados: {
      ncm_prefixo: ncm,
      uf,
      sujeito_st: body.sujeito_st as boolean,
      cest: cest || null,
      mva_original: mva,
      fonte_legal: fonte,
      vigencia_inicio: String(body.vigencia_inicio),
      vigencia_fim: fim,
      observacao: String(body.observacao ?? '').trim() || null,
    },
  };
}

async function conflito(glass: Awaited<ReturnType<typeof getGlassClient>>, d: { ncm_prefixo: string; uf: string; vigencia_inicio: string; vigencia_fim: string | null }, ignorarId?: string) {
  const { data } = await glass
    .from('fiscal_regras_st')
    .select('id, vigencia_inicio, vigencia_fim')
    .eq('ncm_prefixo', d.ncm_prefixo)
    .eq('uf', d.uf);
  const fim = d.vigencia_fim ?? '9999-12-31';
  return (data || []).some((r: { id: string; vigencia_inicio: string; vigencia_fim: string | null }) =>
    r.id !== ignorarId && r.vigencia_inicio <= fim && (r.vigencia_fim ?? '9999-12-31') >= d.vigencia_inicio);
}

export async function GET(req: Request) {
  const auth = await autorizar(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const glass = await getGlassClient();
    const [{ data: regras, error }, { data: tenants }] = await Promise.all([
      glass.from('fiscal_regras_st').select(CAMPOS).order('uf').order('ncm_prefixo').order('vigencia_inicio', { ascending: false }),
      glass.from('vidracarias').select('estado, ativa'),
    ]);
    if (error) throw error;
    const tenantsPorUf: Record<string, number> = {};
    for (const t of tenants || []) {
      const uf = String(t.estado ?? '').toUpperCase().trim();
      if (t.ativa !== false && UFS.includes(uf)) tenantsPorUf[uf] = (tenantsPorUf[uf] || 0) + 1;
    }
    return NextResponse.json({ regras: regras || [], tenantsPorUf, ufs: UFS });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Falha ao carregar regras.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await autorizar(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  const { erros, dados } = validar(body);
  if (erros.length) return NextResponse.json({ error: erros.join(' ') }, { status: 400 });
  try {
    const glass = await getGlassClient();
    if (await conflito(glass, dados)) {
      return NextResponse.json({ error: 'Já existe regra para esse NCM/UF com vigência sobreposta. Encerre a anterior antes.' }, { status: 409 });
    }
    const { data, error } = await glass
      .from('fiscal_regras_st')
      .insert({ ...dados, verificada: false, atualizada_por: auth.user.email })
      .select(CAMPOS)
      .single();
    if (error) throw error;
    return NextResponse.json({ regra: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 500 });
  }
}

// acao: 'editar' (volta para não conferida), 'verificar', 'desverificar', 'encerrar'
export async function PUT(req: Request) {
  const auth = await autorizar(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => null);
  const id = body?.id ? String(body.id) : '';
  if (!id) return NextResponse.json({ error: 'Regra não informada.' }, { status: 400 });
  try {
    const glass = await getGlassClient();
    const { data: atual } = await glass.from('fiscal_regras_st').select(CAMPOS).eq('id', id).maybeSingle<Regra>();
    if (!atual) return NextResponse.json({ error: 'Regra não encontrada.' }, { status: 404 });
    const agora = new Date().toISOString();
    let update: Record<string, unknown>;

    switch (body.acao) {
      case 'verificar':
        update = { verificada: true, verificada_em: agora, verificada_por: auth.user.email };
        break;
      case 'desverificar':
        update = { verificada: false, verificada_em: null, verificada_por: null };
        break;
      case 'encerrar': {
        const fim = String(body.vigencia_fim ?? '');
        if (!dataValida(fim) || fim < atual.vigencia_inicio) {
          return NextResponse.json({ error: 'Data de encerramento inválida ou anterior ao início.' }, { status: 400 });
        }
        update = { vigencia_fim: fim };
        break;
      }
      case 'editar': {
        const { erros, dados } = validar(body);
        if (erros.length) return NextResponse.json({ error: erros.join(' ') }, { status: 400 });
        if (await conflito(glass, dados, id)) {
          return NextResponse.json({ error: 'Vigência sobreposta com outra regra do mesmo NCM/UF.' }, { status: 409 });
        }
        // Qualquer alteração de conteúdo exige nova conferência.
        update = { ...dados, verificada: false, verificada_em: null, verificada_por: null };
        break;
      }
      default:
        return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
    }

    const { data, error } = await glass
      .from('fiscal_regras_st')
      .update({ ...update, atualizada_por: auth.user.email, updated_at: agora })
      .eq('id', id)
      .select(CAMPOS)
      .single();
    if (error) throw error;
    return NextResponse.json({ regra: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Falha ao atualizar.' }, { status: 500 });
  }
}

// Só regras não conferidas podem ser apagadas; as conferidas são encerradas para manter o histórico.
export async function DELETE(req: Request) {
  const auth = await autorizar(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!id) return NextResponse.json({ error: 'Regra não informada.' }, { status: 400 });
  try {
    const glass = await getGlassClient();
    const { data, error } = await glass.from('fiscal_regras_st').delete().eq('id', id).eq('verificada', false).select('id');
    if (error) throw error;
    if (!data?.length) return NextResponse.json({ error: 'Regra conferida não pode ser apagada; use "Encerrar".' }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Falha ao apagar.' }, { status: 500 });
  }
}
