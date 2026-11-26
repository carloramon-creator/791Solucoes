/**
 * backup-glass-storage.ts
 * Exportação em stream de todos os objetos dos buckets do Supabase Storage do Glass,
 * empacotamento em formato tar/gzip, criptografia AES-256-GCM e upload para o Google Drive.
 */

import { createCipheriv, randomBytes, createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { gzipSync } from 'zlib';

export type StorageBackupStatus =
  | { fase: 'ocioso' }
  | { fase: 'listando'; iniciadoEm: string }
  | { fase: 'baixando'; iniciadoEm: string; totalArquivos: number; processados: number; bytesBaixados: number }
  | { fase: 'enviando'; iniciadoEm: string; totalArquivos: number; bytesEnviados: number }
  | { fase: 'concluido'; iniciadoEm: string; concluidoEm: string; totalArquivos: number; bytesEnviados: number; driveFileId: string; driveFileName: string }
  | { fase: 'erro'; iniciadoEm: string; falhouEm: string; mensagem: string };

let _statusStorage: StorageBackupStatus = { fase: 'ocioso' };

export function obterStatusStorageBackup(): StorageBackupStatus {
  return _statusStorage;
}

// ─── Criação de arquivo TAR simples em memória (Pure Node, sem dependências externas) ──
function criarTarHeader(caminho: string, tamanho: number): Buffer {
  const header = Buffer.alloc(512);
  // Name (0-99)
  header.write(caminho.slice(0, 100), 0, 100, 'utf8');
  // Mode (100-107): 0000644
  header.write('0000644\0', 100, 8, 'utf8');
  // UID (108-115)
  header.write('0000000\0', 108, 8, 'utf8');
  // GID (116-123)
  header.write('0000000\0', 116, 8, 'utf8');
  // Size in octal (124-135)
  const sizeOctal = tamanho.toString(8).padStart(11, '0') + '\0';
  header.write(sizeOctal, 124, 12, 'utf8');
  // Mtime (136-147)
  const mtimeOctal = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0';
  header.write(mtimeOctal, 136, 12, 'utf8');
  // Typeflag (156): '0' = regular file
  header.write('0', 156, 1, 'utf8');

  // Checksum calculation (148-155: preenchido com espaços antes da soma)
  header.fill(32, 148, 156);
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }
  const checksumOctal = checksum.toString(8).padStart(6, '0') + '\0 ';
  header.write(checksumOctal, 148, 8, 'utf8');

  return header;
}

