import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

const DOCUMENT_BUCKET = 'equipe-documentos';
const AVATAR_BUCKET = 'equipe-avatars';

type RouteContext = {
  params: Promise<{ email: string }>;
};

function normalizeEmail(value: string): string {
  return decodeURIComponent(String(value || '').trim().toLowerCase());
}

function normalizeText(value: unknown): string | null {
  const text = String(value || '').trim();
  return text ? text : null;
}

function normalizeSalary(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  return Math.round(num * 100) / 100;
}

export async function GET(req: Request, context: RouteContext) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem consultar usuarios.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { email } = await context.params;
  const userEmail = normalizeEmail(email);
  if (!userEmail) {
    return NextResponse.json({ error: 'E-mail invalido.' }, { status: 400 });
  }

  try {
    const [{ data: member, error: memberError }, { data: docs, error: docsError }] = await Promise.all([
      supabaseServer
        .from('equipe_791')
        .select('*')
        .eq('email', userEmail)
        .maybeSingle(),
      supabaseServer
        .from('equipe_791_documentos')
        .select('*')
        .eq('user_email', userEmail)
        .order('created_at', { ascending: false }),
    ]);

    if (memberError) {
      return NextResponse.json({ error: memberError.message || 'Falha ao carregar usuario.' }, { status: 500 });
    }

    if (docsError) {
      return NextResponse.json({ error: docsError.message || 'Falha ao carregar documentos.' }, { status: 500 });
    }

    const documents = await Promise.all((docs || []).map(async (doc: any) => {
      const { data: signed } = await supabaseServer.storage
        .from(DOCUMENT_BUCKET)
        .createSignedUrl(doc.file_path, 60 * 60);

      return {
        id: doc.id,
        fileName: doc.file_name,
        contentType: doc.content_type,
        sizeBytes: doc.size_bytes,
        createdAt: doc.created_at,
        uploadedBy: doc.uploaded_by,
        signedUrl: signed?.signedUrl || null,
      };
    }));

    let avatarUrl: string | null = null;
    const fotoPath = member?.foto_path ? String(member.foto_path).trim() : '';

    if (fotoPath) {
      const { data: signedAvatar } = await supabaseServer.storage
        .from(AVATAR_BUCKET)
        .createSignedUrl(fotoPath, 60 * 60);
      avatarUrl = signedAvatar?.signedUrl || null;
    }

    return NextResponse.json({
      member: member || null,
      documents,
      avatarUrl,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao carregar usuario.' }, { status: 500 });
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem editar usuarios.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { email } = await context.params;
  const userEmail = normalizeEmail(email);
  if (!userEmail) {
    return NextResponse.json({ error: 'E-mail invalido.' }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));

    const payload = {
      nome: normalizeText(body?.nome),
      cpf: normalizeText(body?.cpf),
      whatsapp: normalizeText(body?.whatsapp),
      cep: normalizeText(body?.cep),
      endereco_rua: normalizeText(body?.enderecoRua),
      endereco_numero: normalizeText(body?.enderecoNumero),
      endereco_complemento: normalizeText(body?.enderecoComplemento),
      endereco_bairro: normalizeText(body?.enderecoBairro),
      endereco_cidade: normalizeText(body?.enderecoCidade),
      endereco_uf: normalizeText(body?.enderecoUf)?.toUpperCase() || null,
      salario_mensal: normalizeSalary(body?.salarioMensal),
      periodo_trabalho_inicio: normalizeText(body?.periodoTrabalhoInicio),
      periodo_trabalho_fim: normalizeText(body?.periodoTrabalhoFim),
      jornada_inicio: normalizeText(body?.jornadaInicio),
      jornada_fim: normalizeText(body?.jornadaFim),
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error: updateError } = await supabaseServer
      .from('equipe_791')
      .update(payload)
      .eq('email', userEmail)
      .select('*')
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ error: updateError.message || 'Falha ao atualizar usuario.' }, { status: 500 });
    }

    if (updated) {
      return NextResponse.json({ ok: true, member: updated, updatedBy: auth.user.email });
    }

    const { data: inserted, error: insertError } = await supabaseServer
      .from('equipe_791')
      .insert({
        email: userEmail,
        ...payload,
      })
      .select('*')
      .maybeSingle();

    if (insertError) {
      return NextResponse.json({ error: insertError.message || 'Falha ao criar usuario.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, member: inserted, updatedBy: auth.user.email });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao atualizar usuario.' }, { status: 500 });
  }
}
