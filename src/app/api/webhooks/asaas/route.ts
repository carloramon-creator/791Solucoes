import { NextResponse } from 'next/server';
import { emitirNFeExcedentePago, PaymentProcessor } from '@/services/payment-processor';
import { supabaseServer } from '@/lib/supabase-server';
import { fetchVerifiedAsaasPayment } from '@/lib/asaas-webhook-verify';
import { createClient } from '@supabase/supabase-js';
import { releaseOverageBlock } from '@/lib/overage-block';

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    console.log('[ASAAS WEBHOOK] Recebido:', JSON.stringify(payload, null, 2));

    // Validar Token de Segurança (Opcional se configurado)
    const asaasToken = req.headers.get('asaas-access-token');
    
    // Buscar config para validar token
    const { data: config } = await supabaseServer
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
    let payment = payload.payment || {};
    let externalRef = payment.externalReference || '';

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
      const verified = await fetchVerifiedAsaasPayment(payment.id);
      if (!verified.ok) {
        console.warn(`[ASAAS WEBHOOK] Pagamento ${payment.id} não confirmado pelo Asaas: ${verified.reason}`);
        // retry=true: falha transitória (Asaas fora do ar) -> 503 para o Asaas reenviar.
        if (verified.retry) return NextResponse.json({ error: verified.reason }, { status: 503 });
        return NextResponse.json({ received: true, ignored: verified.reason });
      }
      payment = verified.payment;
      externalRef = payment.externalReference || '';
      console.log(`[ASAAS WEBHOOK] Pagamento confirmado: ${payment.id} (Ref: ${externalRef})`);

      // CASO 1: Lançamento Financeiro da Holding
      if (externalRef.startsWith('finance_record|')) {
        const recordId = externalRef.split('|')[1];
        
        console.log(`[ASAAS WEBHOOK] Baixa automática no financeiro: ${recordId}`);
        
        const { data: financeRecord, error: financeRecordError } = await holdingService
          .from('system_finance_records')
          .select('id, value, metadata')
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
            try {
              await releaseOverageBlock({ glassSupabase: glassService, recordId, status: 'paid' });
            } catch (releaseError) {
              console.error('[ASAAS WEBHOOK] Falha ao liberar bloqueio do excedente:', releaseError instanceof Error ? releaseError.message : releaseError);
            }

            try {
              await emitirNFeExcedentePago({
                holdingSupabase: holdingService,
                glassSupabase: glassService,
                financeRecordId: recordId,
                metadata: mergedMetadata,
                valor: Number(financeRecord.value || payment.value || 0),
                asaasPaymentId: String(payment.id || ''),
              });
            } catch (invoiceError: any) {
              console.error('[ASAAS WEBHOOK] Falha ao emitir NF-e do excedente:', invoiceError?.message || invoiceError);
            }
          } else if (String(existingMetadata.kind || '') === 'extra_quotas') {
             const sponsorId = existingMetadata.sponsor_id;
             const qty = Number(existingMetadata.quantity) || 0;
             if (sponsorId && qty > 0) {
                const { data: sponsor } = await holdingService.from('patrocinadores').select('total_licencas, nome').eq('id', sponsorId).single();
                if (sponsor) {
                    await holdingService.from('patrocinadores').update({
                       total_licencas: Number(sponsor.total_licencas) + qty
                    }).eq('id', sponsorId);
                    
                    const prefix = sponsor.nome.substring(0, 4).toUpperCase().replace(/\s/g, '');
                    const vouchersToInsert = Array.from({ length: qty }, () => {
                      const random = Math.floor(1000 + Math.random() * 9000);
                      const suffix = Math.random().toString(36).substring(2, 4).toUpperCase();
                      return {
                        codigo: `791-${prefix}-${random}-${suffix}`,
                        patrocinador_id: sponsorId
                      };
                    });
                    if (vouchersToInsert.length > 0) {
                      await holdingService.from('vouchers').insert(vouchersToInsert);
                    }
                    console.log(`[ASAAS WEBHOOK] ${qty} cotas extras criadas para patrocinador ${sponsorId}`);
                }
             }
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
