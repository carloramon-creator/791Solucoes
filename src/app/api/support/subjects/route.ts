import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

function normalizeEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((email) => String(email || '').trim().toLowerCase())
      .filter(Boolean)
  ));
}

function normalizeProfileIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((profileId) => String(profileId || '').trim())
      .filter(Boolean)
  ));
}

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem consultar assuntos de suporte.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const [
      { data: subjects, error: subjectsError },
      { data: assignments, error: assignmentsError },
      { data: subjectProfiles, error: subjectProfilesError },
    ] = await Promise.all([
      supabaseServer
        .from('support_subjects')
        .select('id, name, description, active, created_at, updated_at')
        .order('name', { ascending: true }),
      supabaseServer
        .from('support_subject_assignments')
        .select('subject_id, assignee_email'),
      supabaseServer
        .from('support_subject_permission_profiles')
        .select('subject_id, profile_id'),
    ]);

    if (subjectsError || assignmentsError || subjectProfilesError) {
      return NextResponse.json({
        error: subjectsError?.message || assignmentsError?.message || subjectProfilesError?.message || 'Falha ao carregar assuntos.',
      }, { status: 500 });
    }

    const bySubject = new Map<string, string[]>();
    for (const row of assignments || []) {
      const subjectId = String(row.subject_id || '');
      const email = String(row.assignee_email || '').trim().toLowerCase();
      if (!subjectId || !email) continue;
      if (!bySubject.has(subjectId)) bySubject.set(subjectId, []);
      bySubject.get(subjectId)?.push(email);
    }

    const profilesBySubject = new Map<string, string[]>();
    for (const row of subjectProfiles || []) {
      const subjectId = String(row.subject_id || '');
      const profileId = String(row.profile_id || '').trim();
      if (!subjectId || !profileId) continue;
      if (!profilesBySubject.has(subjectId)) profilesBySubject.set(subjectId, []);
      profilesBySubject.get(subjectId)?.push(profileId);
    }

    const rows = (subjects || []).map((subject) => ({
      ...subject,
      assigneeEmails: bySubject.get(String(subject.id)) || [],
      profileIds: Array.from(new Set(profilesBySubject.get(String(subject.id)) || [])),
    }));

    return NextResponse.json({
      total: rows.length,
      subjects: rows,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao carregar assuntos.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem criar assuntos de suporte.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await req.json();
    const name = String(body?.name || '').trim();
    const description = body?.description ? String(body.description).trim() : null;
    const active = body?.active == null ? true : Boolean(body.active);
    const assigneeEmails = normalizeEmails(body?.assigneeEmails);
    const profileIds = normalizeProfileIds(body?.profileIds);

    if (!name) {
      return NextResponse.json({ error: 'Informe o nome do assunto.' }, { status: 400 });
    }

    const { data: created, error: createError } = await supabaseServer
      .from('support_subjects')
      .insert({ name, description, active })
      .select('id, name, description, active, created_at, updated_at')
      .single();

    if (createError || !created) {
      return NextResponse.json({ error: createError?.message || 'Falha ao criar assunto.' }, { status: 500 });
    }

    if (assigneeEmails.length > 0) {
      const payload = assigneeEmails.map((email) => ({
        subject_id: created.id,
        assignee_email: email,
      }));

      const { error: assignmentsError } = await supabaseServer
        .from('support_subject_assignments')
        .insert(payload);

      if (assignmentsError) {
        return NextResponse.json({ error: assignmentsError.message || 'Assunto criado, mas falhou ao salvar responsaveis.' }, { status: 500 });
      }
    }

    if (profileIds.length > 0) {
      const payload = profileIds.map((profileId) => ({
        subject_id: created.id,
        profile_id: profileId,
      }));

      const { error: profilesError } = await supabaseServer
        .from('support_subject_permission_profiles')
        .insert(payload);

      if (profilesError) {
        return NextResponse.json({ error: profilesError.message || 'Assunto criado, mas falhou ao salvar perfis vinculados.' }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true,
      subject: {
        ...created,
        assigneeEmails,
        profileIds,
      },
      createdBy: auth.user.email,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao criar assunto.' }, { status: 500 });
  }
}
