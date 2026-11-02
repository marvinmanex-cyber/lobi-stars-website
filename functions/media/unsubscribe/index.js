import { unsubscribe } from '../../api/_lib/pressList.js';

// /media/unsubscribe/?e=&t= -- the signed "Unsubscribe from the press list" link (no login).
// Opening the link removes the person straight away (a page script confirms it, so
// email link scanners that only fetch the page do not unsubscribe people); email
// apps' one-click unsubscribe (POST) works too.
const page = (title, text, auto = '') => new Response(`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title} | Lobi Stars FC</title>
<style>body{margin:0;font:17px/1.6 Arial,Helvetica,sans-serif;background:#EEF1F6;color:#15181D}header{background:#0E2A55;color:#fff;padding:14px 18px;display:flex;gap:10px;align-items:center;font-weight:bold;border-bottom:6px solid #F5C11A}header img{width:40px;height:40px}main{max-width:560px;margin:40px auto;padding:0 16px}.card{background:#fff;border-radius:14px;padding:26px 22px;box-shadow:0 8px 24px rgba(14,42,85,.1)}h1{margin:0 0 10px;font-size:24px;color:#0E2A55}button{min-height:48px;padding:0 20px;border:0;border-radius:8px;background:#D62839;color:#fff;font-weight:bold;font-size:16px;cursor:pointer}a{color:#0E2A55}</style></head>
<body><header><img src="/images/lobi-stars-fc-transparent-256.png" alt="">LOBI STARS FC · Media Department</header><main><div class="card">${text}</div></main>${auto}</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
const done = () => page('Unsubscribed', '<h1>You have been removed from the Lobi Stars FC press list.</h1><p>You will not receive club statements or matchday accreditation links any more. If you apply for accreditation, we will still email you about that application.</p><p><a href="/media/">The Press Room</a></p>');
const bad = () => page('Link not valid', '<h1>This unsubscribe link is not valid.</h1><p>Please use the link in the latest email from us, or write to <a href="mailto:media@lobistarsfc.com">media@lobistarsfc.com</a>.</p>');

export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  if (!u.searchParams.get('e') || !u.searchParams.get('t')) return bad();
  return page('Unsubscribe', '<h1>Unsubscribing you…</h1><form method="post" id="f"><noscript><p>Press the button to leave the Lobi Stars FC press list.</p></noscript><button type="submit">Unsubscribe from the press list</button></form>',
    '<script>document.getElementById("f").submit()</script>');
}
export async function onRequestPost({ request, env }) {
  const u = new URL(request.url);
  const r = await unsubscribe(env, u.searchParams.get('e'), u.searchParams.get('t'));
  return r.ok ? done() : bad();
}
