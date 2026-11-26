#!/usr/bin/env node
/**
 * restaurar-via-node.mjs
 * Restaura um .bkgl diretamente via Node.js (sem precisar de psql instalado).
 * Usa o pacote `pg` para executar o SQL no banco de destino.
 *
 * Uso:
 *   BACKUP_ENCRYPTION_PASSPHRASE="..." \
 *   TARGET_DATABASE_URL="postgresql://..." \
 *     node scripts/restaurar-via-node.mjs caminho/arquivo.bkgl
 */

import { readFileSync } from 'fs';
import { createDecipheriv, createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

function descriptografar(buffer, passphrase) {
  if (buffer.length < 33) throw new Error('Arquivo .bkgl inválido ou corrompido.');
  const magic = buffer.subarray(0, 5).toString('utf8');
  if (magic !== 'BKGL1' && magic !== 'BKGL2') throw new Error(`Formato desconhecido: "${magic}". Esperado BKGL1 ou BKGL2.`);
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
  return magic === 'BKGL2' ? gunzipSync(plano).toString('utf8') : plano.toString('utf8');
}

function validarDestino(url) {
  if (!url) throw new Error('TARGET_DATABASE_URL não definida.');
  const prod = process.env.GLASS_DATABASE_URL ?? '';
  if (prod && url === prod) throw new Error('BLOQUEADO: TARGET_DATABASE_URL é idêntica à produção.');
  if (url.includes('caoeeydnffcpxyyhgihz')) throw new Error('BLOQUEADO: TARGET_DATABASE_URL aponta para o projeto de produção do 791 Glass.');
}

/**
 * Converte um valor no formato COPY (TSV) do pg_dump para literal SQL.
 * \N = NULL, \t = tab, \n = newline, \\ = backslash
 */
function copyValorParaSql(v) {
  if (v === '\\N' || v === undefined) return 'NULL';
  // O pg_dump escapa caracteres especiais com barra invertida:
  // \\ -> \, \b -> backspace, \f -> formfeed, \n -> newline, \r -> carriage return, \t -> tab, \v -> vertical tab
  // Em campos JSON/JSONB, as aspas são salvas como \" ou as barras como \\
  let desesc = '';
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '\\' && i + 1 < v.length) {
      const prox = v[i + 1];
      if (prox === 'n') { desesc += '\n'; i++; }
      else if (prox === 'r') { desesc += '\r'; i++; }
      else if (prox === 't') { desesc += '\t'; i++; }
      else if (prox === 'b') { desesc += '\b'; i++; }
      else if (prox === 'f') { desesc += '\f'; i++; }
      else if (prox === 'v') { desesc += '\v'; i++; }
      else if (prox === '\\') { desesc += '\\'; i++; }
      else { desesc += prox; i++; }
    } else {
      desesc += v[i];
    }
  }
  // Re-escapar para literal SQL Postgres padrão (aspas simples duplicadas)
  return "'" + desesc.replace(/'/g, "''") + "'";
}

/**
 * Converte linhas de um bloco COPY (TSV) em statements INSERT INTO.
 * Agrupa em lotes de 50 linhas para melhor performance.
 */
function copyParaInserts(header, linhas) {
  const match = header.match(/^COPY\s+(.+?)\s*\((.+?)\)\s+FROM\s+stdin/i);
  if (!match) return [];

  const tabela = match[1].trim();
  const colunas = match[2].split(',').map(c => c.trim()).join(', ');

  const LOTE = 50;
  const inserts = [];
  for (let i = 0; i < linhas.length; i += LOTE) {
    const grupo = linhas.slice(i, i + LOTE).filter(l => l.trim());
    if (!grupo.length) continue;
    const valores = grupo.map(linha => {
      const vals = linha.split('\t').map(copyValorParaSql);
      return `(${vals.join(', ')})`;
    });
    inserts.push(`INSERT INTO ${tabela} (${colunas}) VALUES\n${valores.join(',\n')};`);
  }
  return inserts;
}

/**
 * Parseia o SQL do pg_dump e retorna lista de statements prontos para execução.
 * Trata blocos COPY FROM stdin convertendo para INSERTs.
 * Filtra meta-comandos psql (\connect, \set, etc.) mas NÃO remove \.
 */
