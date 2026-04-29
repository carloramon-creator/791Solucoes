import { AsaasClient } from './asaas-service';
import { InterAPIV2 } from './inter-service';
import { createClient } from '@supabase/supabase-js';

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
    const [saasType, tenantId] = payload.externalReference.split('|');
    
    console.log(`[PAYMENT PROCESSOR] Pagamento confirmado para ${saasType}: ${tenantId}`);

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
