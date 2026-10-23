// Squad & Staff Data Portal: talking to the portal API (/api/squad-portal/*).
// Every change carries the session's CSRF token; a signed-out answer (401)
// sends the page back to the sign-in screen.
// roles: the club's list for "Position at the club" ([{ name, category }], Squad › Roles).
export const state = { csrf: '', name: '', season: '', roles: [] as { name: string; category: string }[], onSignedOut: (_msg?: string) => {} };

export class ApiError extends Error {
  status: number; data: any;
  constructor(message: string, status: number, data: any) { super(message); this.status = status; this.data = data; }
}

export async function api(path: string, { method = 'GET', body, form, activity = true }: { method?: string; body?: unknown; form?: FormData; activity?: boolean } = {}) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
  if (!activity) headers['X-Portal-Activity'] = '0';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api/squad-portal/${path}`, { method, headers, body: form || (body !== undefined ? JSON.stringify(body) : undefined), credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError('No connection. Your work is kept on this device.', 0, null);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.signedOut) { state.onSignedOut(data.error); throw new ApiError(data.error || 'Please sign in again.', 401, data); }
  if (!res.ok) throw new ApiError(data.error || (res.status >= 500 ? 'The website is busy. Your work is kept on this device; it will be sent again.' : 'Something went wrong.'), res.status, data);
  return data;
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export function esc(s: unknown) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)); }
let toastTimer = 0;
export function toast(msg: string, ms = 5000) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { t.hidden = true; }, ms);
}
export const lagos = (iso?: string | null, opts: Intl.DateTimeFormatOptions = {}) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos', ...opts }) : '';