function parsearStatements(sql) {
  const linhas = sql.split('\n');
  const statements = [];

  let bloco = [];           // Acumulador de statement DDL/DML normal
  let emDollar = false;     // Dentro de bloco $$ (função/procedure)
  let emCopy = false;       // Dentro de bloco COPY FROM stdin
  let copyHeader = '';
  let copyLinhas = [];

  for (const linha of linhas) {
    const trimmed = linha.trim();

    // ── Modo COPY ──────────────────────────────────────────────────────────
    if (emCopy) {
      if (trimmed === '\\.') {
        // Fim do bloco COPY → converter para INSERTs
        const inserts = copyParaInserts(copyHeader, copyLinhas);
        statements.push(...inserts);
        emCopy = false;
        copyHeader = '';
        copyLinhas = [];
      } else {
        copyLinhas.push(linha);
      }
      continue;
    }

    // ── Meta-comandos psql (exceto \.) ──────────────────────────────────
    if (trimmed.startsWith('\\')) continue;

    // ── Detectar início de COPY FROM stdin ──────────────────────────────
    if (/^COPY\s+.+\s+FROM\s+stdin/i.test(trimmed)) {
      // Finalizar qualquer bloco DDL anterior
      const anterior = bloco.join('\n').trim();
      if (anterior) statements.push(anterior);
      bloco = [];
      emCopy = true;
      copyHeader = trimmed;
      copyLinhas = [];
      continue;
    }

    // ── Modo DDL/DML normal ─────────────────────────────────────────────
    // Detectar blocos $$ (funções, etc.)
    const count$$ = (linha.match(/\$\$/g) || []).length;
    if (count$$ % 2 !== 0) emDollar = !emDollar;

    bloco.push(linha);

    // Finalizar statement quando linha termina com ';' fora de $$
    if (!emDollar && trimmed.endsWith(';')) {
      const stmt = bloco.join('\n').trim();
      if (stmt) statements.push(stmt);
      bloco = [];
    }
  }

  // Resto sem ';' final
  if (bloco.length) {
    const stmt = bloco.join('\n').trim();
    if (stmt) statements.push(stmt);
  }

  return statements;
}

async function restaurar(sql, url) {
  const statements = parsearStatements(sql);

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`Conexão estabelecida. Executando ${statements.length} statements...`);

  // Desabilitar verificação de FK durante a restauração para permitir
  // que tabelas com referências a auth.users sejam restauradas
  try {
    await client.query('SET session_replication_role = replica;');
    console.log('  🔓 FK constraints temporariamente desabilitados para restauração.');
  } catch (e) {
    console.warn(`  ⚠️  Não foi possível desabilitar FK constraints (${e.message}).`);
  }

  const inicio = Date.now();
  let ok = 0;
  let erros = 0;
  try {
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (!stmt.trim()) continue;
      try {
        await client.query(stmt);
        ok++;
      } catch (err) {
        erros++;
        const isVidracaria = /vidracaria/i.test(stmt);
        if (isVidracaria || erros <= 15 || erros % 100 === 0) {
          const preview = stmt.slice(0, 140).replace(/\n/g, ' ');
          console.warn(`  ⚠️  [${i + 1}/${statements.length}] ${err.message.split('\n')[0]} → "${preview}"`);
        }
      }
      if ((i + 1) % 500 === 0) {
        const decorridoSeg = Math.round((Date.now() - inicio) / 1000);
        console.log(`  ... ${i + 1}/${statements.length} (${decorridoSeg}s decorridos | ✅ ${ok} ok, ⚠️ ${erros} ignorados)`);
      }
    }
  } finally {
    await client.query('SET session_replication_role = DEFAULT;').catch(() => {});
    await client.end();
  }

  const tempoTotalMin = ((Date.now() - inicio) / 1000 / 60).toFixed(1);
  console.log(`\nTempo total de restauração: ${tempoTotalMin} minutos.`);
  console.log(`Resumo: ✅ ${ok} statements executados, ⚠️ ${erros} ignorados.`);
}

async function main() {
  const passphrase = process.env.BACKUP_ENCRYPTION_PASSPHRASE;
  const targetUrl = process.env.TARGET_DATABASE_URL;
  const arquivo = process.argv[2];

  if (!passphrase) { console.error('Erro: defina BACKUP_ENCRYPTION_PASSPHRASE.'); process.exit(1); }
  if (!arquivo) { console.error('Uso: node scripts/restaurar-via-node.mjs <arquivo.bkgl>'); process.exit(1); }

  validarDestino(targetUrl);

  console.log(`Lendo e descriptografando ${arquivo}...`);
  const buffer = readFileSync(arquivo);
  const sql = descriptografar(buffer, passphrase);
  console.log(`Descriptografado: ${Math.round(Buffer.byteLength(sql, 'utf8') / 1024)} KB de SQL.`);
  console.log(`Restaurando em: ${targetUrl?.replace(/:[^@]+@/, ':***@')}`);

  await restaurar(sql, targetUrl);
  console.log('✅ Restauração concluída com sucesso no projeto isolado!');
}

main().catch(err => { console.error('Erro:', err.message); process.exit(1); });