export async function iniciarBackupStorageGlass(): Promise<void> {
  if (_statusStorage.fase === 'listando' || _statusStorage.fase === 'baixando' || _statusStorage.fase === 'enviando') {
    throw new Error('Um backup do Storage já está em andamento.');
  }

  const iniciadoEm = new Date().toISOString();
  _statusStorage = { fase: 'listando', iniciadoEm };

  try {
    const glassUrl = process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL;
    const glassServiceKey = process.env.SUPABASE_GLASS_SERVICE_ROLE_KEY;
    const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const oauthRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const passphrase = process.env.BACKUP_ENCRYPTION_PASSPHRASE;

    if (!glassUrl || !glassServiceKey) throw new Error('SUPABASE_GLASS_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_GLASS_URL não configurados.');
    if (!oauthClientId || !oauthClientSecret || !oauthRefreshToken) throw new Error('Credenciais Google OAuth2 não configuradas.');
    if (!folderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID não configurado.');
    if (!passphrase) throw new Error('BACKUP_ENCRYPTION_PASSPHRASE não configurada.');

    const glass = createClient(glassUrl, glassServiceKey, { auth: { persistSession: false } });

    // 1. Listar todos os buckets existentes
    const { data: buckets, error: bucketsErr } = await glass.storage.listBuckets();
    if (bucketsErr) throw new Error(`Falha ao listar buckets do Glass: ${bucketsErr.message}`);

    // 2. Varrer recursivamente todos os arquivos de cada bucket
    type ArquivoItem = { bucket: string; caminho: string; nome: string };
    const todosArquivos: ArquivoItem[] = [];

    async function listarRecursivo(bucket: string, prefixo: string = ''): Promise<void> {
      const { data: itens, error } = await glass.storage.from(bucket).list(prefixo, { limit: 1000 });
      if (error) {
        console.warn(`[backup-storage] Erro ao listar ${bucket}/${prefixo}:`, error.message);
        return;
      }
      for (const item of itens || []) {
        if (!item.id && !item.metadata) {
          // É uma subpasta
          const subcaminho = prefixo ? `${prefixo}/${item.name}` : item.name;
          await listarRecursivo(bucket, subcaminho);
        } else {
          // É arquivo
          const caminhoCompleto = prefixo ? `${prefixo}/${item.name}` : item.name;
          todosArquivos.push({ bucket, caminho: caminhoCompleto, nome: item.name });
        }
      }
    }

    for (const b of buckets || []) {
      await listarRecursivo(b.name, '');
    }

    _statusStorage = {
      fase: 'baixando',
      iniciadoEm,
      totalArquivos: todosArquivos.length,
      processados: 0,
      bytesBaixados: 0,
    };

    // 3. Montar arquivos no formato TAR em memória
    const blocosTar: Buffer[] = [];
    let bytesBaixados = 0;
    let processados = 0;

    for (const item of todosArquivos) {
      const { data: blob, error: downloadErr } = await glass.storage.from(item.bucket).download(item.caminho);
      if (downloadErr || !blob) {
        console.warn(`[backup-storage] Falha no download de ${item.bucket}/${item.caminho}:`, downloadErr?.message);
        processados++;
        continue;
      }

      const bufferArquivo = Buffer.from(await blob.arrayBuffer());
      bytesBaixados += bufferArquivo.length;
      processados++;

      const caminhoNoTar = `${item.bucket}/${item.caminho}`;
      const header = criarTarHeader(caminhoNoTar, bufferArquivo.length);
      blocosTar.push(header);
      blocosTar.push(bufferArquivo);

      // Alinhamento de 512 bytes no TAR
      const resto512 = bufferArquivo.length % 512;
      if (resto512 !== 0) {
        blocosTar.push(Buffer.alloc(512 - resto512));
      }

      if (processados % 100 === 0 || processados === todosArquivos.length) {
        _statusStorage = {
          fase: 'baixando',
          iniciadoEm,
          totalArquivos: todosArquivos.length,
          processados,
          bytesBaixados,
        };
      }
    }

    // Fim do arquivo TAR: dois blocos de 512 bytes zerados
    blocosTar.push(Buffer.alloc(1024));
    const arquivoTarCompleto = Buffer.concat(blocosTar);

    // 4. Compactar com gzip (nível 6)
    const comprimido = gzipSync(arquivoTarCompleto, { level: 6 });

    // 5. Criptografar com AES-256-GCM (formato BKSG1)
    const iv = randomBytes(12);
    const chave = createHash('sha256').update(passphrase).digest();
    const cifra = createCipheriv('aes-256-gcm', chave, iv);
    const cifrado = Buffer.concat([cifra.update(comprimido), cifra.final()]);
    const tag = cifra.getAuthTag();

    const pacote = Buffer.concat([
      Buffer.from('BKSG1', 'utf8'), // Magic bytes: Backup Glass Storage 1
      iv,
      tag,
      cifrado,
    ]);

    _statusStorage = {
      fase: 'enviando',
      iniciadoEm,
      totalArquivos: todosArquivos.length,
      bytesEnviados: pacote.length,
    };

    // 6. Token OAuth2 e Upload para o Google Drive
    const accessToken = await obterTokenOAuth(oauthClientId, oauthClientSecret, oauthRefreshToken);
    const nomeArquivo = `backup-glass-storage-${new Date().toISOString().replace(/[:.]/g, '-')}.bksg`;

    const metadata = {
      name: nomeArquivo,
      parents: [folderId],
      description: `Backup criptografado do Supabase Storage (${todosArquivos.length} arquivos). Formato BKSG1.`,
    };

    const boundary = '-------791glassBoundary' + Math.random().toString(36).substring(2);
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartRequestBody = Buffer.concat([
      Buffer.from(
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/octet-stream\r\n\r\n',
      ),
      pacote,
      Buffer.from(closeDelimiter),
    ]);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: new Uint8Array(multipartRequestBody),
      },
    );

    if (!uploadRes.ok) {
      const errTexto = await uploadRes.text().catch(() => '');
      throw new Error(`Falha no upload do Storage para o Google Drive (${uploadRes.status}): ${errTexto}`);
    }

    const { id: fileId } = await uploadRes.json() as { id: string };
    const concluidoEm = new Date().toISOString();

    _statusStorage = {
      fase: 'concluido',
      iniciadoEm,
      concluidoEm,
      totalArquivos: todosArquivos.length,
      bytesEnviados: pacote.length,
      driveFileId: fileId,
      driveFileName: nomeArquivo,
    };
  } catch (err) {
    const falhouEm = new Date().toISOString();
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido no backup do Storage.';
    _statusStorage = { fase: 'erro', iniciadoEm, falhouEm, mensagem };
    console.error('[backup-storage] Erro:', err);
  }
}

async function obterTokenOAuth(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!resp.ok) {
    const texto = await resp.text().catch(() => '');
    throw new Error(`Falha ao renovar token OAuth do Google (${resp.status}): ${texto}`);
  }

  const json = await resp.json() as { access_token?: string };
  if (!json.access_token) throw new Error('Google não retornou access_token (OAuth).');
  return json.access_token;
}
