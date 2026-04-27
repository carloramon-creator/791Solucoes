import { NextResponse } from 'next/server';
import { PaymentProcessor } from '@/services/payment-processor';

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    console.log('[ASAAS WEBHOOK] Recebido:', JSON.stringify(payload, null, 2));

    const event = payload.event;
    const payment = payload.payment;

    // Verificamos se o pagamento foi confirmado
    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      console.log(`[ASAAS WEBHOOK] Pagamento confirmado: ${payment.id}`);

      // Chamar o processador central para atualizar o SaaS (Glass ou Barber)
      await PaymentProcessor.handlePaymentConfirmed({
        externalReference: payment.externalReference, // Deve ser "glass|tenant_id"
        value: payment.value,
        paymentMethod: payment.billingType === 'PIX' ? 'Pix' : 'Cartão',
        bankId: 'Asaas',
        metadata: payment
      });
    }

    return NextResponse.json({ received: true });

  } catch (err: any) {
    console.error('[ASAAS WEBHOOK] Erro:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
