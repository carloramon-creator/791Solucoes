-- ================================================================
-- Migration: Tabela coupon_uses — rastreia uso de cupons por cliente
-- Roda na Holding Supabase
-- ================================================================

-- Tabela para registrar cada uso de cupom por vidraçaria
CREATE TABLE IF NOT EXISTS public.coupon_uses (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id    UUID        NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  vidracaria_id TEXT       NOT NULL,  -- UUID da vidraçaria no Glass Supabase
  used_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  value        NUMERIC,               -- valor pago (para auditoria)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para consulta rápida: "essa vidraçaria já usou esse cupom?"
CREATE INDEX IF NOT EXISTS idx_coupon_uses_coupon_vidracaria
  ON public.coupon_uses(coupon_id, vidracaria_id);

-- RLS: somente service_role pode ler/escrever (acesso via API server-side)
ALTER TABLE public.coupon_uses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.coupon_uses
  USING (true)
  WITH CHECK (true);
