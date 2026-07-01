import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getGlassClient } from '@/lib/glass-client';

type DeletePayload = {
  confirmacao?: string;
  vidracariaId?: string;
};

type AuthSuccess = {
  ok: true;
  user: {
    id: string;
    email: string | null;
  };
};

type AuthFailure = {
  ok: false;
  status: number;
  error: string;
};

type AuthResult = AuthSuccess | AuthFailure;

const REQUIRED_CONFIRMATION = 'EXCLUIR VIDRACARIA DEFINITIVAMENTE';

const TENANT_TABLES_PURGE_ORDER = [
  'orcamento_anexos',
  'orcamento_historico',
  'orcamento_credito_consultas',
  'orcamentos',
  'ordem_servico_etapa_eventos',
  'ordens_servico_etapas',
  'ordens_servico_ambientes',
  'ordens_servico_eventos',
  'ordens_servico_etapas_erro_config',
  'ordens_servico_pesquisa_satisfacao_config',
  'ordens_servico',
  'projetos',
  'projects',
  'sacadas',
  'documentos',
  'whatsapp_messages',
  'whatsapp_conversation_tags',
  'whatsapp_pending_orcamentos',
  'whatsapp_conversations',
  'whatsapp_contacts',
  'whatsapp_sector_users',
  'whatsapp_sectors',
  'whatsapp_tags',
  'whatsapp_quick_replies',
  'whatsapp_automation_rules',
  'whatsapp_configs',
  'crm_stages',
  'fin_lancamentos',
  'fin_comissoes_apuradas',
  'fin_contas_correntes',
  'fin_formas_pagamento_config',
  'fin_subsubclasses_financeiras',
  'fin_subclasses_financeiras',
  'fin_classes_financeiras',
  'config_faixas_nota_fiscal',
  'config_grupos_faixa_nota_fiscal',
  'configuracoes_gerais',
  'contadores',
  'filiais',
  'etapas_producao_config_classes',
  'etapas_producao_config',
  'producao_configuracoes',
  'materiais_fornecedores',
  'materiais',
  'valores_atributo_material',
  'atributos_classe_material',
  'servicos_tratamento',
  'subclasses_materiais',
  'classes_materiais',
  'cor_ferragem_correspondente',
  'cores',
  'projeto_templates',
  'subclasses_projetos',
  'classes_projetos',
  'tabelas_comissao_produtividade',
  'tabelas_comissao',
  'pessoa_telefones',
  'pessoas',
  'user_profiles',
] as const;

function isMissingSchemaObjectError(error: unknown): boolean {
  const candidate = error as { message?: string; details?: string };
  const msg = String(candidate?.message || candidate?.details || '').toLowerCase();
  return (
    msg.includes('does not exist')
    || msg.includes('could not find the table')
    || msg.includes('schema cache')
    || msg.includes('could not find the')
  );
}

function isIgnorableAuthDeleteError(error: unknown): boolean {
  const candidate = error as { message?: string; status?: number };
  const msg = String(candidate?.message || '').toLowerCase();
  // Supabase may return not-found style errors when the auth user was already removed.
  return candidate?.status === 404 || msg.includes('not found') || msg.includes('user not found');
}

async function safeDeleteByTenant(admin: SupabaseClient, table: string, vidracariaId: string) {
  const { error } = await admin
    .from(table)
    .delete()
    .eq('vidracaria_id', vidracariaId);

  if (!error) return;
  if (isMissingSchemaObjectError(error)) return;
  throw new Error(`[${table}] ${error.message || 'erro ao excluir por vidracaria_id'}`);
}

async function safeDeleteByIds(admin: SupabaseClient, table: string, column: string, ids: string[]) {
  if (!ids.length) return;

  const { error } = await admin
    .from(table)
    .delete()
    .in(column, ids);

  if (!error) return;
  if (isMissingSchemaObjectError(error)) return;
  throw new Error(`[${table}] ${error.message || `erro ao excluir por ${column}`}`);
}

