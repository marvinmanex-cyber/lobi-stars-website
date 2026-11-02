// Media Centre: shared helpers for every screen (API calls with the CSRF
// token, navigation between screens, toasts, formatting).
export const state: { user: any; csrf: string; idleMs: number } = { user: null, csrf: '', idleMs: 30 * 60e3 };
export const $ = (id: string) => document.getElementById(id) as any;
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
export const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '';
export const day = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }) : '';
export const STATUS_LABEL: Record<string, string> = { draft: 'Draft', submitted: 'Waiting for approval', returned: 'Returned to you', scheduled: 'Scheduled', published: 'Published', unpublished: 'Unpublished', rejected: 'Rejected' };
export function statusPill(i: any) {
  if (i.correction) return `<span class="mc-pill ${i.correction}">${i.correction === 'submitted' ? 'Correction waiting' : i.correction === 'returned' ? 'Correction returned' : 'Correction not sent'}</span> <span class="mc-pill ${i.status}">${STATUS_LABEL[i.status] || i.status}</span>`;
  return `<span class="mc-pill ${i.status}">${STATUS_LABEL[i.status] || i.status}</span>`;
}

// The screen that edits each kind of content.
export const KIND_PATH: Record<string, string> = { news: 'news', newsletter: 'newsletter', press: 'press', album: 'library', lineup: 'matchday' };
export const itemPath = (i: any) => `${KIND_PATH[i.kind] || i.kind}/${i.id}`;

export class ApiError extends Error { status: number; data: any; constructor(m: string, status: number, data: any) { super(m); this.status = status; this.data = data; } }
let onSignedOut: (why?: string) => void = () => {};
export function setSignedOutHandler(f: (why?: string) => void) { onSignedOut = f; }
/** Calls /api/media-centre/<path>. Body objects are sent as JSON; FormData as is. quiet: doesn't count as activity. */
export async function api(path: string, { method = 'GET', body, quiet = false }: { method?: string; body?: any; quiet?: boolean } = {}) {
  const headers: Record<string, string> = { 'X-CSRF-Token': state.csrf };
  if (quiet) headers['X-Activity'] = '0';
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const r = await fetch(`/api/media-centre/${path}`, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'same-origin' });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && d.signedOut) { onSignedOut('Your session ended. Please sign in again.'); throw new ApiError(d.error || 'Signed out', 401, d); }
  if (r.status === 403 && d.mustChange) { onSignedOut('password'); throw new ApiError(d.error, 403, d); }
  if (!r.ok) throw new ApiError(d.error || 'Something went wrong. Please try again.', r.status, d);
  return d;
}

let toastT = 0;
export function toast(t: string, ms = 6000) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = window.setTimeout(() => { el.hidden = true; }, ms); }

// ── Screens ──
export type Screen = { path: string; label: string; icon: string; render: (main: HTMLElement, parts: string[]) => void | Promise<void>; nav?: boolean };
export const SCREENS: Screen[] = [];
export function register(s: Screen) { SCREENS.push(s); }
let routeHandler: () => void = () => {};
export function setRouteHandler(f: () => void) { routeHandler = f; }
/** Opens a screen: go('/news/abc'). */
// New version check: the page carries its build stamp; when the website has a newer
// one, the next screen change loads the new version (or a banner asks, with unsaved work).
const BUILD = document.querySelector<HTMLMetaElement>('meta[name="mc-build"]')?.content || '';
let newer = false, lastCheck = 0;
async function checkVersion() {
  if (!BUILD || newer || Date.now() - lastCheck < 60e3) return;
  lastCheck = Date.now();
  try {
    const html = await fetch('/media-centre/', { cache: 'no-store', credentials: 'same-origin' }).then(r => r.text());
    const live = html.match(/name="mc-build" content="(\d+)"/)?.[1];
    if (live && live !== BUILD) { newer = true; const b = document.getElementById('mcUpdate'); if (b) b.hidden = false; }
  } catch { /* offline */ }
}
setInterval(checkVersion, 5 * 60e3);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });
export function go(path: string, replace = false) {
  const url = `/media-centre${path === '/' ? '/' : path.replace(/\/?$/, '/')}`;
  if (newer && !guard.dirty()) { location.href = url; return; }
  checkVersion();
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  routeHandler();
}
/** Leaving a screen with unsaved work asks first (screens set this). */
export const guard: { dirty: () => boolean } = { dirty: () => false };
