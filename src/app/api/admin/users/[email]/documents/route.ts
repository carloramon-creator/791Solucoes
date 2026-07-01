import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

const DOCUMENT_BUCKET = 'equipe-documentos';

type RouteContext = {
  params: Promise<{ email: string }>;
};

function normalizeEmail(value: string): string {
  return decodeURIComponent(String(value || '').trim().toLowerCase());
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function POST(req: Request, context: RouteContext) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem anexar documentos.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { email } = await context.params;
  const userEmail = normalizeEmail(email);
  if (!userEmail) {
    return NextResponse.json({ error: 'E-mail invalido.' }, { status: 400 });
  }

  try {
    const form = await req.formData();
    const maybeFile = form.get('file');

    if (!(maybeFile instanceof File)) {
      return NextResponse.json({ error: 'Arquivo invalido.' }, { status: 400 });
    }

    const file = maybeFile;
    const safeName = sanitizeFileName(file.name || 'documento');
    const filePath = `users/${userEmail}/${Date.now()}-${safeName}`;
    const arrayBuffer = await file.arrayBuffer();

    const { error: uploadError } = await supabaseServer.storage
      .from(DOCUMENT_BUCKET)
      .upload(filePath, arrayBuffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message || 'Falha no upload do documento.' }, { status: 500 });
    }

    const { data: inserted, error: insertError } = await supabaseServer
      .from('equipe_791_documentos')
      .insert({
        user_email: userEmail,
        file_name: file.name,
        file_path: filePath,
        content_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: auth.user.email,
      })
      .select('*')
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message || 'Falha ao salvar metadados do documento.' }, { status: 500 });
    }

    const { data: signed } = await supabaseServer.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(filePath, 60 * 60);

    return NextResponse.json({
      ok: true,
      document: {
        id: inserted.id,
        fileName: inserted.file_name,
        contentType: inserted.content_type,
        sizeBytes: inserted.size_bytes,
        createdAt: inserted.created_at,
        uploadedBy: inserted.uploaded_by,
        signedUrl: signed?.signedUrl || null,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao enviar documento.' }, { status: 500 });
  }
}
