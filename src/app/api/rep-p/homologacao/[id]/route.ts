import { getGlassClient } from '@/lib/glass-client';
import { supabaseServer } from '@/lib/supabase-server';
import { gerarComprovanteHomologacao, validarSnapshot } from '@/lib/ponto/receipt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const error = (message: string, status: number) => Response.json({ error: message }, { status, headers });

function response(pdf: Buffer, id: string) {
  return new Response(new Uint8Array(pdf), { headers: { ...headers, 'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="ponto-homologacao-${id}.pdf"`, 'X-REP-P-Ambiente': 'homologacao' } });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.REP_P_HOMOLOGACAO_ENABLED !== 'true') return error('Homologação REP-P não habilitada na holding.', 503);
  const { id: requestedId } = await params;
  const id = requestedId.toLowerCase();
  if (!UUID.test(id)) return error('Marcação inválida.', 400);
  const authorization = req.headers.get('authorization') || '';
  if (!/^Bearer [^\s]+$/.test(authorization)) return error('Sessão Glass ausente.', 401);
  try {
    // Same user JWT for identity and RPC. No service-role read of another worker's original.
    const glass = await getGlassClient(authorization);
    const { data: session, error: sessionError } = await glass.auth.getUser(authorization.slice(7));
    if (sessionError || !session.user) return error('Sessão Glass inválida.', 401);
    const { data: raw, error: snapshotError } = await glass.rpc('rh_ponto_comprovante_snapshot', { p_registro: id });
    if (snapshotError) {
      if (snapshotError.code === '42501') return error('Marcação não disponível para este usuário.', 403);
      console.error('[REP-P snapshot]', snapshotError.code);
      return error('Não foi possível consultar a marcação original.', 503);
    }
    const snapshot = validarSnapshot(raw, id);
    const { data: cached, error: cacheError } = await supabaseServer.from('rep_p_comprovantes_homologacao')
      .select('pdf_base64,tenant_id,usuario_id,marcacao_hash').eq('registro_id', id).maybeSingle();
    if (cacheError) throw new Error('Falha ao consultar comprovante persistido.');
    const readCached = (value: { pdf_base64: string; tenant_id: string; usuario_id: string; marcacao_hash: string }) => {
      if (value.tenant_id !== snapshot.tenant || value.usuario_id !== session.user.id || value.marcacao_hash !== snapshot.hash) {
        throw new Error('Comprovante persistido diverge da marcação autorizada.');
      }
      const bytes = Buffer.from(value.pdf_base64, 'base64');
      if (bytes.length > 2 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF persistido inválido.');
      return response(bytes, id);
    };
    if (cached) return readCached(cached);
    const { data: settings, error: configError } = await supabaseServer.from('system_settings')
      .select('value').eq('id', 'nfse_config').single();
    if (configError) throw new Error('Não foi possível ler o A1 já cadastrado na holding.');
    // Read on every NEW receipt: renewal in the fiscal configuration automatically applies.
    const signed = await gerarComprovanteHomologacao(snapshot, process.env.REP_P_INPI || '', settings.value);
    const { error: saveError } = await supabaseServer.from('rep_p_comprovantes_homologacao').insert({
      registro_id: id, tenant_id: snapshot.tenant, usuario_id: session.user.id,
      marcacao_hash: snapshot.hash, pdf_base64: signed.pdf.toString('base64'),
      certificado_fingerprint: signed.fingerprint, certificado_validade: signed.validade,
    });
    if (saveError?.code === '23505') {
      const { data: existing, error: retryError } = await supabaseServer.from('rep_p_comprovantes_homologacao')
        .select('pdf_base64,tenant_id,usuario_id,marcacao_hash').eq('registro_id', id).single();
      if (retryError || !existing) throw new Error('Não foi possível recuperar a emissão concorrente.');
      return readCached(existing);
    }
    if (saveError) throw new Error('PDF assinado não foi persistido. Nenhum comprovante foi disponibilizado.');
    return response(signed.pdf, id);
  } catch (cause) {
    // Do not log PFX, password, JWT, raw provider exceptions or worker identity.
    console.error('[REP-P homologação]', cause instanceof Error ? cause.name : 'Erro');
    return error('Falha na homologação do comprovante. Confira as migrations, o INPI e o A1 da holding.', 503);
  }
}
