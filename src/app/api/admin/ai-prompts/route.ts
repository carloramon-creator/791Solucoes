import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getCreditAiPromptConfig, getCreditAiPromptDefaultConfig, saveCreditAiPromptConfig } from '@/lib/ai-prompts';

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Acesso negado para patrocinador.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const prompt = await getCreditAiPromptConfig();
  return NextResponse.json({
    config: prompt,
    defaults: getCreditAiPromptDefaultConfig(),
  });
}

export async function PUT(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Acesso negado para patrocinador.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  const titulo = String(body?.titulo || '').trim();
  const descricaoRaw = body?.descricao;
  const descricao = descricaoRaw === null ? null : String(descricaoRaw || '').trim() || null;
  const systemPrompt = String(body?.system_prompt || '').trim();
  const userPromptTemplate = String(body?.user_prompt_template || '').trim();
  const ativo = Boolean(body?.ativo);

  if (!systemPrompt) {
    return NextResponse.json({ error: 'O prompt de sistema nao pode ficar vazio.' }, { status: 400 });
  }

  const saved = await saveCreditAiPromptConfig({
    titulo: titulo || getCreditAiPromptDefaultConfig().titulo,
    descricao,
    system_prompt: systemPrompt,
    user_prompt_template: userPromptTemplate || getCreditAiPromptDefaultConfig().user_prompt_template,
    ativo,
  }, auth.user.email);

  return NextResponse.json({ config: saved, defaults: getCreditAiPromptDefaultConfig() });
}