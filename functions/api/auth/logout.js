import { clearSessionCookie, fanHintCookie } from '../_lib/session.js';

export async function onRequestPost() {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', clearSessionCookie());
  headers.append('Set-Cookie', fanHintCookie(false));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
