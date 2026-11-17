import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import {
  findTenantAsaasCustomers,
  getAsaasClient,
  listTenantAsaasSubscriptions,
  loadTenantInvoices,
} from '@/lib/glass-tenant-billing';
import { getGlassClient } from '@/lib/glass-client';
import { getUserProfileIds, userCanAccessResource } from '@/lib/holding-permissions';
import { isUuid } from '@/lib/holding-customers';
import { supabaseServer } from '@/lib/supabase-server';

type DeletePayload = {
  confirmacao?: string;
  confirmacaoTenant?: string;
  confirmacaoRegistros?: number;
  vidracariaId?: string;
};

type PurgePreview = {
  registrosIdentificados: number;
  tabelas: Record<string, number>;
};

type TenantRow = {
  id: string;
  nome: string | null;
  slug: string | null;
  email: string | null;
  cnpj: string | null;
  assinatura_confirmada: boolean | null;
};

type PurgeEvaluation = {
  eligible: boolean;
  reason: string | null;
  tenant: TenantRow | null;
  glass: Awaited<ReturnType<typeof getGlassClient>> | null;
  canceledFinanceRecordIds: string[];
  purgePreview?: PurgePreview;
};

const REQUIRED_CONFIRMATION = 'EXCLUIR VIDRACARIA DEFINITIVAMENTE';
const PURGE_PERMISSION = 'action.assinaturas.purge_test_tenant';
const CANCELED_PAYMENT_STATUSES = new Set(['cancelled', 'canceled', 'cancelada', 'cancelado', 'deleted']);

const json = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

async function authenticatePurgeAdmin(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return auth;
  if (!auth.user.email) {
    return { ok: false as const, status: 403, error: 'Usuário sem e-mail não pode excluir tenants.' };
  }

  const profiles = await getUserProfileIds(auth.user.email);
  if (profiles.length === 0) {
    return { ok: false as const, status: 403, error: 'É necessário um perfil administrativo explícito para excluir tenants.' };
  }

  try {
    const [canOpenSubscriptions, canPurge] = await Promise.all([
      userCanAccessResource(auth.user.email, 'menu.assinaturas'),
      userCanAccessResource(auth.user.email, PURGE_PERMISSION),
    ]);
    if (!canOpenSubscriptions || !canPurge) {
      return { ok: false as const, status: 403, error: 'Sem permissão específica para excluir tenants de teste.' };
    }
  } catch {
    return { ok: false as const, status: 503, error: 'Não foi possível confirmar a permissão de exclusão.' };
  }

  return auth;
}

