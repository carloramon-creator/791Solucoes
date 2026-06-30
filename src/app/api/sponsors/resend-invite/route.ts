import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      throw new Error('E-mail não fornecido.');
    }

    const holdingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const holdingServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(holdingUrl, holdingServiceKey);

    // Enviar e-mail de recuperação de senha (funciona como reenvio de acesso)
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: 'E-mail de acesso reenviado com sucesso!'
    });

  } catch (err: any) {
    console.error('[RESEND INVITE ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
