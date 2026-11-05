import { NextResponse } from 'next/server';
import { inspectWebsitesSession, isSsoValue, ssoHeaders } from '@/lib/holding-websites-sso';
import { websiteProjects } from '@/lib/website-projects';

export async function GET(req: Request) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!isSsoValue(token)) return NextResponse.json({ error: 'Sessão ausente.' }, { status: 401, headers: ssoHeaders });
  try {
    const session = await inspectWebsitesSession(token);
    if (!session) return NextResponse.json({ error: 'Acesso revogado.' }, { status: 401, headers: ssoHeaders });
    const projects = await websiteProjects(session.user.email, session.permissions.manage);
    return NextResponse.json({ projects, manager: session.permissions.manage }, { headers: ssoHeaders });
  } catch {
    console.error('[WEBSITE PROJECTS] Escopo não verificado.');
    return NextResponse.json({ error: 'Não foi possível verificar os projetos contratados.' }, { status: 503, headers: ssoHeaders });
  }
}
