export const OPERATIONS_PRODUCTS = { glass: 'Glass', barber: 'Barber', websites: 'Websites' } as const;
export const COMMERCIAL_STAGES = {
  available: 'Disponível', contacted: 'Contato realizado', negotiating: 'Em negociação',
  won: 'Convertido', lost: 'Perdido',
} as const;
export const PRODUCTION_STAGES = {
  materials: 'Aguardando materiais', production: 'Em produção', internal_review: 'Revisão interna',
  customer_review: 'Aprovação do cliente', completed: 'Concluído',
} as const;
export type OperationsArea = 'comercial' | 'producao';
export type OperationsProduct = keyof typeof OPERATIONS_PRODUCTS;
export type OperationsRecord = {
  id: string; area: OperationsArea; product: OperationsProduct; customer_name: string; title: string;
  contact: string; owner_email: string | null; stage: string; due_date: string | null;
  next_action: string; loss_reason: string; version: number; source_id: string | null;
  source_type: 'manual' | 'glass_subscriber' | 'website_contract'; source_status: string | null;
  created_at: string; completed_at: string | null; active_seconds: number;
};
export type OperationsEvent = {
  id: string; record_id: string; actor_email: string; owner_email: string | null;
  stage: string; previous_stage: string | null; note: string; created_at: string;
};
export type OperationsCommission = {
  record_id: string; seller_email: string | null; converted_at: string;
  state: 'awaiting_rule' | 'void'; rule_snapshot: null; amount_cents: null;
};
export type OperationsMember = { email: string; name: string };
export type OperationsMetric = {
  area: OperationsArea;
  product: OperationsProduct; owner_email: string | null; open_records: number; overdue_records: number;
  created: number; conversions: number; deliveries: number; on_time_deliveries: number;
};
export function operationsStages(area: OperationsArea): Record<string, string> {
  return area === 'comercial' ? COMMERCIAL_STAGES : PRODUCTION_STAGES;
}
