import { NextResponse } from 'next/server';
import https from 'https';
import axios from 'axios';

// Normaliza certificados PEM que podem ter quebras de linha corrompidas
// ao serem salvos/recuperados do banco de dados como texto
function normalizePem(pem: string): string {
  if (!pem) return pem;
  // Remove espaços extras no início/fim e garante que quebras de linha sejam \n reais
  let normalized = pem.trim();
  normalized = normalized.replace(/\\n/g, '\n');
  normalized = normalized.replace(/\r\n/g, '\n');
  // Garante que o certificado comece e termine corretamente
  if (!normalized.includes('-----BEGIN')) return normalized;
  return normalized;
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

    // Normaliza PEMs com rigor extra
    const certNorm = normalizePem(interCertCrt);
    const keyNorm  = normalizePem(interCertKey);
    const caNorm   = interCertCa ? normalizePem(interCertCa) : undefined;

    const webhookUrl = 'https://admin.791solucoes.com.br/api/webhooks/inter';

    // 1. Obter Token OAuth
    const getAccessToken = () => new Promise<string>((resolve, reject) => {
      const params = new URLSearchParams();
      params.append('client_id', interClientId.trim());
      params.append('client_secret', interClientSecret.trim());
      params.append('scope', 'pix.read pix.write rec.read rec.write boleto-cobranca.read boleto-cobranca.write');
      params.append('grant_type', 'client_credentials');
      
      const body = params.toString();
      const options = {
        hostname: 'cdpj.partners.bancointer.com.br',
        port: 443,
        path: '/oauth/v2/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        },
        cert: certNorm,
        key: keyNorm,
        ca: caNorm || undefined,
        rejectUnauthorized: false,
        family: 4
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

    // 2. Tentar Registrar Webhook (Tenta Cobrança, se falhar tenta Pix)
    const registerWebhook = (token: string, path: string) => new Promise((resolve, reject) => {
      const body = JSON.stringify({ webhookUrl });
      const options = {
        hostname: 'cdpj.partners.bancointer.com.br',
        port: 443,
        path: path,
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'x-conta-corrente': interAccountNumber.replace(/\D/g, '')
        },
        cert: certNorm,
        key: keyNorm,
        ca: caNorm || undefined,
        rejectUnauthorized: false,
        family: 4
      };

      const reqWeb = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 204 || res.statusCode === 201) {
            resolve(true);
          } else {
            reject(new Error(`${res.statusCode}: ${data}`));
          }
        });
      });
      reqWeb.on('error', reject);
      reqWeb.write(body);
      reqWeb.end();
    });

    try {
      console.log('[INTER] Tentando Webhook de Cobrança...');
      await registerWebhook(accessToken, '/cobranca/v3/cobrancas/webhook');
    } catch (e: any) {
      console.warn('[INTER] Falha na Cobrança, tentando Pix...', e.message);
      await registerWebhook(accessToken, `/pix/v2/webhook/${interPixKey.trim().replace(/-/g, '')}`);
    }

    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error('[INTER] Erro final:', err.message);
    return NextResponse.json({ 
      success: false, 
      error: err.message || 'Erro desconhecido'
    }, { status: 500 });
  }
}