async function safeDeleteStoragePrefix(admin: SupabaseClient, bucket: string, prefix: string) {
  const queue = [prefix];

  while (queue.length > 0) {
    const currentPrefix = queue.shift() as string;
    const { data, error } = await admin.storage.from(bucket).list(currentPrefix, {
      limit: 1000,
      offset: 0,
    });

    if (error) {
      const msg = String(error.message || '').toLowerCase();
      if (msg.includes('bucket not found') || msg.includes('not found')) return;
      throw new Error(`[storage:${bucket}] ${error.message || 'erro ao listar arquivos'}`);
    }

    const files: string[] = [];
    for (const item of data || []) {
      if (!item?.name) continue;
      if (item.id === null) {
        queue.push(`${currentPrefix}/${item.name}`.replace(/^\/+/, ''));
      } else {
        files.push(`${currentPrefix}/${item.name}`.replace(/^\/+/, ''));
      }
    }

    if (files.length > 0) {
      const { error: removeError } = await admin.storage.from(bucket).remove(files);
      if (removeError) {
        throw new Error(`[storage:${bucket}] ${removeError.message || 'erro ao remover arquivos'}`);
      }
    }
  }
}

async function authenticateHoldingAdmin(req: Request): Promise<AuthResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 500, error: 'Configuracao do Supabase da Holding ausente.' };
  }

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return { ok: false, status: 401, error: 'Token ausente.' };
  }

  const requester = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userErr } = await requester.auth.getUser(token);
  if (userErr || !userData.user) {
    return { ok: false, status: 401, error: 'Sessao invalida.' };
  }

  const userEmail = userData.user.email || null;
  if (userEmail) {
    const { data: sponsor } = await requester
      .from('patrocinadores')
      .select('id')
      .eq('email', userEmail)
      .maybeSingle();

    if (sponsor?.id) {
      return { ok: false, status: 403, error: 'Patrocinadores nao podem executar exclusao definitiva.' };
    }
  }

  return {
    ok: true,
    user: {
      id: userData.user.id,
      email: userEmail,
    },
  };
}

