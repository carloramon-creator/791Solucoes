import { NextResponse } from 'next/server';
import { authorizeHoldingCommercial } from '@/lib/holding-commercial-auth';
import { validDocument } from '@/lib/holding-customers';

export async function POST(req: Request) {
  try {
    const denied = await authorizeHoldingCommercial(req, ['menu.clientes']);
    if (denied) return denied;
    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || !('kind' in body) || !('value' in body) || typeof body.value !== 'string'
      || !['cnpj', 'cep'].includes(String(body.kind))) {
      return NextResponse.json({ error: 'Informe CNPJ ou CEP para consulta.' }, { status: 400 });
    }
    const value = body.value.replace(/[.\-/\s]/g, '');
    const cnpj = body.kind === 'cnpj';
    if (cnpj ? value.length !== 14 || !validDocument(value) : !/^\d{8}$/.test(value)) {
      return NextResponse.json({ error: cnpj ? 'CNPJ inválido.' : 'CEP inválido.' }, { status: 400 });
    }
    const response = await fetch(cnpj ? `https://brasilapi.com.br/api/cnpj/v1/${value}` : `https://viacep.com.br/ws/${value}/json/`, {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      console.warn(`[HOLDING LOOKUP] ${cnpj ? 'CNPJ' : 'CEP'} HTTP ${response.status}.`);
      return NextResponse.json({ error: response.status === 404 ? 'Cadastro não encontrado.' : 'Serviço de consulta indisponível. Tente novamente ou preencha manualmente.' }, { status: response.status === 404 ? 404 : 502 });
    }
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Resposta inválida.');
    const row = data as Record<string, unknown>;
    if (row.erro) return NextResponse.json({ error: 'CEP não encontrado.' }, { status: 404 });
    const text = (key: string) => typeof row[key] === 'string' ? row[key].trim() : '';
    if (cnpj && (text('cnpj').replace(/\D/g, '') !== value || !text('razao_social'))) throw new Error('CNPJ retornado inconsistente.');
    if (!cnpj && (text('cep').replace(/\D/g, '') !== value || !text('localidade') || !/^[A-Z]{2}$/.test(text('uf')))) throw new Error('CEP retornado inconsistente.');
    const fields = cnpj ? {
      name: text('razao_social'), postal_code: text('cep').replace(/\D/g, ''),
      address: [text('descricao_tipo_de_logradouro'), text('logradouro')].filter(Boolean).join(' '),
      address_number: text('numero'), complement: text('complemento'), district: text('bairro'),
      city: text('municipio'), state: text('uf'), phone: text('ddd_telefone_1').replace(/\D/g, ''), email: text('email'),
    } : { postal_code: value, address: text('logradouro'), district: text('bairro'), city: text('localidade'), state: text('uf') };
    return NextResponse.json({ fields, source: cnpj ? 'BrasilAPI (dados cadastrais do CNPJ)' : 'ViaCEP' },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    console.error('[HOLDING LOOKUP] Falha na consulta cadastral.');
    return NextResponse.json({ error: 'Não foi possível consultar o serviço. Tente novamente ou preencha manualmente.' }, { status: 502 });
  }
}
