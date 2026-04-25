import { NextResponse } from 'next/server';
import https from 'https';
import axios from 'axios';

export async function POST(req: Request) {
  try {
    const { 
      interClientId, 
      interClientSecret, 
      interCertCrt, 
      interCertKey,
      interCertCa,
      interPixKey 
    } = await req.json();

    if (!interCertCrt || !interCertKey || !interPixKey) {
      return NextResponse.json({ success: false, error: 'Certificados ou Chave Pix ausentes' }, { status: 400 });
    }

    // ... (rest of agent config)
    const httpsAgent = new https.Agent({
      cert: interCertCrt,
      key: interCertKey,
      ca: interCertCa,
      rejectUnauthorized: false
    });

    const interBaseUrl = 'https://cdpj.partners.bancointer.com.br';
    const webhookUrl = 'https://api.791solucoes.com.br/api/webhooks/inter';

    // 1. Obter Token OAuth
    console.log('Tentando obter token Inter para o Client ID:', interClientId);
    
    const tokenResponse = await axios.post(
      `${interBaseUrl}/oauth/v2/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'pix.read pix.write' // Simplificado para o essencial
      }).toString(),
      {
        httpsAgent,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${interClientId}:${interClientSecret}`).toString('base64')}`
        }
      }
    ).catch(err => {
      console.error('ERRO OAUTH INTER:', err.response?.data || err.message);
      throw err;
    });

    const accessToken = tokenResponse.data.access_token;
    console.log('Token obtido com sucesso!');

    // 2. Registrar Webhook para a Chave Pix específica
    console.log('Registrando Webhook para a chave:', interPixKey);
    
    await axios.put(
      `${interBaseUrl}/pix/v2/webhook/${interPixKey}`,
      { webhookUrl },
      {
        httpsAgent,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    ).catch(err => {
      console.error('ERRO WEBHOOK INTER:', err.response?.data || err.message);
      throw err;
    });

    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error('Erro no Registro Inter:', err.response?.data || err.message);
    return NextResponse.json({ 
      success: false, 
      error: err.response?.data?.title || err.response?.data?.detail || err.message 
    }, { status: 500 });
  }
}
