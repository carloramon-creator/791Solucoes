import { AsaasClient } from './asaas-service';
import { InterAPIV2 } from './inter-service';
import { createClient } from '@supabase/supabase-js';
import ipmProvider from '@/lib/nfse/providers/ipm';

// Configurações globais
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Chaves do Glass para atualização remota
const glassUrl = process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL!;
const glassServiceKey = process.env.SUPABASE_GLASS_SERVICE_ROLE_KEY!;

export class PaymentProcessor {
  /**
   * Processa um pagamento confirmado (via Webhook)
   * Identifica se é do Glass ou Barber e atualiza o acesso.
   */
  static async handlePaymentConfirmed(payload: {
    externalReference: string; // "glass|tenant_id" ou "barber|tenant_id"
    value: number;
    paymentMethod: string;
    bankId: string;
    metadata?: any;
  }) {
    const parts = payload.externalReference.split('|');
    const [saasType, tenantId, , couponId] = parts;
    
    console.log(`[PAYMENT PROCESSOR] Pagamento confirmado para ${saasType}: ${tenantId}${couponId ? ` (cupom: ${couponId})` : ''}`);

    // 1. Registrar na Holding (system_finance_records)
    const holdingSupabase = createClient(supabaseUrl, supabaseServiceKey);
    await holdingSupabase.from('system_finance_records').insert({
      business_unit: saasType,
      type: 'revenue',
      value: payload.value,
      description: `Assinatura SaaS ${saasType} - Tenant: ${tenantId}`,
      payment_method: payload.paymentMethod,
      bank_id: payload.bankId,
      category: 'SaaS Revenue',
      metadata: payload.metadata || {}
    });

    // 2. Atualizar o SaaS correspondente
    if (saasType === 'glass') {
      const cycle = payload.externalReference.split('|')[2] || 'monthly';
      
      if (!glassServiceKey) {
        console.error('[PAYMENT PROCESSOR] Erro: SUPABASE_GLASS_SERVICE_ROLE_KEY não configurada!');
        return;
      }
      
      const glassSupabase = createClient(glassUrl, glassServiceKey);
      
      // Lógica de validade baseada no ciclo real
      let daysToAdd = 31;
      if (cycle === 'annual') daysToAdd = 366;
      else if (cycle === 'semiannual') daysToAdd = 185;

      const nextExpiration = new Date();
      nextExpiration.setDate(nextExpiration.getDate() + daysToAdd);

      console.log(`[PAYMENT PROCESSOR] Ativando vidracaria ${tenantId} (Ciclo: ${cycle}) por ${daysToAdd} dias até ${nextExpiration.toISOString()}`);

      const { error } = await glassSupabase
        .from('vidracarias')
        .update({
          ativa: true,
          status_assinatura: 'ativa',
          vencimento_assinatura: nextExpiration.toISOString().split('T')[0], // YYYY-MM-DD
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantId);

      if (error) {
        console.error(`[PAYMENT PROCESSOR] Erro ao atualizar vidracaria no Glass:`, error);
      } else {
        console.log(`[PAYMENT PROCESSOR] Vidracaria ${tenantId} no Glass ativada com sucesso!`);

        // Registrar uso do cupom (se havia cupom aplicado)
        if (couponId) {
          try {
            const { data: couponRow } = await holdingSupabase
              .from('coupons')
              .select('used_count')
              .eq('id', couponId)
              .single();

            if (couponRow) {
              await holdingSupabase
                .from('coupons')
                .update({ used_count: couponRow.used_count + 1 })
                .eq('id', couponId);

              await holdingSupabase.from('coupon_uses').insert({
                coupon_id: couponId,
                vidracaria_id: tenantId,
                used_at: new Date().toISOString(),
                value: payload.value,
              });

              console.log(`[PAYMENT PROCESSOR] Uso do cupom ${couponId} registrado para vidraçaria ${tenantId}`);
            }
          } catch (couponErr: any) {
            // Não bloqueia o fluxo — apenas loga
            console.error(`[PAYMENT PROCESSOR] Erro ao registrar uso do cupom:`, couponErr.message);
          }
        }

        // Emitir NF-e automaticamente após confirmar o pagamento
        try {
          await emitirNFeSaas({
            holdingSupabase,
            glassSupabase,
            vidracariaId: tenantId,
            valor: payload.value,
            ciclo: cycle,
          });
        } catch (nfErr: any) {
          // Não bloqueia o fluxo principal — apenas loga o erro
          console.error(`[PAYMENT PROCESSOR] Erro ao emitir NF-e para ${tenantId}:`, nfErr.message);
        }
      }
    } 
    
    // CASO 3: Patrocinadores (Holding)
    else if (saasType === 'sponsor') {
      console.log(`[PAYMENT PROCESSOR] Ativando Patrocinador: ${tenantId}`);
      
      const { data: sponsor, error: fError } = await holdingSupabase
        .from('patrocinadores')
        .select('*')
        .eq('id', tenantId)
        .single();

      if (fError || !sponsor) {
        console.error(`[PAYMENT PROCESSOR] Patrocinador ${tenantId} não encontrado!`);
        return;
      }

      // Cálculo de validade baseado no ciclo
      const cycle = sponsor.ciclo || 'MONTHLY';
      let daysToAdd = 31;
      
      if (cycle === 'QUARTERLY') daysToAdd = 92;
      else if (cycle === 'SEMI_ANNUAL') daysToAdd = 183;
      else if (cycle === 'YEARLY') daysToAdd = 366;

      const currentExp = sponsor.data_expiracao ? new Date(sponsor.data_expiracao) : new Date();
      // Se já estiver expirado, começa de hoje. Se não, soma à data atual.
      const baseDate = currentExp > new Date() ? currentExp : new Date();
      
      const nextExpiration = new Date(baseDate);
      nextExpiration.setDate(nextExpiration.getDate() + daysToAdd);

      console.log(`[PAYMENT PROCESSOR] Patrocinador ${sponsor.nome} ativado até ${nextExpiration.toISOString()} (Ciclo: ${cycle})`);

      const { error: uError } = await holdingSupabase
        .from('patrocinadores')
        .update({
          status: 'ativo',
          data_expiracao: nextExpiration.toISOString().split('T')[0],
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantId);

      if (uError) {
        console.error(`[PAYMENT PROCESSOR] Erro ao atualizar Patrocinador:`, uError.message);
      }
    }
    
    // TODO: Adicionar lógica para o Barber se necessário (embora já esteja integrado lá)
  }

  /**
   * Gera uma cobrança via Asaas (Cartão)
   */
  static async createAsaasSubscription(customerData: any, planData: any) {
    // Lógica para criar assinatura recorrente no Asaas
    // ...
  }

  /**
   * Gera um Pix via Banco Inter
   */
  static async createInterPix(customerData: any, amount: number) {
    // Lógica para criar Pix/Boleto no Inter
    // ...
  }
}

/**
 * Emite NF-e para assinatura SaaS 791glass após pagamento confirmado.
 * Busca dados da vidraçaria no Glass, configurações do prestador na Holding,
 * emite via IPM e salva em system_invoices.
 */
async function emitirNFeSaas({
  holdingSupabase,
  glassSupabase,
  vidracariaId,
  valor,
  ciclo,
}: {
  holdingSupabase: ReturnType<typeof createClient>;
  glassSupabase: ReturnType<typeof createClient>;
  vidracariaId: string;
  valor: number;
  ciclo: string;
}) {
  // Evita NF-e duplicada para o mesmo mês
  const mesRef = new Date().toISOString().slice(0, 7); // "2026-06"
  const { data: existing } = await holdingSupabase
    .from('system_invoices')
    .select('id')
    .eq('metadata->>vidracaria_id', vidracariaId)
    .eq('metadata->>mes_ref', mesRef)
    .maybeSingle();

  if (existing) {
    console.log(`[NF-e SAAS] NF-e já emitida para ${vidracariaId} em ${mesRef} — pulando.`);
    return;
  }

  // Busca dados da vidraçaria (Tomador)
  const { data: vidracaria, error: vErr } = await glassSupabase
    .from('vidracarias')
    .select('nome, cnpj, email, endereco, numero, bairro, cep, cidade, estado, inscricao_municipal')
    .eq('id', vidracariaId)
    .single();

  if (vErr || !vidracaria) throw new Error('Vidraçaria não encontrada no Glass: ' + vErr?.message);

  // Busca configurações NFS-e da Holding (Prestador)
  const { data: configData, error: cErr } = await holdingSupabase
    .from('system_settings')
    .select('value')
    .eq('id', 'nfse_config')
    .single();

  if (cErr || !configData?.value) throw new Error('Configurações NFS-e não encontradas na Holding.');
  const config = configData.value as any;

  const mesAno = new Date().toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' });
  const dpsData = {
    numero: `HOLD-${Date.now()}`,
    serie: '1',
    dataEmissao: new Date().toISOString(),
    prestador: {
      cnpj: config.prestador_cnpj,
      razaoSocial: config.razao_social,
      inscricaoMunicipal: config.inscricao_municipal,
      endereco: {
        logradouro: config.logradouro,
        numero: config.numero,
        bairro: config.bairro,
        cep: config.cep,
        cidade: config.cidade,
        uf: config.estado,
      },
    },
    tomador: {
      cnpj: vidracaria.cnpj,
      razaoSocial: vidracaria.nome,
      email: vidracaria.email,
      inscricaoMunicipal: vidracaria.inscricao_municipal,
      endereco: {
        logradouro: vidracaria.endereco,
        numero: vidracaria.numero,
        bairro: vidracaria.bairro,
        cep: vidracaria.cep,
        cidade: vidracaria.cidade,
        uf: vidracaria.estado,
      },
    },
    servico: {
      valorServicos: valor,
      codigoItemListaServico: config.tax_code || '01.01.01',
      discriminacao: `Assinatura 791glass - Ciclo ${ciclo} - Ref. ${mesAno}`,
      aliquota: 0,
    },
  };

  const result = await ipmProvider.emit(
    dpsData as any,
    config.pfxBase64,
    config.passphrase,
    {
      username: config.ipm_username,
      password: config.ipm_password,
      municipal_code: config.municipal_code,
      isTest: config.environment === 'homologacao',
    }
  );

  await holdingSupabase.from('system_invoices').insert({
    invoice_number: result.invoiceId || dpsData.numero,
    status: result.status,
    client_name: vidracaria.nome,
    client_document: vidracaria.cnpj,
    value: valor,
    access_link: result.accessLink,
    error_message: result.success ? null : result.message,
    metadata: {
      vidracaria_id: vidracariaId,
      mes_ref: mesRef,
      ciclo,
      xml: result.xml,
      origem: 'webhook_asaas',
    },
  });

  if (result.success) {
    console.log(`[NF-e SAAS] NF-e emitida com sucesso para ${vidracaria.nome} (${vidracariaId})`);
  } else {
    console.error(`[NF-e SAAS] Prefeitura retornou erro para ${vidracariaId}:`, result.message);
  }
}
