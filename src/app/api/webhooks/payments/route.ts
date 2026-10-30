import { NextRequest, NextResponse } from 'next/server';
import { PaymentProcessor } from '@/services/payment-processor';
import { fetchVerifiedAsaasPayment } from '@/lib/asaas-webhook-verify';

/**
 * Webhook Universal da Holding 791 Soluções
 * Suporta Asaas e Banco Inter
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userAgent = req.headers.get('user-agent') || '';

    console.log('[WEBHOOK] Notificação recebida:', JSON.stringify(body, null, 2));

    // --- LÓGICA ASAAS ---
    if (body.event && body.payment) {
      const event = body.event;

      // Se o pagamento foi confirmado
      if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
        const verified = await fetchVerifiedAsaasPayment(body.payment?.id);
        if (!verified.ok) {
          console.warn(`[WEBHOOK] Pagamento Asaas não confirmado: ${verified.reason}`);
          if (verified.retry) return NextResponse.json({ error: verified.reason }, { status: 503 });
          return NextResponse.json({ received: true, ignored: verified.reason });
        }
        const payment = verified.payment;
        await PaymentProcessor.handlePaymentConfirmed({
          externalReference: payment.externalReference,
          value: payment.value,
          paymentMethod: payment.billingType,
          bankId: payment.id,
          metadata: { provider: 'asaas', event }
        });
      }
      
      return NextResponse.json({ received: true, provider: 'asaas' });
    }

    // Banco Inter: o webhook dele aponta para /api/webhooks/inter e este corpo não tem
    // como ser autenticado aqui; ignorado para não permitir baixas forjadas.
    if (Array.isArray(body)) {
      console.warn('[WEBHOOK] Notificação estilo Inter ignorada (não autenticável).');
      return NextResponse.json({ received: true, provider: 'inter', ignored: 'unauthenticated' });
    }

    // Padrão de retorno para sucesso (200) mesmo se não processado, para o banco não ficar reenviando
    return NextResponse.json({ status: 'ok' });

  } catch (error: any) {
    console.error('[WEBHOOK ERROR]:', error.message);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
