import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

const AVATAR_BUCKET = 'equipe-avatars';
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

type RouteContext = {
  params: Promise<{ email: string }>;
};

function normalizeEmail(value: string): string {
  return decodeURIComponent(String(value || '').trim().toLowerCase());
}

function extForMime(type: string): string {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

export async function POST(req: Request, context: RouteContext) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem alterar foto de usuario.');
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
      return NextResponse.json({ error: 'Arquivo de foto invalido.' }, { status: 400 });
    }

    const file = maybeFile;

    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: 'Formato invalido. Use PNG, JPG ou WEBP.' }, { status: 400 });
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: 'Foto excede 5MB.' }, { status: 400 });
    }

    const extension = extForMime(file.type);
    const timestamp = Date.now();
    const filePath = `users/${userEmail}/avatar-${timestamp}.${extension}`;
    const fileBuffer = await file.arrayBuffer();

    const { data: current } = await supabaseServer
      .from('equipe_791')
      .select('foto_path')
      .eq('email', userEmail)
      .maybeSingle();

    const previousPath = current?.foto_path ? String(current.foto_path).trim() : '';

    const { error: uploadError } = await supabaseServer.storage
      .from(AVATAR_BUCKET)
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message || 'Falha no upload da foto.' }, { status: 500 });
    }

    const { error: updateError } = await supabaseServer
      .from('equipe_791')
      .update({
        foto_path: filePath,
        updated_at: new Date().toISOString(),
      })
      .eq('email', userEmail);

    if (updateError) {
      return NextResponse.json({ error: updateError.message || 'Falha ao salvar foto do usuario.' }, { status: 500 });
    }

    if (previousPath && previousPath !== filePath) {
      await supabaseServer.storage.from(AVATAR_BUCKET).remove([previousPath]);
    }

    const { data: signedAvatar } = await supabaseServer.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(filePath, 60 * 60);

    return NextResponse.json({
      ok: true,
      fotoPath: filePath,
      avatarUrl: signedAvatar?.signedUrl || null,
      updatedBy: auth.user.email,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao enviar foto.' }, { status: 500 });
  }
}
