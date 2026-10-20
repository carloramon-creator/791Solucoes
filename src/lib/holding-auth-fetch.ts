"use client";

import { createSupabaseBrowser } from '@/lib/supabase-browser';

const client = createSupabaseBrowser();

/** fetch com o token da sessão da Holding, para rotas protegidas por authenticateHoldingAdmin. */
export async function holdingAuthFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let { data } = await client.auth.getSession();
  if (!data.session?.access_token) {
    ({ data } = await client.auth.refreshSession());
  }
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Entre novamente.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers, cache: 'no-store' });
}
