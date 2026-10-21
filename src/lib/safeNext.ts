// Where to go after signing in. Only a page of this admin (a path starting
// "/admin"), never another website: "//evil.com", "/\evil.com", "https://...",
// "javascript:..." and anything with control characters fall back to the
// dashboard, so a link can't send staff somewhere else after they log in.
export const DEFAULT_NEXT = '/admin/dashboard/';

export function safeNext(next: unknown, origin = 'https://lobistarsfc.com'): string {
  const s = String(next ?? '');
  if (!s || s.length > 2000) return DEFAULT_NEXT;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(s)) return DEFAULT_NEXT;
  if (!/^\/admin(\/|$|\?|#)/.test(s) || s.startsWith('//')) return DEFAULT_NEXT;
  let u: URL;
  try { u = new URL(s, origin); } catch { return DEFAULT_NEXT; }
  if (u.origin !== new URL(origin).origin) return DEFAULT_NEXT;
  if (!/^\/admin(\/|$)/.test(u.pathname) || /^\/admin\/login(\/|$)/.test(u.pathname)) return DEFAULT_NEXT;
  return u.pathname + u.search + u.hash;
}