async function evaluatePurgeEligibility(vidracariaId: string): Promise<PurgeEvaluation> {
  const glass = await getGlassClient();
  const { data: tenantData, error: tenantError } = await glass
    .from('vidracarias')
    .select('id, nome, slug, email, cnpj, assinatura_confirmada')
    .eq('id', vidracariaId)
    .maybeSingle();

  if (tenantError) throw new Error(`Falha ao validar vidraçaria: ${tenantError.message}`);
  if (!tenantData?.id) {
    return {
      eligible: false,
      reason: 'Vidraçaria não encontrada.',
      tenant: null,
      glass,
      canceledFinanceRecordIds: [],
    };
  }

  const tenant = tenantData as TenantRow;
  if (tenant.assinatura_confirmada !== false) {
    return {
      eligible: false,
      reason: 'Somente tenants identificados como trial sem confirmação de assinatura podem ser excluídos.',
      tenant,
      glass,
      canceledFinanceRecordIds: [],
    };
  }

  if (!tenant.email && !tenant.cnpj) {
    return {
      eligible: false,
      reason: 'Não foi possível conferir pagamentos no Asaas: o tenant não possui e-mail nem CNPJ.',
      tenant,
      glass,
      canceledFinanceRecordIds: [],
    };
  }

  const asaas = await getAsaasClient();
  if (!asaas) {
    return {
      eligible: false,
      reason: 'Não foi possível verificar assinaturas e pagamentos no Asaas. A exclusão foi bloqueada.',
      tenant,
      glass,
      canceledFinanceRecordIds: [],
    };
  }

  const customers = await findTenantAsaasCustomers(asaas, tenant);
  const subscriptions = await listTenantAsaasSubscriptions(asaas, customers, vidracariaId);
  if (subscriptions.length > 0) {
    return {
      eligible: false,
      reason: 'Este tenant possui uma assinatura ativa no Asaas.',
      tenant,
      glass,
      canceledFinanceRecordIds: [],
    };
  }

  const { invoices, warnings } = await loadTenantInvoices(vidracariaId, tenant);
  if (warnings.length > 0) {
    return {
      eligible: false,
      reason: `Não foi possível confirmar a ausência de cobranças: ${warnings.join(' ')}`,
      tenant,
      glass,
      canceledFinanceRecordIds: [],
    };
  }

  if (invoices.some((invoice) => invoice.source === 'invoice')) {
    return {
      eligible: false,
      reason: 'Há registro fiscal associado ao tenant. Preserve-o e revise-o antes de excluir.',
      tenant,
      glass,
      canceledFinanceRecordIds: [],
    };
  }

  const unsettledInvoices = invoices.filter((invoice) => (
    !CANCELED_PAYMENT_STATUSES.has(String(invoice.status || '').toLowerCase())
  ));
  if (unsettledInvoices.length > 0) {
    return {
      eligible: false,
      reason: 'Há pagamento ou cobrança não cancelada associada ao tenant.',
      tenant,
      glass,
      canceledFinanceRecordIds: [],
    };
  }

  const paymentLedgers = await glass
    .from('fin_lancamentos_baixas')
    .select('id')
    .eq('vidracaria_id', vidracariaId)
    .limit(1);
  if (paymentLedgers.error) throw new Error(`Falha ao conferir baixas financeiras: ${paymentLedgers.error.message}`);
  if (paymentLedgers.data?.length) {
    return {
      eligible: false,
      reason: 'Há baixa financeira registrada no 791glass.',
      tenant,
      glass,
      canceledFinanceRecordIds: [],
    };
  }

  const settledEntries = await glass
    .from('fin_lancamentos')
    .select('id')
    .eq('vidracaria_id', vidracariaId)
    .gt('valor_realizado', 0)
    .limit(1);
  if (settledEntries.error) throw new Error(`Falha ao conferir lançamentos financeiros: ${settledEntries.error.message}`);
  if (settledEntries.data?.length) {
    return {
      eligible: false,
      reason: 'Há lançamento financeiro realizado no 791glass.',
      tenant,
      glass,
      canceledFinanceRecordIds: [],
    };
  }

  const accessOrders = await glass
    .from('glass_access_orders')
    .select('id')
    .eq('vidracaria_id', vidracariaId)
    .eq('status', 'confirmed')
    .limit(1);
  if (accessOrders.error) throw new Error(`Falha ao conferir compras de acesso: ${accessOrders.error.message}`);
  if (accessOrders.data?.length) {
    return {
      eligible: false,
      reason: 'Há uma compra de acesso confirmada para este tenant.',
      tenant,
      glass,
      canceledFinanceRecordIds: [],
    };
  }

  const canceledFinanceRecordIds = invoices
    .filter((invoice) => invoice.source === 'record')
    .map((invoice) => String(invoice.id).replace(/^finance-/, ''))
    .filter(Boolean);
  const purgeGlass = await getGlassClient(undefined, {
    'x-791-test-tenant-purge': vidracariaId,
  });
  const { data: previewData, error: previewError } = await purgeGlass.rpc('holding_purge_test_tenant', {
    p_vidracaria_id: vidracariaId,
    p_dry_run: true,
    p_expected_records: null,
  });
  if (previewError) {
    throw new Error(`Não foi possível gerar a prévia completa dos dados do tenant: ${previewError.message}`);
  }
  if (
    !previewData
    || previewData.vidracariaId !== vidracariaId
    || previewData.dryRun !== true
    || typeof previewData.registrosIdentificados !== 'number'
    || !Number.isSafeInteger(previewData.registrosIdentificados)
    || !previewData.tabelas
    || typeof previewData.tabelas !== 'object'
    || Array.isArray(previewData.tabelas)
  ) {
    throw new Error('O banco 791glass não retornou uma prévia válida dos dados do tenant.');
  }

  return {
    eligible: true,
    reason: null,
    tenant,
    glass,
    canceledFinanceRecordIds,
    purgePreview: {
      registrosIdentificados: previewData.registrosIdentificados,
      tabelas: previewData.tabelas as Record<string, number>,
    },
  };
}

