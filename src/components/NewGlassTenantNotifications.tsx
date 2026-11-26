'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, Check, ExternalLink, X } from 'lucide-react';
import Link from 'next/link';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';

type NewTenant = {
  id: string;
  nome: string | null;
  nome_fantasia: string | null;
  slug: string | null;
  email: string | null;
  created_at: string;
};

type NotificationResponse = {
  userEmail: string | null;
  tenants: NewTenant[];
  canOpenSubscriptions: boolean;
};

const cursorKey = (email: string | null) =>
  `holding:glass-new-tenant-cursor:${email?.trim().toLowerCase() || 'unknown'}`;

export default function NewGlassTenantNotifications() {
  const [alerts, setAlerts] = useState<NewTenant[]>([]);
  const [canOpenSubscriptions, setCanOpenSubscriptions] = useState(false);
  const checking = useRef(false);
  const stopped = useRef(false);

  const sync = useCallback(async () => {
    if (checking.current || stopped.current) return;
    checking.current = true;
    try {
      const permissionResponse = await holdingAuthFetch('/api/admin/tenant-created-notifications');
      if (permissionResponse.status === 403) {
        stopped.current = true;
        return;
      }
      const permissionPayload = await permissionResponse.json() as NotificationResponse & { error?: string };
      if (!permissionResponse.ok) throw new Error(permissionPayload.error || 'Não foi possível verificar novos tenants.');

      const key = cursorKey(permissionPayload.userEmail);
      let storedCursor: string | null = null;
      try {
        storedCursor = window.localStorage.getItem(key);
      } catch (error) {
        console.warn('[TENANT NOTIFICATIONS] Cursor local indisponível.', error instanceof Error ? error.name : 'unknown');
      }

      if (!storedCursor) {
        const latest = permissionPayload.tenants[0]?.created_at;
        if (latest) {
          try { window.localStorage.setItem(key, latest); }
          catch (error) { console.warn('[TENANT NOTIFICATIONS] Não foi possível persistir o cursor.', error instanceof Error ? error.name : 'unknown'); }
        }
        setCanOpenSubscriptions(permissionPayload.canOpenSubscriptions);
        return;
      }

      const response = await holdingAuthFetch(`/api/admin/tenant-created-notifications?since=${encodeURIComponent(storedCursor)}`);
      const payload = await response.json() as NotificationResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Não foi possível verificar novos tenants.');
      setCanOpenSubscriptions(payload.canOpenSubscriptions);

      const incoming = (payload.tenants || []).sort(
        (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
      );
      if (incoming.length > 0) {
        setAlerts((current) => {
          const known = new Set(current.map((tenant) => tenant.id));
          return [...incoming.filter((tenant) => !known.has(tenant.id)), ...current];
        });
        try {
          window.localStorage.setItem(key, incoming[0].created_at);
        } catch (error) {
          console.warn('[TENANT NOTIFICATIONS] Não foi possível atualizar o cursor.', error instanceof Error ? error.name : 'unknown');
        }

        if ('Notification' in window && Notification.permission === 'granted') {
          const newest = incoming[0];
          try {
            new Notification(incoming.length === 1 ? 'Novo tenant Glass criado' : `${incoming.length} novos tenants Glass`, {
              body: incoming.length === 1
                ? newest.nome_fantasia || newest.nome || newest.slug || newest.email || 'Novo cadastro no 791 Glass'
                : incoming.map((tenant) => tenant.nome_fantasia || tenant.nome || tenant.slug).filter(Boolean).slice(0, 3).join(', '),
            });
          } catch (error) {
            console.warn('[TENANT NOTIFICATIONS] Notificação do navegador indisponível.', error instanceof Error ? error.name : 'unknown');
          }
        }
      }
    } catch (error) {
      console.error('[TENANT NOTIFICATIONS] Falha na sincronização.', error instanceof Error ? error.name : 'unknown');
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    const initialSync = window.setTimeout(() => { void sync(); }, 0);
    const interval = window.setInterval(() => { void sync(); }, 30_000);
    const onFocus = () => { void sync(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(initialSync);
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [sync]);

  if (alerts.length === 0) return null;

  const newest = alerts[0];
  const tenantName = (tenant: NewTenant) =>
    tenant.nome_fantasia || tenant.nome || tenant.slug || tenant.email || 'Novo tenant';

  return (
    <aside
      role="alertdialog"
      aria-live="assertive"
      aria-label="Novo tenant criado no Glass"
      className="fixed right-5 top-20 z-[210] w-[min(390px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-2xl"
    >
      <div className="flex items-start gap-3 bg-blue-50 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
          <BellRing size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">791 Glass</p>
          <h2 className="mt-1 text-sm font-black text-slate-900">
            {alerts.length === 1 ? 'Novo tenant cadastrado' : `${alerts.length} novos tenants cadastrados`}
          </h2>
        </div>
        <button type="button" onClick={() => setAlerts([])} aria-label="Dispensar aviso" className="text-slate-400 hover:text-slate-700">
          <X size={17} />
        </button>
      </div>
      <div className="p-4">
        <p className="truncate text-sm font-bold text-slate-800">{tenantName(newest)}</p>
        <p className="mt-1 text-xs text-slate-500">
          {new Date(newest.created_at).toLocaleString('pt-BR')}
        </p>
        {alerts.length > 1 && (
          <p className="mt-3 text-xs text-slate-600">
            Também: {alerts.slice(1, 4).map(tenantName).join(', ')}
            {alerts.length > 4 ? '...' : ''}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          {canOpenSubscriptions && (
            <Link href="/assinaturas" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 text-xs font-bold text-blue-700 hover:bg-blue-50">
              <ExternalLink size={14} /> Ver assinaturas
            </Link>
          )}
          <button type="button" onClick={() => setAlerts([])} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700">
            <Check size={14} /> Entendi
          </button>
        </div>
      </div>
    </aside>
  );
}
