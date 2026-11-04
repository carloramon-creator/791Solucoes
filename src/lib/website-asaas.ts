import { readFinanceConfig } from '@/lib/finance-config-server';
import type { HoldingCustomerInput } from '@/lib/holding-customers';
import type { WebsitePaymentMethod } from '@/lib/website-contracts';

type AsaasPayment = {
  id: string;
  customer: string;
  externalReference: string;
  billingType: WebsitePaymentMethod;
  value: number;
  dueDate: string;
  status: string;
  invoiceUrl: string;
  installment?: string;
  installmentNumber?: number;
  deleted?: boolean;
  subscription?: string;
  confirmedDate?: string;
  paymentDate?: string;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resposta inválida do Asaas.');
  return value as Record<string, unknown>;
}

export function safeAsaasInvoice(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Link de pagamento ausente no Asaas.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['asaas.com', 'www.asaas.com', 'sandbox.asaas.com'].includes(url.hostname)
    || url.username || url.password || url.port) throw new Error('Link de pagamento inválido no Asaas.');
  return url.href;
}

function payment(value: unknown): AsaasPayment {
  const row = object(value);
  if (typeof row.id !== 'string' || !/^pay_[A-Za-z0-9]+$/.test(row.id)
    || typeof row.customer !== 'string' || (row.externalReference != null && typeof row.externalReference !== 'string')
    || typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value <= 0
    || typeof row.dueDate !== 'string' || typeof row.status !== 'string'
    || !['PIX', 'BOLETO', 'CREDIT_CARD'].includes(String(row.billingType))
    || (row.installment !== undefined && row.installment !== null && typeof row.installment !== 'string')) {
    throw new Error('Dados de pagamento incompletos no Asaas.');
  }
  return { ...row, externalReference: row.externalReference || '', invoiceUrl: safeAsaasInvoice(row.invoiceUrl) } as AsaasPayment;
}

export type WebsiteAsaasSubscription = {
  id: string; customer: string; externalReference: string; value: number;
  billingType: WebsitePaymentMethod; cycle: 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY'; status: string;
  nextDueDate: string; deleted?: boolean;
};
function subscription(value: unknown): WebsiteAsaasSubscription {
  const row = object(value);
  if (typeof row.id !== 'string' || !/^sub_[A-Za-z0-9]+$/.test(row.id)
    || typeof row.customer !== 'string' || typeof row.externalReference !== 'string'
    || typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value <= 0
    || !['PIX', 'BOLETO', 'CREDIT_CARD'].includes(String(row.billingType))
    || !['MONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY'].includes(String(row.cycle))
    || typeof row.status !== 'string' || typeof row.nextDueDate !== 'string') {
    throw new Error('Assinatura Asaas incompleta ou inválida.');
  }
  return row as WebsiteAsaasSubscription;
}

