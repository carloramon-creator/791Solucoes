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

    // Gerar link de recuperação de senha (funciona como link de ativação/primeiro acesso)
    const origin = req.headers.get('origin') || 'http://localhost:3000';
    const { data: linkData, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${origin}/login`
      }
    });

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      link: linkData?.properties?.action_link || null,
      message: 'Link de acesso gerado com sucesso!'
    });

  } catch (err: any) {
    console.error('[RESEND INVITE ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
