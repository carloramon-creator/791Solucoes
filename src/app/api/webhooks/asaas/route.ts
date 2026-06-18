import { NextResponse } from 'next/server';
import { PaymentProcessor } from '@/services/payment-processor';
import { supabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';

async function restoreWhatsappModulesIfNeeded(params: {
  holdingSupabase: any;
  glassSupabase: any;
  recordId: string;
  metadata: Record<string, any>;
}) {
  const { holdingSupabase, glassSupabase, recordId, metadata } = params;

  const tenantId = String(metadata?.tenant_id || '');
  if (!tenantId) return;

  const removedModules: string[] = Array.isArray(metadata?.whatsapp_removed_modules)
    ? metadata.whatsapp_removed_modules.map((id: any) => String(id))
    : [];

  if (removedModules.length > 0) {
    const { data: tenant, error: tenantError } = await glassSupabase
      .from('vidracarias')
      .select('id, modulos_ativos')
      .eq('id', tenantId)
      .single();

    if (!tenantError && tenant) {
      const currentModules = Array.isArray(tenant.modulos_ativos)
        ? tenant.modulos_ativos.map((id: any) => String(id))
        : [];

      const merged = Array.from(new Set([...currentModules, ...removedModules]));

      await glassSupabase
        .from('vidracarias')
        .update({
          modulos_ativos: merged,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tenantId);
    }
  }

  await holdingSupabase
    .from('system_finance_records')
    .update({
      metadata: {
        ...metadata,
        whatsapp_block_status: 'unblocked',
        whatsapp_unblocked_at: new Date().toISOString(),
      },
    })
    .eq('id', recordId);
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    console.log('[ASAAS WEBHOOK] Recebido:', JSON.stringify(payload, null, 2));

    // Validar Token de Segurança (Opcional se configurado)
    const asaasToken = req.headers.get('asaas-access-token');
    
    // Buscar config para validar token
    const { data: config } = await supabase
      .from('system_settings')
      .select('value')
      .eq('id', 'finance_api')
      .single();

    const expectedToken = (config?.value as any)?.asaasWebhookToken;
    if (expectedToken && asaasToken !== expectedToken) {
      console.warn('[ASAAS WEBHOOK] Token inválido recebido!');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const event = payload.event;
    const payment = payload.payment;
    const externalRef = payment.externalReference || '';

    const holdingService = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const glassService = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL!,
      process.env.SUPABASE_GLASS_SERVICE_ROLE_KEY!
    );

    // Verificamos se o pagamento foi confirmado
    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED_IN_CASH') {
      console.log(`[ASAAS WEBHOOK] Pagamento confirmado: ${payment.id} (Ref: ${externalRef})`);

      // CASO 1: Lançamento Financeiro da Holding
      if (externalRef.startsWith('finance_record|')) {
        const recordId = externalRef.split('|')[1];
        
        console.log(`[ASAAS WEBHOOK] Baixa automática no financeiro: ${recordId}`);
        
        const { data: financeRecord, error: financeRecordError } = await holdingService
          .from('system_finance_records')
          .select('id, metadata')
            .eq('id', recordId)
          .single();

        if (financeRecordError || !financeRecord?.id) {
          console.error('[ASAAS WEBHOOK] Finance record não encontrado:', financeRecordError?.message);
        } else {
          const existingMetadata = (financeRecord.metadata && typeof financeRecord.metadata === 'object')
            ? financeRecord.metadata as Record<string, any>
            : {};

          const mergedMetadata = {
            ...existingMetadata,
            asaas_payment_id: payment.id,
            confirmed_at: new Date().toISOString(),
            billing_type: payment.billingType,
          };

          const { error } = await holdingService
            .from('system_finance_records')
            .update({
              status: 'paid',
              updated_at: new Date().toISOString(),
              metadata: mergedMetadata,
            })
            .eq('id', recordId);

          if (error) console.error('[ASAAS WEBHOOK] Erro ao atualizar financeiro:', error.message);

          if (String(existingMetadata.kind || '') === 'overage') {
            await restoreWhatsappModulesIfNeeded({
              holdingSupabase: holdingService,
              glassSupabase: glassService,
              recordId,
              metadata: mergedMetadata,
            });
          }
        }
      } 
      
      // CASO 2: Assinaturas SaaS (Glass/Barber)
      else if (externalRef.startsWith('glass|') || externalRef.startsWith('barber|')) {
        try {
          await PaymentProcessor.handlePaymentConfirmed({
            externalReference: externalRef,
            value: payment.value,
            paymentMethod: payment.billingType === 'PIX' ? 'Pix' : (payment.billingType === 'CREDIT_CARD' ? 'Cartão' : 'Boleto'),
            bankId: 'Asaas',
            metadata: payment
          });
        } catch (procErr: any) {
          console.error('[ASAAS WEBHOOK] Erro no PaymentProcessor:', procErr.message);
          // Retorna 200 mesmo com erro para Asaas não retentar em loop
          return NextResponse.json({
            received: true,
            error: procErr.message,
            debug: { event, extRef: externalRef, paymentId: payment.id, customerId: payment.customer }
          });
        }
      }
    }

    return NextResponse.json({ received: true });

  } catch (err: any) {
    console.error('[ASAAS WEBHOOK] Erro:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