async function safeDeleteStoragePrefix(glass: Awaited<ReturnType<typeof getGlassClient>>, bucket: string, prefix: string) {
  const queue = [prefix];
  const filesToRemove: string[] = [];

  while (queue.length > 0) {
    const currentPrefix = queue.shift() as string;
    let offset = 0;
    while (true) {
      const { data, error } = await glass.storage.from(bucket).list(currentPrefix, {
        limit: 1000,
        offset,
      });

      if (error) {
        const message = String(error.message || '').toLowerCase();
        if (message.includes('bucket not found')) return;
        throw new Error(`[storage:${bucket}] ${error.message || 'erro ao listar arquivos'}`);
      }

      const items = data || [];
      for (const item of items) {
        if (!item?.name) continue;
        if (item.id === null) {
          queue.push(`${currentPrefix}/${item.name}`.replace(/^\/+/, ''));
        } else {
          filesToRemove.push(`${currentPrefix}/${item.name}`.replace(/^\/+/, ''));
        }
      }

      if (items.length < 1000) break;
      offset += items.length;
    }
  }

  for (let index = 0; index < filesToRemove.length; index += 1000) {
    const files = filesToRemove.slice(index, index + 1000);
    if (files.length > 0) {
      const { error: removeError } = await glass.storage.from(bucket).remove(files);
      if (removeError) {
        throw new Error(`[storage:${bucket}] ${removeError.message || 'erro ao remover arquivos'}`);
      }
    }
  }
}

