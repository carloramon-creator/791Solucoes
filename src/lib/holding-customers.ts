export type HoldingCustomerInput = {
  name: string;
  trade_name: string;
  document: string;
  email: string;
  phone: string;
  postal_code: string;
  address: string;
  address_number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  active: boolean;
};

export type HoldingCustomer = HoldingCustomerInput & { id: string };
export const isUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function maskCustomerDocument(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  return digits.length <= 11
    ? digits.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    : digits.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function maskCustomerPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 13);
  const international = digits.length > 11;
  const local = international ? digits.slice(2) : digits;
  const masked = local.replace(/^(\d{2})(\d)/, '($1) $2')
    .replace(local.length > 10 ? /(\d{5})(\d{1,4})$/ : /(\d{4})(\d{1,4})$/, '$1-$2');
  return international ? `+${digits.slice(0, 2)} ${masked}` : masked;
}

export const maskCustomerCep = (value: string) => value.replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');

export async function readHoldingCustomerLookup(response: Response): Promise<{
  fields: Partial<HoldingCustomerInput>; source: string; warning?: string;
}> {
  if (response.status === 401) throw new Error('Sua sessão expirou. Entre novamente para consultar o cadastro.');
  if (response.status === 403) throw new Error('A consulta foi bloqueada. Confira sua permissão em Clientes; se ela estiver correta, atualize a página e tente novamente.');
  if (response.status === 429) throw new Error('Muitas consultas em pouco tempo. Aguarde alguns instantes antes de tentar novamente.');
  if (response.redirected || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    console.error(`[HOLDING LOOKUP] Resposta não JSON ou redirecionada; HTTP ${response.status}.`);
    throw new Error('O servidor não retornou os dados da consulta. Atualize a página e tente novamente. Seus campos foram preservados e podem ser preenchidos manualmente.');
  }
  let payload: unknown;
  try { payload = JSON.parse(await response.text()); } catch (failure) {
    if (!(failure instanceof SyntaxError)) throw failure;
    console.error(`[HOLDING LOOKUP] JSON inválido; HTTP ${response.status}.`);
    throw new Error('A consulta retornou uma resposta incompleta ou inválida. Tente novamente ou preencha manualmente; seus campos foram preservados.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Resposta de consulta inválida. Tente novamente ou preencha manualmente.');
  }
  if (!response.ok) {
    throw new Error('error' in payload && typeof payload.error === 'string' && payload.error.trim()
      ? payload.error : 'Não foi possível consultar o cadastro. Tente novamente ou preencha manualmente.');
  }
  if (!('source' in payload) || typeof payload.source !== 'string' || !payload.source.trim()
    || !('fields' in payload) || !payload.fields || typeof payload.fields !== 'object' || Array.isArray(payload.fields)) {
    throw new Error('O serviço não retornou dados cadastrais válidos. Tente novamente ou preencha manualmente.');
  }
  const fields: Partial<HoldingCustomerInput> = {};
  for (const key of ['name', 'trade_name', 'email', 'phone', 'postal_code', 'address', 'address_number', 'complement', 'district', 'city', 'state'] as const) {
    if (key in payload.fields) {
      const value = Reflect.get(payload.fields, key);
      if (typeof value !== 'string') throw new Error('O serviço retornou um campo cadastral inválido. Preencha manualmente.');
      fields[key] = value;
    }
  }
  if (!Object.keys(fields).length) throw new Error('Nenhum dado cadastral foi retornado pela consulta. Preencha manualmente.');
  const warning = 'warning' in payload ? payload.warning : undefined;
  if (warning !== undefined && typeof warning !== 'string') {
    throw new Error('O serviço retornou um aviso cadastral inválido. Tente novamente ou preencha manualmente.');
  }
  return { fields, source: payload.source, ...(warning !== undefined ? { warning } : {}) };
}

export function validDocument(value: string) {
  if (!/^(?:\d{11}|\d{14})$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const digits = [...value].map(Number);
  const cnpj = value.length === 14;
  for (let step = 0; step < 2; step++) {
    const length = (cnpj ? 12 : 9) + step;
    const sum = digits.slice(0, length).reduce((total, digit, index) => {
      const weight = cnpj ? ((length - index - 1) % 8) + 2 : length + 1 - index;
      return total + digit * weight;
    }, 0);
    const remainder = sum % 11;
    if (digits[length] !== (remainder < 2 ? 0 : 11 - remainder)) return false;
  }
  return true;
}

export function validateHoldingCustomer(body: unknown):
  | { ok: true; data: HoldingCustomerInput }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Informe os dados do cliente.' };
  const value = body as Record<string, unknown>;
  if (value.trade_name !== undefined && (typeof value.trade_name !== 'string' || value.trade_name.trim().length > 160)) {
    return { ok: false, error: 'Nome fantasia inválido (máximo 160 caracteres).' };
  }
  const limits = {
    name: 160, document: 20, email: 254, phone: 25, postal_code: 10, address: 200,
    address_number: 30, complement: 100, district: 100, city: 100, state: 2,
  };
  for (const [field, max] of Object.entries(limits)) {
    if (typeof value[field] !== 'string' || value[field].trim().length > max) {
      return { ok: false, error: `Campo ${field} inválido (máximo ${max} caracteres).` };
    }
  }
  const text = (field: keyof typeof limits) => (value[field] as string).trim();
  const document = text('document').replace(/[.\-/\s]/g, '');
  if (!validDocument(document)) return { ok: false, error: 'Informe um CPF ou CNPJ válido.' };
  if (text('name').length < 2) return { ok: false, error: 'Informe o nome ou razão social do cliente.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text('email'))) return { ok: false, error: 'Informe um e-mail válido.' };
  const phone = text('phone').replace(/[()+\-\s]/g, '');
  if (phone && !/^\d{10,13}$/.test(phone)) return { ok: false, error: 'Telefone inválido. Inclua o DDD.' };
  const postalCode = text('postal_code').replace(/[-\s]/g, '');
  if (postalCode && !/^\d{8}$/.test(postalCode)) return { ok: false, error: 'CEP inválido.' };
  const state = text('state').toUpperCase();
  if (state && !['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].includes(state)) {
    return { ok: false, error: 'UF inválida.' };
  }
  if (typeof value.active !== 'boolean') return { ok: false, error: 'Informe a situação do cliente.' };
  return { ok: true, data: {
    name: text('name'), trade_name: typeof value.trade_name === 'string' ? value.trade_name.trim() : '',
    document, email: text('email'), phone, postal_code: postalCode,
    address: text('address'), address_number: text('address_number'), complement: text('complement'),
    district: text('district'), city: text('city'), state, active: value.active,
  } };
}