export async function DELETE(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: DeletePayload = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const confirmacao = String(body.confirmacao || '').trim().toUpperCase();
  if (confirmacao !== REQUIRED_CONFIRMATION) {
    return NextResponse.json({ error: `Confirmacao invalida. Digite exatamente: ${REQUIRED_CONFIRMATION}` }, { status: 400 });
  }

  const vidracariaId = String(body.vidracariaId || '').trim();
  if (!vidracariaId) {
    return NextResponse.json({ error: 'Informe o vidracariaId para exclusao definitiva.' }, { status: 400 });
  }

  try {
    const glass = await getGlassClient();

    const { data: tenantExists, error: tenantCheckErr } = await glass
      .from('vidracarias')
      .select('id, nome, slug')
      .eq('id', vidracariaId)
      .maybeSingle();

    if (tenantCheckErr) {
      return NextResponse.json({ error: tenantCheckErr.message || 'Falha ao validar vidracaria.' }, { status: 500 });
    }

    if (!tenantExists?.id) {
      return NextResponse.json({ error: 'Vidracaria nao encontrada para exclusao.' }, { status: 404 });
    }

    const { data: userProfiles } = await glass
      .from('user_profiles')
      .select('user_id')
      .eq('vidracaria_id', vidracariaId);

    const { data: pessoasComUsuario } = await glass
      .from('pessoas')
      .select('user_id')
      .eq('vidracaria_id', vidracariaId)
      .not('user_id', 'is', null);

    const userIdsToDelete = Array.from(new Set([
      ...(userProfiles || []).map((row) => String((row as { user_id?: string }).user_id || '').trim()).filter(Boolean),
      ...(pessoasComUsuario || []).map((row) => String((row as { user_id?: string }).user_id || '').trim()).filter(Boolean),
    ]));

    const { data: orcamentosIdsRows } = await glass
      .from('orcamentos')
      .select('id')
      .eq('vidracaria_id', vidracariaId);
    const orcamentoIds = (orcamentosIdsRows || []).map((r) => String((r as { id: string }).id));

    const { data: ordensIdsRows } = await glass
      .from('ordens_servico')
      .select('id')
      .eq('vidracaria_id', vidracariaId);
    const ordemServicoIds = (ordensIdsRows || []).map((r) => String((r as { id: string }).id));

    const { data: etapasIdsRows } = await glass
      .from('ordens_servico_etapas')
      .select('id')
      .in('ordem_servico_id', ordemServicoIds.length ? ordemServicoIds : ['00000000-0000-0000-0000-000000000000']);
    const ordemServicoEtapaIds = (etapasIdsRows || []).map((r) => String((r as { id: string }).id));

    const { data: materialIdsRows } = await glass
      .from('materiais')
      .select('id')
      .eq('vidracaria_id', vidracariaId);
    const materialIds = (materialIdsRows || []).map((r) => String((r as { id: string }).id));

    const { data: classeIdsRows } = await glass
      .from('classes_materiais')
      .select('id')
      .eq('vidracaria_id', vidracariaId);
    const classeIds = (classeIdsRows || []).map((r) => String((r as { id: string }).id));

    const { data: atributoIdsRows } = await glass
      .from('atributos_classe_material')
      .select('id')
      .in('classe_id', classeIds.length ? classeIds : ['00000000-0000-0000-0000-000000000000']);
    const atributoIds = (atributoIdsRows || []).map((r) => String((r as { id: string }).id));

    const { data: conversaIdsRows } = await glass
      .from('whatsapp_conversations')
      .select('id')
      .eq('vidracaria_id', vidracariaId);
    const conversaIds = (conversaIdsRows || []).map((r) => String((r as { id: string }).id));

    const { data: pessoaIdsRows } = await glass
      .from('pessoas')
      .select('id')
      .eq('vidracaria_id', vidracariaId);
    const pessoaIds = (pessoaIdsRows || []).map((r) => String((r as { id: string }).id));

    await safeDeleteByIds(glass, 'orcamento_itens', 'orcamento_id', orcamentoIds);
    await safeDeleteByIds(glass, 'orcamento_historico', 'orcamento_id', orcamentoIds);
    await safeDeleteByIds(glass, 'orcamento_anexos', 'orcamento_id', orcamentoIds);
    await safeDeleteByIds(glass, 'orcamento_credito_consultas', 'orcamento_id', orcamentoIds);

    await safeDeleteByIds(glass, 'ordem_servico_etapa_eventos', 'ordem_servico_etapa_id', ordemServicoEtapaIds);
    await safeDeleteByIds(glass, 'ordens_servico_etapas', 'ordem_servico_id', ordemServicoIds);
    await safeDeleteByIds(glass, 'ordens_servico_ambientes', 'ordem_servico_id', ordemServicoIds);
    await safeDeleteByIds(glass, 'ordens_servico_eventos', 'ordem_servico_id', ordemServicoIds);

    await safeDeleteByIds(glass, 'materiais_fornecedores', 'material_id', materialIds);
    await safeDeleteByIds(glass, 'valores_atributo_material', 'atributo_id', atributoIds);
    await safeDeleteByIds(glass, 'pessoa_telefones', 'pessoa_id', pessoaIds);

    await safeDeleteByIds(glass, 'whatsapp_messages', 'conversation_id', conversaIds);
    await safeDeleteByIds(glass, 'whatsapp_conversation_tags', 'conversation_id', conversaIds);

    for (const table of TENANT_TABLES_PURGE_ORDER) {
      await safeDeleteByTenant(glass, table, vidracariaId);
    }

    await safeDeleteStoragePrefix(glass, 'orcamento-anexos', vidracariaId);
    await safeDeleteStoragePrefix(glass, 'vidracarias', vidracariaId);

    const { error: deleteTenantErr } = await glass
      .from('vidracarias')
      .delete()
      .eq('id', vidracariaId);

    if (deleteTenantErr) {
      throw new Error(deleteTenantErr.message || 'Falha ao remover registro da vidracaria.');
    }

    const authDeleteFailures: Array<{ userId: string; reason: string }> = [];
    for (const userId of userIdsToDelete) {
      const { error } = await glass.auth.admin.deleteUser(userId);
      if (error) {
        if (isIgnorableAuthDeleteError(error)) {
          continue;
        }
        authDeleteFailures.push({ userId, reason: error.message || 'erro ao excluir usuario no Auth' });
      }
    }

    return NextResponse.json({
      ok: true,
      excluidaDefinitivamente: true,
      vidracariaId,
      nome: tenantExists.nome || null,
      slug: tenantExists.slug || null,
      usuariosRemovidosAuth: userIdsToDelete.length - authDeleteFailures.length,
      falhasAuth: authDeleteFailures,
      executadoPor: auth.user.email,
    });
  } catch (error: unknown) {
    const candidate = error as { message?: string };
    return NextResponse.json(
      { error: candidate?.message || 'Falha ao excluir definitivamente a vidracaria.' },
      { status: 500 }
    );
  }
}