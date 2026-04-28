import { NextResponse } from 'next/server';
import { PaymentProcessor } from '@/services/payment-processor';
import { supabase } from '@/lib/supabase';

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

    // Verificamos se o pagamento foi confirmado
    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED_IN_CASH') {
      console.log(`[ASAAS WEBHOOK] Pagamento confirmado: ${payment.id} (Ref: ${externalRef})`);

      // CASO 1: Lançamento Financeiro da Holding
      if (externalRef.startsWith('finance_record|')) {
        const recordId = externalRef.split('|')[1];
        
        console.log(`[ASAAS WEBHOOK] Baixa automática no financeiro: ${recordId}`);
        
        const { error } = await supabase
          .from('system_finance_records')
          .update({ 
            status: 'paid',
            updated_at: new Date().toISOString(),
            metadata: { 
              asaas_payment_id: payment.id,
              confirmed_at: new Date().toISOString(),
              billing_type: payment.billingType
            }
          })
          .eq('id', recordId);

        if (error) console.error('[ASAAS WEBHOOK] Erro ao atualizar financeiro:', error.message);
      } 
      
      // CASO 2: Assinaturas SaaS (Glass/Barber)
      else if (externalRef.startsWith('glass|') || externalRef.startsWith('barber|')) {
        await PaymentProcessor.handlePaymentConfirmed({
          externalReference: externalRef,
          value: payment.value,
          paymentMethod: payment.billingType === 'PIX' ? 'Pix' : (payment.billingType === 'CREDIT_CARD' ? 'Cartão' : 'Boleto'),
          bankId: 'Asaas',
          metadata: payment
        });
      }
    }

    return NextResponse.json({ received: true });

  } catch (err: any) {
    console.error('[ASAAS WEBHOOK] Erro:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
