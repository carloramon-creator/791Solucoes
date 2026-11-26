#!/usr/bin/env node
/**
 * restaurar-backup-glass.mjs
 * Descriptografa arquivos .bkgl (formatos BKGL1 e BKGL2) e permite:
 *   1) Extrair o SQL para inspeção local:
 *      BACKUP_ENCRYPTION_PASSPHRASE="..." node scripts/restaurar-backup-glass.mjs --extrair caminho/arquivo.bkgl
 *
 *   2) Restaurar em um projeto Supabase ISOLADO (nunca produção):
 *      BACKUP_ENCRYPTION_PASSPHRASE="..." TARGET_DATABASE_URL="postgresql://..." \
 *        node scripts/restaurar-backup-glass.mjs --restaurar caminho/arquivo.bkgl --confirmar-destino-isolado
 */

import { readFileSync, writeFileSync } from 'fs';
import { createDecipheriv, createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { spawnSync } from 'child_process';
import { basename, dirname, join } from 'path';

function uso() {
  console.error(`
Uso:
  Extrair SQL para inspeção:
    BACKUP_ENCRYPTION_PASSPHRASE="..." node scripts/restaurar-backup-glass.mjs --extrair <arquivo.bkgl>

  Restaurar em banco isolado (NUNCA use em produção):
    BACKUP_ENCRYPTION_PASSPHRASE="..." TARGET_DATABASE_URL="postgresql://..." \\
      node scripts/restaurar-backup-glass.mjs --restaurar <arquivo.bkgl> --confirmar-destino-isolado
`);
  process.exit(1);
}

function descriptografarPacote(buffer, passphrase) {
  if (buffer.length < 33) {
    throw new Error('Arquivo .bkgl inválido ou corrompido (tamanho insuficiente).');
  }

  const magic = buffer.subarray(0, 5).toString('utf8');
  if (magic !== 'BKGL1' && magic !== 'BKGL2') {
    throw new Error(`Cabeçalho desconhecido: "${magic}". Esperado BKGL1 ou BKGL2.`);
  }

  const iv = buffer.subarray(5, 17);
  const tag = buffer.subarray(17, 33);
  const cifrado = buffer.subarray(33);

  const chave = createHash('sha256').update(passphrase).digest();
  const decifra = createDecipheriv('aes-256-gcm', chave, iv);
  decifra.setAuthTag(tag);

  let plano;
  try {
    plano = Buffer.concat([decifra.update(cifrado), decifra.final()]);
  } catch {
    throw new Error('Falha ao descriptografar: senha incorreta ou arquivo corrompido.');
  }

  if (magic === 'BKGL2') {
    return gunzipSync(plano).toString('utf8');
  }
  return plano.toString('utf8');
}

function validarDestinoIsolado(targetUrl) {
  const prodUrl = process.env.GLASS_DATABASE_URL;
  if (prodUrl && targetUrl === prodUrl) {
    throw new Error('BLOQUEADO: TARGET_DATABASE_URL é idêntica a GLASS_DATABASE_URL (produção).');
  }

  // Bloquear o ref conhecido de produção do 791 Glass por segurança extra
  if (targetUrl.includes('caoeeydnffcpxyyhgihz')) {
    throw new Error('BLOQUEADO: TARGET_DATABASE_URL aponta para o projeto de produção do 791 Glass.');
  }
}

function main() {
  const args = process.argv.slice(2);
  const modoExtrair = args.includes('--extrair');
  const modoRestaurar = args.includes('--restaurar');
  const confirmado = args.includes('--confirmar-destino-isolado');

  if (modoExtrair === modoRestaurar) uso();

  const arquivoIdx = args.indexOf(modoExtrair ? '--extrair' : '--restaurar') + 1;
  const caminhoArquivo = args[arquivoIdx];
  if (!caminhoArquivo || caminhoArquivo.startsWith('--')) uso();

  const passphrase = process.env.BACKUP_ENCRYPTION_PASSPHRASE;
  if (!passphrase) {
    console.error('Erro: defina BACKUP_ENCRYPTION_PASSPHRASE no ambiente.');
    process.exit(1);
  }

  console.log(`Lendo ${caminhoArquivo}...`);
  const conteudo = readFileSync(caminhoArquivo);
  const sql = descriptografarPacote(conteudo, passphrase);
  console.log(`Descriptografado com sucesso (${Math.round(Buffer.byteLength(sql, 'utf8') / 1024)} KB de SQL).`);

  if (modoExtrair) {
    const saida = join(dirname(caminhoArquivo), `${basename(caminhoArquivo, '.bkgl')}.sql`);
    writeFileSync(saida, sql, 'utf8');
    console.log(`SQL salvo em: ${saida}`);
    return;
  }

  if (!confirmado) {
    console.error('Erro: para restaurar, adicione a flag --confirmar-destino-isolado.');
    process.exit(1);
  }

  const targetUrl = process.env.TARGET_DATABASE_URL;
  if (!targetUrl) {
    console.error('Erro: defina TARGET_DATABASE_URL apontando para o projeto Supabase isolado.');
    process.exit(1);
  }

  validarDestinoIsolado(targetUrl);

  console.log('Executando restauração via psql no banco isolado...');
  const resultado = spawnSync('psql', ['--no-password', '--set', 'ON_ERROR_STOP=1', targetUrl], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
    maxBuffer: 500 * 1024 * 1024,
  });

  if (resultado.error) {
    throw new Error(`Falha ao executar psql: ${resultado.error.message}`);
  }
  if (resultado.status !== 0) {
    throw new Error(`psql encerrou com código ${resultado.status}.`);
  }

  console.log('Restauração concluída com sucesso no projeto isolado.');
}

try {
  main();
} catch (err) {
  console.error('Erro:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