export async function GET(req: Request) {
  const auth = await authenticatePurgeAdmin(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const vidracariaId = new URL(req.url).searchParams.get('vidracariaId')?.trim() || '';
  if (!isUuid(vidracariaId)) return json({ error: 'Informe um vidracariaId válido.' }, 400);

  try {
    const evaluation = await evaluatePurgeEligibility(vidracariaId);
    if (!evaluation.tenant) return json({ eligible: false, reason: evaluation.reason }, 404);
    return json({
      eligible: evaluation.eligible,
      reason: evaluation.reason,
      tenant: {
        id: evaluation.tenant.id,
        nome: evaluation.tenant.nome,
        slug: evaluation.tenant.slug,
      },
      ...(evaluation.purgePreview || {}),
    });
  } catch (error: unknown) {
    const candidate = error as { message?: string };
    return json({ error: candidate?.message || 'Não foi possível verificar a elegibilidade do tenant.' }, 503);
  }
}

export async function DELETE(req: Request) {
  const auth = await authenticatePurgeAdmin(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  let body: DeletePayload;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Envie JSON válido para confirmar a exclusão.' }, 400);
  }

  const confirmacao = String(body.confirmacao || '').trim().toUpperCase();
  if (confirmacao !== REQUIRED_CONFIRMATION) {
    return json({ error: `Confirmação inválida. Digite exatamente: ${REQUIRED_CONFIRMATION}` }, 400);
  }

  const vidracariaId = String(body.vidracariaId || '').trim();
  if (!isUuid(vidracariaId)) return json({ error: 'Informe um vidracariaId válido.' }, 400);
  if (String(body.confirmacaoTenant || '').trim().toLowerCase() !== vidracariaId.toLowerCase()) {
    return json({ error: 'Digite o ID exato do tenant para confirmar a exclusão.' }, 400);
  }
  if (!Number.isSafeInteger(body.confirmacaoRegistros) || (body.confirmacaoRegistros as number) < 0) {
    return json({ error: 'A quantidade de registros da prévia é inválida. Gere uma nova prévia.' }, 400);
  }

  try {
    const evaluation = await evaluatePurgeEligibility(vidracariaId);
    if (!evaluation.tenant) return json({ error: evaluation.reason || 'Vidraçaria não encontrada.' }, 404);
    if (!evaluation.eligible) return json({ error: evaluation.reason || 'Tenant não elegível para exclusão.' }, 409);
    if (evaluation.purgePreview?.registrosIdentificados !== body.confirmacaoRegistros) {
      return json({ error: 'Os dados mudaram desde a prévia. Feche e abra novamente a confirmação antes de excluir.' }, 409);
    }

    const glass = await getGlassClient(undefined, {
      'x-791-test-tenant-purge': vidracariaId,
    });

    try {
      await safeDeleteStoragePrefix(glass, 'orcamento-anexos', vidracariaId);
      await safeDeleteStoragePrefix(glass, 'vidracarias', vidracariaId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'erro desconhecido ao remover arquivos';
      throw new Error(`A limpeza do banco ainda não foi executada; o tenant continua no 791glass, mas arquivos podem ter sido removidos parcialmente. ${message}`);
    }

    if (evaluation.canceledFinanceRecordIds.length > 0) {
      const { error } = await supabaseServer
        .from('system_finance_records')
        .delete()
        .in('id', evaluation.canceledFinanceRecordIds);
      if (error) {
        throw new Error(`A limpeza do banco ainda não foi executada; o tenant continua no 791glass e arquivos podem já ter sido removidos. Falha ao remover cobranças canceladas: ${error.message}`);
      }
    }

    const { data: purgeResult, error: purgeError } = await glass.rpc('holding_purge_test_tenant', {
      p_vidracaria_id: vidracariaId,
      p_dry_run: false,
      p_expected_records: body.confirmacaoRegistros,
    });
    if (purgeError) {
      const countChanged = purgeError.message.includes('A quantidade de dados mudou desde a prévia');
      return json({
        error: countChanged
          ? 'Os dados mudaram durante a confirmação. O banco 791glass não foi alterado; arquivos ou cobranças canceladas podem já ter sido removidos. Gere uma nova prévia antes de tentar novamente.'
          : `A limpeza no banco 791glass falhou; os registros do tenant foram preservados para nova tentativa. Arquivos ou cobranças canceladas podem já ter sido removidos. ${purgeError.message}`,
      }, countChanged ? 409 : 500);
    }
    if (
      !purgeResult
      || purgeResult.vidracariaId !== vidracariaId
      || typeof purgeResult.registrosRemovidos !== 'number'
      || !Number.isSafeInteger(purgeResult.registrosRemovidos)
    ) {
      throw new Error('O banco 791glass não confirmou o resultado da limpeza. Verifique o tenant antes de tentar novamente.');
    }

    return json({
      ok: true,
      excluidaDefinitivamente: true,
      vidracariaId,
      nome: evaluation.tenant.nome,
      slug: evaluation.tenant.slug,
      registrosRemovidos: purgeResult.registrosRemovidos,
      contasAuthPreservadasPorSeguranca: true,
      executadoPor: auth.user.email,
    });
  } catch (error: unknown) {
    const candidate = error as { message?: string };
    return json(
      { error: candidate?.message || 'Falha ao excluir definitivamente a vidraçaria.' },
      500
    );
  }
}