export async function createWebsiteAsaas() {
  const config = await readFinanceConfig();
  if (typeof config.asaasApiKey !== 'string' || !config.asaasApiKey.trim()) throw new Error('Configure a chave Asaas da Holding antes de gerar cobranças.');
  if (config.asaasEnv !== 'production' && config.asaasEnv !== 'sandbox') throw new Error('Selecione explicitamente o ambiente Asaas da Holding.');
  const environment: 'sandbox' | 'production' = config.asaasEnv;
  const base = environment === 'production' ? 'https://api.asaas.com/v3' : 'https://sandbox.asaas.com/api/v3';
  const key = config.asaasApiKey;
  // Transporte exclusivo de Websites: sem retries de POST nem rotinas fiscais/SaaS.
  async function request(path: string, body?: object): Promise<Record<string, unknown>> {
    const response = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { access_token: key, 'Content-Type': 'application/json', 'User-Agent': '791holding-websites' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      console.error(`[WEBSITES ASAAS] HTTP ${response.status} em ${body ? 'POST' : 'GET'}.`);
      throw new Error(`Asaas retornou HTTP ${response.status}. Confira o painel Asaas antes de qualquer nova emissão.`);
    }
    return object(await response.json());
  }
  async function list(path: string) {
    const rows: unknown[] = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = await request(`${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${offset}`);
      if (!Array.isArray(page.data) || typeof page.hasMore !== 'boolean') throw new Error('Paginação inválida do Asaas.');
      rows.push(...page.data);
      if (!page.hasMore) return rows;
      if (!page.data.length) throw new Error('Paginação incompleta do Asaas.');
    }
    throw new Error('Consulta Asaas excedeu o limite de segurança.');
  }
  return {
    environment,
    async findCustomer(document: string) {
      const rows = (await list(`/customers?cpfCnpj=${encodeURIComponent(document)}`)).map(object)
        .filter((row) => row.deleted !== true && row.cpfCnpj === document);
      if (rows.length > 1) throw new Error('Há mais de um cliente Asaas com este documento. Resolva a duplicidade no Asaas.');
      if (!rows.length) return null;
      const id = rows[0].id;
      if (typeof id !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(id)) throw new Error('Cliente Asaas inválido.');
      return id;
    },
    async createCustomer(customer: HoldingCustomerInput) {
      const row = await request('/customers', {
        name: customer.name, cpfCnpj: customer.document, email: customer.email, phone: customer.phone || undefined,
        postalCode: customer.postal_code || undefined, address: customer.address || undefined,
        addressNumber: customer.address_number || undefined, complement: customer.complement || undefined,
        province: customer.district || undefined,
      });
      if (typeof row.id !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(row.id)) throw new Error('Asaas não confirmou o cadastro do cliente.');
      return row.id;
    },
    async findPayments(reference: string) {
      let rows = (await list(`/payments?externalReference=${encodeURIComponent(reference)}`)).map(payment);
      const installments = new Set(rows.filter((row) => row.installment).map((row) => row.installment!));
      if (installments.size > 1) throw new Error('Mais de um parcelamento Asaas para a mesma referência. Revisão necessária.');
      if (installments.size === 1) {
        rows = (await list(`/installments/${encodeURIComponent([...installments][0])}/payments`)).map(payment);
      }
      return rows;
    },
    async createPayments(input: {
      customer: string; method: WebsitePaymentMethod; count: number;
      total_cents: number; due_date: string; reference: string; description: string;
    }) {
      return payment(await request('/payments', {
        customer: input.customer, billingType: input.method, dueDate: input.due_date,
        description: input.description, externalReference: input.reference,
        ...(input.count === 1 ? { value: input.total_cents / 100 }
          : { installmentCount: input.count, totalValue: input.total_cents / 100 }),
      }));
    },
    async findSubscriptions(reference: string) {
      return (await list(`/subscriptions?externalReference=${encodeURIComponent(reference)}`)).map(subscription);
    },
    async createSubscription(input: {
      customer: string; method: WebsitePaymentMethod; cycle: WebsiteAsaasSubscription['cycle'];
      amount_cents: number; due_date: string; reference: string; description: string;
    }) {
      return subscription(await request('/subscriptions', {
        customer: input.customer, billingType: input.method, cycle: input.cycle,
        value: input.amount_cents / 100, nextDueDate: input.due_date,
        externalReference: input.reference, description: input.description,
      }));
    },
    async getSubscription(id: string) {
      if (!/^sub_[A-Za-z0-9]+$/.test(id)) throw new Error('Identificador de assinatura Asaas inválido.');
      return subscription(await request(`/subscriptions/${encodeURIComponent(id)}`));
    },
    async subscriptionReference(id: string) {
      if (!/^sub_[A-Za-z0-9]+$/.test(id)) throw new Error('Identificador de assinatura Asaas inválido.');
      const row = await request(`/subscriptions/${encodeURIComponent(id)}`);
      if (row.id !== id || (row.externalReference != null && typeof row.externalReference !== 'string')) {
        throw new Error('Referência da assinatura Asaas inválida.');
      }
      return typeof row.externalReference === 'string' ? row.externalReference : '';
    },
    async subscriptionPayments(id: string) {
      if (!/^sub_[A-Za-z0-9]+$/.test(id)) throw new Error('Identificador de assinatura Asaas inválido.');
      return (await list(`/subscriptions/${encodeURIComponent(id)}/payments`)).map(payment);
    },
    async getPayment(id: string) {
      if (!/^pay_[A-Za-z0-9]+$/.test(id)) throw new Error('Identificador de pagamento Asaas inválido.');
      const row = payment(await request(`/payments/${encodeURIComponent(id)}`));
      if (row.id !== id) throw new Error('Pagamento retornado não corresponde ao solicitado.');
      return row;
    },
  };
}

export type WebsiteAsaas = Awaited<ReturnType<typeof createWebsiteAsaas>>;
export type WebsiteAsaasPayment = AsaasPayment;
