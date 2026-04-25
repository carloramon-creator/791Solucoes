import { NextRequest, NextResponse } from 'next/server';
import { PaymentProcessor } from '@/services/payment-processor';

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
      const payment = body.payment;

      // Se o pagamento foi confirmado
      if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
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

    // --- LÓGICA BANCO INTER ---
    // O Inter manda um array de objetos. Ex: Pix ou Cobrança V2
    if (Array.isArray(body)) {
      for (const item of body) {
        // Se for PIX (V3)
        if (item.pix) {
          for (const p of item.pix) {
            // No Inter, costumamos colocar o externalReference no txid ou no campo de descrição
            // Para a Holding, usaremos o txid ou um campo de metadados se disponível
            if (p.txid) {
              await PaymentProcessor.handlePaymentConfirmed({
                externalReference: p.txid, // No Inter o txid deve ser o nosso externalReference
                value: parseFloat(p.valor),
                paymentMethod: 'PIX',
                bankId: p.endToEndId,
                metadata: { provider: 'inter', type: 'pix' }
              });
            }
          }
        }
        
        // Se for Cobrança/Boleto (V2)
        if (item.cobranca && (item.event === 'COBRANCA_PAGA' || item.event === 'LIQUIDADO')) {
           await PaymentProcessor.handlePaymentConfirmed({
             externalReference: item.cobranca.seuNumero, // 'seuNumero' é o externalReference no Inter
             value: item.cobranca.valorTotal,
             paymentMethod: 'BOLETO',
             bankId: item.cobranca.nossoNumero,
             metadata: { provider: 'inter', type: 'billing' }
           });
        }
      }
      return NextResponse.json({ received: true, provider: 'inter' });
    }

    // Padrão de retorno para sucesso (200) mesmo se não processado, para o banco não ficar reenviando
    return NextResponse.json({ status: 'ok' });

  } catch (error: any) {
    console.error('[WEBHOOK ERROR]:', error.message);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
