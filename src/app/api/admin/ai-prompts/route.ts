import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { supabaseServer } from '@/lib/supabase-server';
import { getCreditAiPromptConfig, getCreditAiPromptDefaultConfig, saveCreditAiPromptConfig } from '@/lib/ai-prompts';

function canManagePrompt(profile: { is_master?: boolean; perfil_id?: string } | null | undefined) {
  const perfilId = String(profile?.perfil_id || '').trim().toLowerCase();
  return Boolean(profile?.is_master || perfilId === 'admin');
}

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

  const { data: profile, error: profileError } = await supabaseServer
    .from('user_profiles')
    .select('perfil_id, is_master')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message || 'Falha ao verificar permissao.' }, { status: 500 });
  }

  if (!canManagePrompt(profile)) {
    return NextResponse.json({ error: 'Sem permissao para editar prompts de IA.' }, { status: 403 });
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