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

    // 1. Obter Token OAuth — Usando HTTPS nativo igual ao Barber
    const getAccessToken = () => new Promise<string>((resolve, reject) => {
      const params = new URLSearchParams();
      params.append('client_id', interClientId.trim());
      params.append('client_secret', interClientSecret.trim());
      // Pedindo apenas os escopos de Cobrança, que você confirmou que tem habilitado
      params.append('scope', 'boleto-cobranca.read boleto-cobranca.write');
      params.append('grant_type', 'client_credentials');
      
      const body = params.toString();
      const options = {
        hostname: 'cdpj.partners.bancointer.com.br',
        path: '/oauth/v2/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        },
        cert: certNorm,
        key: keyNorm,
        ca: caNorm, // Faltava isso!
        rejectUnauthorized: false
      };

      const reqToken = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data).access_token);
          } else {
            reject(new Error(`OAUTH ${res.statusCode}: ${data}`));
          }
        });
      });
      reqToken.on('error', reject);
      reqToken.write(body);
      reqToken.end();
    });

    const accessToken = await getAccessToken();
    console.log('[INTER] Token obtido com sucesso!');

    // 2. Registrar Webhook — Usando HTTPS nativo igual ao Barber
    const registerWebhook = (token: string) => new Promise((resolve, reject) => {
      const body = JSON.stringify({ webhookUrl });
      const options = {
        hostname: 'cdpj.partners.bancointer.com.br',
        path: '/cobranca/v3/cobrancas/webhook',
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'x-conta-corrente': interAccountNumber.replace(/\D/g, '')
        },
        cert: certNorm,
        key: keyNorm,
        ca: caNorm, // Faltava isso!
        rejectUnauthorized: false
      };

      const reqWeb = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 204 || res.statusCode === 201) {
            resolve(true);
          } else {
            reject(new Error(`WEBHOOK ${res.statusCode}: ${data}`));
          }
        });
      });
      reqWeb.on('error', reject);
      reqWeb.write(body);
      reqWeb.end();
    });

    await registerWebhook(accessToken);
    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error('[INTER] Erro final:', err.message);
    return NextResponse.json({ 
      success: false, 
      error: err.message || 'Erro desconhecido'
    }, { status: 500 });
  }
}
