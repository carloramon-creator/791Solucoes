export type HoldingCustomerInput = {
  name: string;
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
    name: text('name'), document, email: text('email'), phone, postal_code: postalCode,
    address: text('address'), address_number: text('address_number'), complement: text('complement'),
    district: text('district'), city: text('city'), state, active: value.active,
  } };
}
