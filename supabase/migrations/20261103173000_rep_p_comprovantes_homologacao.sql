BEGIN;
CREATE TABLE public.rep_p_comprovantes_homologacao (
  registro_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  marcacao_hash text NOT NULL CHECK (marcacao_hash ~ '^[0-9a-f]{64}$'),
  pdf_base64 text NOT NULL CHECK (length(pdf_base64) BETWEEN 1 AND 2796204),
  certificado_fingerprint text NOT NULL,
  certificado_validade timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.rep_p_comprovantes_homologacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rep_p_comprovantes_homologacao FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.rep_p_comprovantes_homologacao TO service_role;
CREATE FUNCTION public.rep_p_comprovante_imutavel() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'Comprovante assinado imutável.'; END;
$$;
CREATE TRIGGER rep_p_comprovante_imutavel BEFORE UPDATE OR DELETE ON public.rep_p_comprovantes_homologacao
  FOR EACH ROW EXECUTE FUNCTION public.rep_p_comprovante_imutavel();
CREATE TRIGGER rep_p_comprovante_sem_truncate BEFORE TRUNCATE ON public.rep_p_comprovantes_homologacao
  FOR EACH STATEMENT EXECUTE FUNCTION public.rep_p_comprovante_imutavel();
REVOKE ALL ON FUNCTION public.rep_p_comprovante_imutavel() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.rep_p_comprovantes_homologacao IS
  'PDFs de homologacao apenas. Certificado/senha permanecem exclusivamente no cadastro fiscal da holding; nao copiados para esta tabela.';
COMMIT;
