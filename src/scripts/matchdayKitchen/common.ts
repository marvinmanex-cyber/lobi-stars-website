// MatchDay Kitchen: shared helpers (API calls with the session token,
// formatting) and the home screen buttons (their order and groups).
export const $ = (id: string) => document.getElementById(id) as any;
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const TZ = 'Africa/Lagos';
export const hm = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '';
export const dayTime = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '';
export const dayOnly = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }) : '';
export const todayLagos = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
export const mins = (n: number) => n < 1 ? 'just now' : `${n} min`;

export const session: { csrf: string; user: any; perms: any; settings: any; shift: any } = { csrf: '', user: null, perms: {}, settings: {}, shift: null };

export class ApiError extends Error { status: number; data: any; constructor(m: string, status: number, data: any) { super(m); this.status = status; this.data = data; } }
let onSignedOut = () => {};
export const setSignedOutHandler = (f: () => void) => { onSignedOut = f; };
/** Calls /api/matchday-kitchen/<path>. quiet: an automatic refresh (doesn't count as activity). */
export async function api(path: string, { method = 'GET', body, quiet = false }: { method?: string; body?: any; quiet?: boolean } = {}) {
  const headers: Record<string, string> = { 'X-CSRF-Token': session.csrf };
  if (quiet) headers['X-Activity'] = '0';
  if (body) headers['Content-Type'] = 'application/json';
  let r: Response;
  try { r = await fetch(`/api/matchday-kitchen/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'same-origin' }); }
  catch { throw new ApiError('No connection. Check the Wi-Fi and try again.', 0, {}); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && d.signedOut) { onSignedOut(); throw new ApiError(d.error || 'Signed out', 401, d); }
  if (!r.ok) throw new ApiError(d.error || 'Something went wrong. Please try again.', r.status, d);
  return d;
}
export async function loadSession() {
  const d = await api('session', { quiet: true });
  Object.assign(session, d);
  return d;
}

export const WHATSAPP_URL = 'https://wa.me/2347080094985';

export type Tile = { id: string; title: string; text: string; style?: 'hero' | 'red' | 'amber' | 'gold'; external?: 'whatsapp' | 'telegram'; superOnly?: boolean };
export type Group = { title: string; tiles: Tile[]; superOnly?: boolean };
/** The home screen buttons, in order and grouped (the brief's tiles). */
export const GROUPS: Group[] = [
  { title: 'Live service', tiles: [
    { id: 'kitchen', title: 'Kitchen screen', text: 'Tickets to cook, oldest first', style: 'hero' },
    { id: 'live', title: 'Live order board', text: 'Every order and its status, live' },
    { id: 'alerts', title: 'Kitchen alerts', text: 'Late orders, cancellations, sold out', style: 'red' },
  ] },
  { title: 'Orders and menu', tiles: [
    { id: 'orders', title: 'Food orders', text: 'Find, check and update any order' },
    { id: 'menu', title: 'Menu and prices', text: 'Mark dishes sold out, change prices' },
  ] },
  { title: 'Team and messages', tiles: [
    { id: 'whatsapp', title: 'Kitchen WhatsApp', text: 'Message +234 708 009 4985', external: 'whatsapp', style: 'gold' },
    { id: 'telegram', title: 'Telegram updates', text: 'Automated kitchen messages', external: 'telegram', style: 'gold' },
    { id: 'handover', title: 'Handover notes', text: 'Leave notes for the next shift' },
  ] },
  { title: 'Shift and records', tiles: [
    { id: 'shift', title: 'My shift', text: 'Start or end your shift', style: 'amber' },
    { id: 'analytics', title: 'Food analytics', text: 'Orders, sales and top dishes' },
    { id: 'activity', title: 'Activity log', text: 'What was done, by whom and when' },
  ] },
  { title: 'Super admin', superOnly: true, tiles: [
    { id: 'staff', title: 'Staff accounts', text: 'Add staff, reset passwords, switch off access' },
  ] },
];
/** Page names (tabs, page titles). */
export const PAGE_TITLE: Record<string, string> = {
  kitchen: 'Kitchen screen', live: 'Live order board', alerts: 'Kitchen alerts', orders: 'Food orders', menu: 'Menu and prices', analytics: 'Food analytics',
  shift: 'My shift', handover: 'Handover notes', activity: 'Activity log', staff: 'Staff accounts', 'not-available': 'Not available',
};
export const pageTitle = (page: string) => page.startsWith('orders/') ? `Order ${decodeURIComponent(page.slice(7))}` : PAGE_TITLE[page] || 'MatchDay Kitchen';
