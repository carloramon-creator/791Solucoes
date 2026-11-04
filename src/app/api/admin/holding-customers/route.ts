import { NextResponse } from 'next/server';
import { authorizeHoldingCommercial } from '@/lib/holding-commercial-auth';
import { isUuid, validateHoldingCustomer } from '@/lib/holding-customers';
import { supabaseServer } from '@/lib/supabase-server';

const COLUMNS = 'id,name,document,email,phone,postal_code,address,address_number,complement,district,city,state,active';

export async function GET(req: Request) {
  try {
    const denied = await authorizeHoldingCommercial(req, ['menu.clientes']);
    if (denied) return denied;
    const { data, error } = await supabaseServer.from('holding_customers').select(COLUMNS).order('name');
    if (error) throw error;
    return NextResponse.json({ customers: data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    console.error('[HOLDING CUSTOMERS] Falha ao consultar clientes.');
    return NextResponse.json({ error: 'Não foi possível carregar os clientes da Holding.' }, { status: 500 });
  }
}

async function save(req: Request, updating: boolean) {
  try {
    const denied = await authorizeHoldingCommercial(req, ['menu.clientes']);
    if (denied) return denied;
    let body: unknown;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Envie um JSON válido.' }, { status: 400 });
    }
    const result = validateHoldingCustomer(body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    const id = body && typeof body === 'object' && 'id' in body ? body.id : undefined;
    if (updating && !isUuid(id)) return NextResponse.json({ error: 'Cliente inválido.' }, { status: 400 });
    const table = supabaseServer.from('holding_customers');
    // O documento identifica o cliente e não pode mudar depois do cadastro.
    const mutation = updating
      ? table.update(result.data).eq('id', id).eq('document', result.data.document).neq('asaas_state', 'processing')
      : table.insert(result.data);
    const { data, error } = await mutation.select(COLUMNS).maybeSingle();
    if (error?.code === '23505') return NextResponse.json({ error: 'Já existe um cliente com este CPF/CNPJ.' }, { status: 409 });
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Cliente não encontrado, documento alterado ou integração em andamento. Atualize e tente novamente.' }, { status: 409 });
    return NextResponse.json({ customer: data }, { status: updating ? 200 : 201 });
  } catch {
    console.error('[HOLDING CUSTOMERS] Falha ao salvar cliente.');
    return NextResponse.json({ error: 'Não foi possível salvar o cliente da Holding.' }, { status: 500 });
  }
}

export async function POST(req: Request) { return save(req, false); }
export async function PUT(req: Request) { return save(req, true); }

export async function DELETE(req: Request) {
  try {
    const denied = await authorizeHoldingCommercial(req, ['menu.clientes']);
    if (denied) return denied;
    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }); }
    const id = body && typeof body === 'object' && 'id' in body ? body.id : undefined;
    if (!isUuid(id)) return NextResponse.json({ error: 'Cliente inválido.' }, { status: 400 });
    // As FKs NO ACTION impedem exclusao inclusive com contratacoes concorrentes.
    const { data, error } = await supabaseServer.from('holding_customers').delete()
      .eq('id', id).neq('asaas_state', 'processing').select('id').maybeSingle();
    if (error?.code === '23503') return NextResponse.json({ error: 'Este cliente possui contratação de projeto ou assinatura e não pode ser excluído. Você pode inativá-lo.' }, { status: 409 });
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Cliente não encontrado ou com integração em andamento. Atualize antes de continuar.' }, { status: 409 });
    return NextResponse.json({ deleted: true });
  } catch {
    console.error('[HOLDING CUSTOMERS] Falha ao excluir cliente.');
    return NextResponse.json({ error: 'Não foi possível excluir o cliente. Confira a migração e tente novamente.' }, { status: 500 });
  }
}
