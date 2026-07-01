export type SupportTicketStatus =
  | 'new'
  | 'in_progress'
  | 'waiting_customer'
  | 'resolved'
  | 'closed';

export type SupportQueue = 'all' | 'new' | 'mine' | 'overdue' | 'done';

export const OPEN_STATUSES: SupportTicketStatus[] = ['new', 'in_progress', 'waiting_customer'];
export const DONE_STATUSES: SupportTicketStatus[] = ['resolved', 'closed'];

export function parseSupportQueue(value: string | null): SupportQueue {
  if (!value) return 'all';
  if (value === 'new' || value === 'mine' || value === 'overdue' || value === 'done' || value === 'all') {
    return value;
  }
  return 'all';
}

export function parseTicketStatus(value: string | null): SupportTicketStatus | null {
  if (!value) return null;
  if (value === 'new' || value === 'in_progress' || value === 'waiting_customer' || value === 'resolved' || value === 'closed') {
    return value;
  }
  return null;
}

export function isOpenStatus(status: string | null | undefined): boolean {
  return OPEN_STATUSES.includes((status || 'new') as SupportTicketStatus);
}
