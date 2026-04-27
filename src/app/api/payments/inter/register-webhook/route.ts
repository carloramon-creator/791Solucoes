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
      interPixKey,
      interAccountNumber
    } = await req.json();

    if (!interCertCrt || !interCertKey || !interPixKey || !interAccountNumber) {
      return NextResponse.json({ success: false, error: 'Certificados, Chave Pix ou Conta Corrente ausentes' }, { status: 400 });
    }

    // Normaliza PEMs antes de usar (corrige quebras de linha corrompidas)
    const certNorm = normalizePem(interCertCrt);
    const keyNorm  = normalizePem(interCertKey);
    const caNorm   = interCertCa ? normalizePem(interCertCa) : undefined;

    console.log('[INTER] cert começa com:', certNorm.substring(0, 40));
    console.log('[INTER] key começa com:', keyNorm.substring(0, 40));
    console.log('[INTER] clientId:', interClientId?.trim());

    // Agente HTTPS padrão
    const httpsAgent = new https.Agent({
      cert: certNorm,
      key: keyNorm,
      ca: caNorm,
      rejectUnauthorized: false,
      keepAlive: true
    });

    // URL oficial de produção da API do Banco Inter
    const interBaseUrl = 'https://cdpj.partners.bancointer.com.br';
    const webhookUrl = 'https://admin.791solucoes.com.br/api/webhooks/inter';

    // 1. Obter Token OAuth — credenciais no body
    console.log('[INTER] Obtendo token para clientId:', interClientId?.trim());
    
    const tokenParams = new URLSearchParams();
    tokenParams.append('client_id', interClientId.trim());
    tokenParams.append('client_secret', interClientSecret.trim());
    // Removido webhook.read e webhook.write porque a credencial não os possui (gera erro 401).
    // Para registrar webhook de cobrança na V3, os escopos de cobrança e rec bastam.
    tokenParams.append('scope', 'pix.read pix.write rec.read rec.write boleto-cobranca.read boleto-cobranca.write');
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
      throw new Error(`OAUTH ${err.response?.status || '500'}: ${JSON.stringify(detail || err.message)}`);
    });

    const accessToken = tokenResponse.data.access_token;
    console.log('[INTER] Token obtido com sucesso!');

    // 2. Registrar Webhook para Pix (usa a permissão pix.write, que a credencial já possui)
    console.log('[INTER] Registrando Webhook de Pix');
    
    await axios.put(
      `${interBaseUrl}/pix/v2/webhook/${interPixKey.trim()}`,
      { webhookUrl },
      {
        httpsAgent,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'x-conta-corrente': interAccountNumber.replace(/\D/g, '')
        },
        timeout: 30000
      }
    ).catch(err => {
      const detail = err.response?.data;
      console.error('[INTER] ERRO WEBHOOK:', detail || err.message);
      throw new Error(`WEBHOOK ${err.response?.status || '500'}: ${JSON.stringify(detail || err.message)}`);
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
