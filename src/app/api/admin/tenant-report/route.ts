import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getGlassClient } from '@/lib/glass-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

type BudgetRow = { status: string | null; valor_total: number | string | null };
type MessageRow = { sender_type: string | null };
type DeleteRow = { tabela: string | null };

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Sem permissao para consultar relatorios de tenants.');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const params = new URL(req.url).searchParams;
  const tenantId = String(params.get('tenantId') || '').trim();
  const start = String(params.get('start') || '').trim();
  const end = String(params.get('end') || '').trim();
  if (!tenantId || !datePattern.test(start) || !datePattern.test(end) || start > end) {
    return NextResponse.json({ error: 'Informe tenant e um periodo valido.' }, { status: 400 });
  }

  try {
    const glass = await getGlassClient();
    const startIso = `${start}T00:00:00-03:00`;
    const endIso = `${end}T23:59:59.999-03:00`;
    const scoped = (table: string, select: string, dateColumn = 'created_at') => glass
      .from(table).select(select).eq('vidracaria_id', tenantId).gte(dateColumn, startIso).lte(dateColumn, endIso);

    const [tenant, budgets, clients, projects, sacadas, workOrders, messages, deletes] = await Promise.all([
      glass.from('vidracarias').select('id, nome, slug').eq('id', tenantId).maybeSingle(),
      scoped('orcamentos', 'id, status, valor_total'),
      scoped('pessoas', 'id').eq('is_cliente', true),
      scoped('projetos', 'id'),
      scoped('sacadas', 'id'),
      scoped('ordens_servico', 'id'),
      scoped('whatsapp_messages', 'id, sender_type'),
      scoped('audit_logs', 'id, tabela').eq('operacao', 'DELETE'),
    ]);

    const firstError = [budgets, clients, projects, sacadas, workOrders, messages, deletes]
      .map((result) => result.error)
      .find((error) => error !== null);
    if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });
    if (!tenant.data) return NextResponse.json({ error: 'Tenant nao encontrado.' }, { status: 404 });

    const rows = (budgets.data || []) as unknown as BudgetRow[];
    const approved = rows.filter((row) => ['aprovado', 'pre_aprovado'].includes(String(row.status || '').toLowerCase()));
    const cancelled = rows.filter((row) => ['cancelado', 'cancelada'].includes(String(row.status || '').toLowerCase()));
    const messageRows = (messages.data || []) as unknown as MessageRow[];
    const deleteRows = (deletes.data || []) as unknown as DeleteRow[];

    return NextResponse.json({
      tenant: tenant.data,
      period: { start, end },
      metrics: {
        budgetsCreated: rows.length,
        budgetsApproved: approved.length,
        budgetsCancelled: cancelled.length,
        budgetsApprovedValue: approved.reduce((sum, row) => sum + Number(row.valor_total || 0), 0),
        clientsCreated: (clients.data || []).length,
        projectsCreated: (projects.data || []).length,
        sacadasCreated: (sacadas.data || []).length,
        workOrdersCreated: (workOrders.data || []).length,
        whatsappReceived: messageRows.filter((row) => row.sender_type === 'contact').length,
        whatsappSent: messageRows.filter((row) => ['user', 'system'].includes(String(row.sender_type))).length,
        auditedDeletes: deleteRows.length,
        auditedDeletesByTable: deleteRows.reduce((acc: Record<string, number>, row) => {
          const table = String(row.tabela || 'desconhecida');
          acc[table] = (acc[table] || 0) + 1;
          return acc;
        }, {}),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao gerar relatorio.' }, { status: 500 });
  }
}