import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { userCanAccessResource } from '@/lib/holding-permissions';

/** Remove uma regra aprendida (não altera lançamentos já classificados). */
export async function DELETE(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Acesso negado.');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  if (!(await userCanAccessResource(auth.user.email, 'menu.financeiro'))) {
    return NextResponse.json({ success: false, error: 'Sem permissão no financeiro.' }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: 'Informe a regra.' }, { status: 400 });
  const { error } = await supabaseServer.from('system_bank_classification_rules').delete().eq('id', id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
