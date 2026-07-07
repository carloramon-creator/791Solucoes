import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import {
  CREDIT_AI_PROMPT_KEY,
  getAiPromptConfig,
  getAiPromptDefaultConfig,
  listAiPromptConfigs,
  saveAiPromptConfig,
} from '@/lib/ai-prompts';

function normalizeKey(value: string | null) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return CREDIT_AI_PROMPT_KEY;
  if (!/^[a-z0-9_]+$/.test(key)) return null;
  return key;
}

function normalizeUsoEm(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => /^[a-z0-9._-]+$/.test(item))
    )
  );
}

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Acesso negado para patrocinador.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  const key = normalizeKey(url.searchParams.get('chave'));
  if (!key) {
    return NextResponse.json({ error: 'A chave do prompt é inválida. Use apenas letras minúsculas, números e underscore.' }, { status: 400 });
  }

  const prompt = await getAiPromptConfig(key);
  const list = await listAiPromptConfigs();
  return NextResponse.json({
    config: prompt,
    defaults: getAiPromptDefaultConfig(key),
    list,
  });
}

export async function PUT(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Acesso negado para patrocinador.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  const key = normalizeKey(body?.chave);
  if (!key) {
    return NextResponse.json({ error: 'A chave do prompt é inválida. Use apenas letras minúsculas, números e underscore.' }, { status: 400 });
  }

  const titulo = String(body?.titulo || '').trim();
  const descricaoRaw = body?.descricao;
  const descricao = descricaoRaw === null ? null : String(descricaoRaw || '').trim() || null;
  const usoEm = normalizeUsoEm(body?.uso_em);
  const systemPrompt = String(body?.system_prompt || '').trim();
  const userPromptTemplate = String(body?.user_prompt_template || '').trim();
  const ativo = Boolean(body?.ativo);

  if (!systemPrompt) {
    return NextResponse.json({ error: 'O prompt de sistema nao pode ficar vazio.' }, { status: 400 });
  }

  const defaults = getAiPromptDefaultConfig(key);

  const saved = await saveAiPromptConfig(key, {
    titulo: titulo || defaults.titulo,
    descricao,
    uso_em: usoEm.length > 0 ? usoEm : defaults.uso_em,
    system_prompt: systemPrompt,
    user_prompt_template: userPromptTemplate || defaults.user_prompt_template,
    ativo,
  }, auth.user.email);

  const list = await listAiPromptConfigs();

  return NextResponse.json({ config: saved, defaults, list });
}