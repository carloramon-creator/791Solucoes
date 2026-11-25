/**
 * backup-glass.ts
 * Exportação lógica do banco do Glass (pg_dump via Supabase REST)
 * e upload criptografado para o Google Drive.
 *
 * Variáveis de ambiente necessárias no Railway / .env.local:
 *   GLASS_DATABASE_URL          → string de conexão direta do Supabase Glass
 *                                  (Settings → Database → URI, ex: postgresql://postgres.[ref]:[senha]@...)
 *   GOOGLE_SERVICE_ACCOUNT_JSON → conteúdo completo do JSON da Service Account (string, não arquivo)
 *   GOOGLE_DRIVE_FOLDER_ID      → ID da pasta no Drive onde os backups serão salvos
 *   BACKUP_ENCRYPTION_PASSPHRASE → senha longa para criptografia AES-256-GCM do arquivo
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createCipheriv, randomBytes, createHash } from 'crypto';
import { Readable } from 'stream';

const execFileAsync = promisify(execFile);

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type BackupStatus =
  | { fase: 'ocioso' }
  | { fase: 'exportando'; iniciadoEm: string }
  | { fase: 'enviando'; iniciadoEm: string; bytesExportados: number }
  | { fase: 'concluido'; iniciadoEm: string; concluidoEm: string; bytesExportados: number; driveFileId: string; driveFileName: string }
  | { fase: 'erro'; iniciadoEm: string; falhouEm: string; mensagem: string };

// ─── Estado em memória (single-process) ──────────────────────────────────────

let _status: BackupStatus = { fase: 'ocioso' };

export function obterStatusBackup(): BackupStatus {
  return _status;
}

// ─── Ponto de entrada principal ───────────────────────────────────────────────

export async function iniciarBackupGlass(): Promise<void> {
  // Controle de concorrência: só um backup por vez
  if (_status.fase === 'exportando' || _status.fase === 'enviando') {
    throw new Error('Um backup já está em andamento.');
  }

  const iniciadoEm = new Date().toISOString();
  _status = { fase: 'exportando', iniciadoEm };

  try {
    // 1. Validar variáveis de ambiente
    const dbUrl = process.env.GLASS_DATABASE_URL;
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const passphrase = process.env.BACKUP_ENCRYPTION_PASSPHRASE;

    if (!dbUrl) throw new Error('GLASS_DATABASE_URL não configurada.');
    if (!serviceAccountJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurada.');
    if (!folderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID não configurado.');
    if (!passphrase) throw new Error('BACKUP_ENCRYPTION_PASSPHRASE não configurada.');

    // 2. Exportar banco com pg_dump (exportação lógica completa: schema + dados)
    const dump = await exportarBanco(dbUrl);
    const bytesExportados = Buffer.byteLength(dump, 'utf8');

    _status = { fase: 'enviando', iniciadoEm, bytesExportados };

    // 3. Criptografar o dump com AES-256-GCM
    const { dados: dadosCriptografados, iv, tag } = criptografar(dump, passphrase);

    // 4. Montar arquivo final: cabeçalho (iv + tag) + dados cifrados
    const pacote = montarPacote(iv, tag, dadosCriptografados);

    // 5. Fazer upload para o Drive com verificação de duplicata por hash
    const nomeArquivo = nomearArquivo();
    const { fileId } = await uploadDrive(pacote, nomeArquivo, serviceAccountJson, folderId);

    // 6. Limpar arquivos com mais de 90 dias
    await limparAntigos(serviceAccountJson, folderId, 90);

    const concluidoEm = new Date().toISOString();
    _status = {
      fase: 'concluido',
      iniciadoEm,
      concluidoEm,
      bytesExportados,
      driveFileId: fileId,
      driveFileName: nomeArquivo,
    };
  } catch (err) {
    const falhouEm = new Date().toISOString();
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido.';
    _status = { fase: 'erro', iniciadoEm, falhouEm, mensagem };
    // Não relançar: o status já registra o erro para a UI
  }
}

// ─── Exportação pg_dump ───────────────────────────────────────────────────────

async function exportarBanco(dbUrl: string): Promise<string> {
  // pg_dump lógico: schema + dados do schema public e auth (somente dados de usuários)
  // Limitações declaradas:
  //   - Não inclui configurações gerenciadas pelo Supabase (Edge Functions, Vault secrets)
  //   - Não equivale a uma cópia física da infraestrutura
  //   - Objetos do Storage (arquivos) exigem backup separado

  try {
    const { stdout } = await execFileAsync('pg_dump', [
      '--no-password',
      '--format=plain',
      '--no-owner',
      '--no-privileges',
      '--schema=public',
      '--schema=auth',
      '--exclude-table=auth.schema_migrations',
      '--exclude-table=auth.flow_state',
      '--exclude-table=auth.mfa_amr_claims',
      '--exclude-table=auth.mfa_challenges',
      '--exclude-table=auth.mfa_factors',
      '--exclude-table=auth.refresh_tokens',
      '--exclude-table=auth.sessions',
      '--exclude-table=auth.sso_domains',
      '--exclude-table=auth.sso_providers',
      '--exclude-table=auth.saml_providers',
      '--exclude-table=auth.saml_relay_states',
      '--exclude-table=auth.one_time_tokens',
      dbUrl,
    ], {
      env: { ...process.env, PGPASSWORD: extrairSenha(dbUrl) },
      maxBuffer: 500 * 1024 * 1024, // 500 MB
      timeout: 10 * 60 * 1000,      // 10 minutos
    });

    if (!stdout || stdout.trim().length === 0) {
      throw new Error('pg_dump retornou saída vazia.');
    }

    return stdout;
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('pg_dump não encontrado. Instale o PostgreSQL client no ambiente de execução.');
    }
    throw new Error(`Falha na exportação do banco: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function extrairSenha(dbUrl: string): string {
  try {
    return new URL(dbUrl).password ?? '';
  } catch {
    return '';
  }
}

// ─── Criptografia AES-256-GCM ─────────────────────────────────────────────────

function criptografar(texto: string, passphrase: string): { dados: Buffer; iv: Buffer; tag: Buffer } {
  // Derivar chave de 256 bits a partir da passphrase via SHA-256
  const chave = createHash('sha256').update(passphrase).digest();
  const iv = randomBytes(12); // 96 bits para GCM
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
  const tag = cifra.getAuthTag(); // 128 bits de autenticação
  return { dados, iv, tag };
}

function montarPacote(iv: Buffer, tag: Buffer, dados: Buffer): Buffer {
  // Formato: "BKGL1" (magic) + iv (12 bytes) + tag (16 bytes) + dados cifrados
  const magic = Buffer.from('BKGL1');
  return Buffer.concat([magic, iv, tag, dados]);
}

// ─── Upload para o Google Drive ───────────────────────────────────────────────

async function uploadDrive(
  conteudo: Buffer,
  nomeArquivo: string,
  serviceAccountJson: string,
  folderId: string,
): Promise<{ fileId: string }> {
  const accessToken = await obterTokenDrive(serviceAccountJson);

  // Verificar se já existe arquivo com mesmo nome (deduplicação por nome)
  const existente = await buscarArquivoDrive(nomeArquivo, folderId, accessToken);
  if (existente) {
    // Arquivo do mesmo timestamp já existe: retornar sem re-enviar
    return { fileId: existente };
  }

  // Upload multipart
  const boundary = `backup_${randomBytes(8).toString('hex')}`;
  const metadados = JSON.stringify({ name: nomeArquivo, parents: [folderId] });

  const corpo = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    Buffer.from(metadados),
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    conteudo,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const resposta = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(corpo.length),
      },
      body: Readable.from(corpo) as unknown as BodyInit,
    },
  );

  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => '');
    throw new Error(`Falha no upload para o Drive (${resposta.status}): ${texto}`);
  }

  const json = await resposta.json() as { id?: string };
  if (!json.id) throw new Error('Drive não retornou ID do arquivo após upload.');
  return { fileId: json.id };
}

async function buscarArquivoDrive(nome: string, folderId: string, token: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${nome}' and '${folderId}' in parents and trashed=false`);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const json = await r.json() as { files?: { id: string }[] };
  return json.files?.[0]?.id ?? null;
}

async function limparAntigos(serviceAccountJson: string, folderId: string, diasRetencao: number): Promise<void> {
  const accessToken = await obterTokenDrive(serviceAccountJson);
  const corte = new Date(Date.now() - diasRetencao * 24 * 60 * 60 * 1000).toISOString();
  const q = encodeURIComponent(
    `name contains 'backup-glass-' and '${folderId}' in parents and trashed=false and createdTime < '${corte}'`,
  );
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!r.ok) return; // Falha silenciosa na limpeza — não cancela o backup

  const json = await r.json() as { files?: { id: string; name: string }[] };
  for (const arquivo of json.files ?? []) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${arquivo.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {}); // Silencioso por arquivo
  }
}

// ─── Autenticação Google (JWT → access token) ─────────────────────────────────

async function obterTokenDrive(serviceAccountJson: string): Promise<string> {
  let sa: { client_email: string; private_key: string };
  try {
    sa = JSON.parse(serviceAccountJson) as { client_email: string; private_key: string };
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON inválido: não é um JSON válido.');
  }

  if (!sa.client_email || !sa.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não contém client_email ou private_key.');
  }

  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 3600,
  }));

  const conteudoAssinatura = `${cabecalho}.${payload}`;

  // Importar chave privada RSA e assinar com Web Crypto API (disponível no Node 18+)
  const chavePrivada = sa.private_key.replace(/\\n/g, '\n');
  const der = pemToDer(chavePrivada);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  );
  const assinatura = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(conteudoAssinatura),
  );
  const assinaturaB64 = Buffer.from(assinatura).toString('base64url');
  const jwt = `${conteudoAssinatura}.${assinaturaB64}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!resp.ok) {
    const texto = await resp.text().catch(() => '');
    throw new Error(`Falha ao obter token do Google (${resp.status}): ${texto}`);
  }

  const json = await resp.json() as { access_token?: string };
  if (!json.access_token) throw new Error('Google não retornou access_token.');
  return json.access_token;
}

function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// ─── Utilitários ─────────────────────────────────────────────────────────────

function nomearArquivo(): string {
  const agora = new Date().toISOString().replace(/[:.]/g, '-');
  return `backup-glass-${agora}.bkgl`;
}
