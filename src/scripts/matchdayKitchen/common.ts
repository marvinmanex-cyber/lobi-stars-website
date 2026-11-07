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

export const session: { csrf: string; user: any; perms: any; settings: any; shift: any; pushKey: string; waDevice: boolean } = { csrf: '', user: null, perms: {}, settings: {}, shift: null, pushKey: '', waDevice: false };

export class ApiError extends Error { status: number; data: any; constructor(m: string, status: number, data: any) { super(m); this.status = status; this.data = data; } }
let onSignedOut = () => {};
export const setSignedOutHandler = (f: () => void) => { onSignedOut = f; };
/** Calls /api/matchday-kitchen/<path>. quiet: an automatic refresh (doesn't count as activity). */
// A weak connection can lose the answer after the server has acted. These taps carry a key and are
// tried again by themselves: the server repeats its first answer rather than acting twice.
const RETRY = new Set(['order', 'claim', 'payment', 'refund']);
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const wait = (ms: number) => new Promise(ok => setTimeout(ok, ms));
export async function api(path: string, { method = 'GET', body, quiet = false }: { method?: string; body?: any; quiet?: boolean } = {}) {
  const headers: Record<string, string> = { 'X-CSRF-Token': session.csrf };
  if (quiet) headers['X-Activity'] = '0';
  if (body) headers['Content-Type'] = 'application/json';
  const safe = method === 'POST' && RETRY.has(path);
  if (safe) headers['X-Idempotency-Key'] = newKey();
  let r: Response | null = null;
  for (let attempt = 0; !r; attempt++) {
    try { r = await fetch(`/api/matchday-kitchen/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'same-origin' }); }
    catch {
      if (!safe || attempt >= 2) throw new ApiError('No connection. Check the Wi-Fi and try again.', 0, {});
      await wait(1500 * (attempt + 1));
    }
  }
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

// WhatsApp can't be shown inside another website (it refuses to be framed), so the
// kitchen's chats open in WhatsApp Web in another tab of the same browser (always
// the same tab); on phones, the WhatsApp app.
export const WHATSAPP_NUMBER = '+234 708 009 4985';
export const whatsappUrl = () => (/Android|iPhone|iPod/i.test(navigator.userAgent) && !/iPad|Tablet/i.test(navigator.userAgent) ? 'https://wa.me/' : 'https://web.whatsapp.com/');

// Icons for the buttons (24 x 24). Brand logos (WhatsApp, Telegram) are filled; the rest are outlines.
const line = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const WA_PATH = 'M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35m-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.16-3.48-8.41Z';
export const TG_PATH = 'M11.94 0A12 12 0 1 0 12 24 12 12 0 0 0 11.94 0Zm4.97 7.22c.1 0 .32.02.46.14.12.1.16.23.17.33.02.09.04.3.02.47-.18 1.9-.96 6.5-1.36 8.63-.17.9-.5 1.2-.82 1.23-.7.06-1.22-.46-1.9-.9-1.05-.7-1.65-1.13-2.68-1.8-1.18-.78-.41-1.21.26-1.91.18-.18 3.25-2.98 3.31-3.23 0-.03.01-.15-.06-.21-.07-.06-.17-.04-.25-.02-.1.02-1.79 1.14-5.06 3.35-.48.33-.91.49-1.3.48-.43-.01-1.25-.24-1.87-.44-.75-.25-1.35-.37-1.3-.79.03-.22.33-.44.9-.66 3.5-1.52 5.83-2.53 7-3.01 3.33-1.39 4.02-1.63 4.48-1.64Z';
export const ICONS: Record<string, string> = {
  kitchen: line('<path d="M6 13.9V21h12v-7.1"/><path d="M6 17h12"/><path d="M12 3a4 4 0 0 0-3.8 2.8A3.5 3.5 0 1 0 6 13.9h12a3.5 3.5 0 1 0-2.2-8.1A4 4 0 0 0 12 3Z"/>'),
  live: line('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/><path d="M5.5 8h1.5M11 8h2M17 8h1.5M5.5 12h1.5M11 12h2"/>'),
  alerts: line('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M12 7v3"/>'),
  orders: line('<path d="M5 3h14v18l-2.33-1.5L14.33 21 12 19.5 9.67 21 7.33 19.5 5 21Z"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  menu: line('<path d="M3 11h18a9 9 0 0 1-18 0Z"/><path d="M12 3c-1 1 1 2 0 3M8 4c-1 1 1 2 0 3M16 4c-1 1 1 2 0 3"/><path d="M5 20h14"/>'),
  whatsapp: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${WA_PATH}"/></svg>`,
  telegram: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${TG_PATH}"/></svg>`,
  handover: line('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h6M9 18h3"/>'),
  shift: line('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  analytics: line('<path d="M3 21h18"/><rect x="5" y="11" width="3" height="7"/><rect x="10.5" y="6" width="3" height="12"/><rect x="16" y="9" width="3" height="9"/>'),
  activity: line('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
  staff: line('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16.5 14.2A5 5 0 0 1 22 19"/>'),
};
export const iconFor = (page: string) => ICONS[page.startsWith('orders/') || page === 'refunds' ? 'orders' : page === 'reports' || page === 'sales' ? 'analytics' : page] || '';

export type Tile = { id: string; title: string; text: string; style?: 'hero' | 'red' | 'amber' | 'gold' | 'wa' | 'tg'; external?: 'whatsapp' | 'telegram'; superOnly?: boolean };
export type Group = { title: string; tiles: Tile[]; superOnly?: boolean };
/** The home screen buttons, in order and grouped (the brief's tiles). */
export const GROUPS: Group[] = [
  { title: 'Live service', tiles: [
    { id: 'kitchen', title: 'Kitchen screen', text: 'Tickets to cook, oldest first', style: 'hero' },
    { id: 'live', title: 'Live order board', text: 'Every order and its status, live' },
    { id: 'delivery', title: 'Delivery by stand', text: 'Orders on the way, grouped by stand, in seat order' },
    { id: 'alerts', title: 'Kitchen alerts', text: 'Late orders, cancellations, dishes turned off', style: 'red' },
  ] },
  { title: 'Orders and menu', tiles: [
    { id: 'orders', title: 'Food orders', text: 'Find, check and update any order' },
    { id: 'menu', title: 'Menu and prices', text: 'Turn dishes on and off, prices, add and delete dishes' },
    { id: 'refunds', title: 'Refunds', text: 'Paid orders that were rejected or cancelled', superOnly: true },
    { id: 'sales', title: 'Sales reports', text: 'Saved after each match day. Combine them, download in Word or PDF', superOnly: true },
    { id: 'reports', title: 'Reports', text: 'Match-day figures, staff performance, ratings, CSV', superOnly: true },
  ] },
  { title: 'Team and messages', tiles: [
    { id: 'whatsapp', title: 'Kitchen WhatsApp', text: 'Open the kitchen chats (+234 708 009 4985)', external: 'whatsapp', style: 'wa' },
    { id: 'telegram', title: 'Telegram updates', text: 'Automated kitchen messages', external: 'telegram', style: 'tg' },
    { id: 'handover', title: 'Handover notes', text: 'Leave notes for the next shift' },
  ] },
  { title: 'Shift and records', tiles: [
    { id: 'shift', title: 'My shift', text: 'Start or end your shift', style: 'amber' },
    { id: 'analytics', title: 'Food analytics', text: 'Orders, sales and top dishes' },
    { id: 'activity', title: 'Activity log', text: 'What was done, by whom and when' },
  ] },
  { title: 'Manage the kitchen', superOnly: true, tiles: [
    { id: 'staff', title: 'Staff accounts', text: 'Add staff, give login codes, switch off access, settings' },
  ] },
];
/** Page names (tabs, page titles). */
export const PAGE_TITLE: Record<string, string> = {
  refunds: 'Refunds', reports: 'Reports', sales: 'Sales reports', kitchen: 'Kitchen screen', live: 'Live order board', delivery: 'Delivery by stand', alerts: 'Kitchen alerts', orders: 'Food orders', menu: 'Menu and prices', analytics: 'Food analytics',
  shift: 'My shift', handover: 'Handover notes', activity: 'Activity log', staff: 'Staff accounts', 'not-available': 'Not available',
};
export const pageTitle = (page: string) => page.startsWith('orders/') ? `Order ${decodeURIComponent(page.slice(7))}` : PAGE_TITLE[page] || 'MatchDay Kitchen';
