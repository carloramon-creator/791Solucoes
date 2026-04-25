import { NextResponse } from 'next/server';
import https from 'https';
import axios from 'axios';

// Normaliza certificados PEM que podem ter quebras de linha corrompidas
// ao serem salvos/recuperados do banco de dados como texto
function normalizePem(pem: string): string {
  if (!pem) return pem;
  const trimmed = pem.trim();
  // Detecta se as quebras de linha foram substituídas por \n literal (string)
  if (!trimmed.includes('\n') && trimmed.includes('\\n')) {
    return trimmed.replace(/\\n/g, '\n');
  }
  return trimmed;
}

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

    // Normaliza PEMs antes de usar (corrige quebras de linha corrompidas)
    const certNorm = normalizePem(interCertCrt);
    const keyNorm  = normalizePem(interCertKey);
    const caNorm   = interCertCa ? normalizePem(interCertCa) : undefined;

    console.log('[INTER] cert começa com:', certNorm.substring(0, 40));
    console.log('[INTER] key começa com:', keyNorm.substring(0, 40));
    console.log('[INTER] clientId:', interClientId?.trim());

    // Agente HTTPS simples — sem lookup customizado (que quebra o DNS no Vercel)
    const httpsAgent = new https.Agent({
      cert: certNorm,
      key: keyNorm,
      ca: caNorm,
      rejectUnauthorized: false
    });

    // URL da nova plataforma do Banco Inter
    const interBaseUrl = 'https://cdp.inter.co';
    const webhookUrl = 'https://api.791solucoes.com.br/api/webhooks/inter';

    // 1. Obter Token OAuth — credenciais no body (padrão Inter API v2)
    console.log('[INTER] Obtendo token para clientId:', interClientId?.trim());
    
    const tokenParams = new URLSearchParams();
    tokenParams.append('client_id', interClientId.trim());
    tokenParams.append('client_secret', interClientSecret.trim());
    tokenParams.append('scope', 'pix.read pix.write webhook.read webhook.write');
    tokenParams.append('grant_type', 'client_credentials');

    const tokenResponse = await axios.post(
      `${interBaseUrl}/oauth/v2/token`,
      tokenParams,
      {
        httpsAgent,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000
      }
    ).catch(err => {
      const detail = err.response?.data;
      console.error('[INTER] ERRO OAUTH:', detail || err.message);
      throw new Error(`OAUTH ${err.response?.status}: ${JSON.stringify(detail || err.message)}`);
    });

    const accessToken = tokenResponse.data.access_token;
    console.log('[INTER] Token obtido com sucesso!');

    // 2. Registrar Webhook para a Chave Pix específica
    console.log('[INTER] Registrando Webhook para a chave:', interPixKey);
    
    await axios.put(
      `${interBaseUrl}/pix/v2/webhook/${interPixKey}`,
      { webhookUrl },
      {
        httpsAgent,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    ).catch(err => {
      const detail = err.response?.data;
      console.error('[INTER] ERRO WEBHOOK:', detail || err.message);
      throw new Error(`WEBHOOK ${err.response?.status}: ${JSON.stringify(detail || err.message)}`);
    });

    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error('[INTER] Erro final:', err.message);
    return NextResponse.json({ 
      success: false, 
      error: err.message || 'Erro desconhecido'
    }, { status: 500 });
  }
}
