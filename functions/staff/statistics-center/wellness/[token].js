import { wellnessLinkSlug, submitWellness } from '../../../api/_lib/statsPro.js';

// /staff/statistics-center/wellness/<token>/ -- a player's private check-in page (training load and wellness), opened
// from the link the staff made for them. No sign-in; the link is the key (a new link switches the old one off).
// GET: the form. POST (form): saves one entry per day and session type (sending again updates it). Never indexed.
const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (body, status = 200) => new Response(`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Check-in | Lobi Stars FC</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Barlow+Condensed:wght@700&display=swap" rel="stylesheet">
<style>:root{--navy:#1C3F7A;--red:#C8102E;--ink:#16181D;--muted:#4A505C;--line:#E2E4E9}*{box-sizing:border-box}body{margin:0;background:#F3F4F6;color:var(--ink);font:400 17px/1.5 Barlow,system-ui,sans-serif}
header{background:var(--navy);border-bottom:4px solid var(--red);color:#fff;padding:12px 16px;display:flex;gap:12px;align-items:center}header img{width:44px;height:44px;border-radius:50%;background:#fff;padding:3px}header b{font:700 19px 'Barlow Condensed',sans-serif;letter-spacing:.05em}
main{max-width:560px;margin:0 auto;padding:16px}.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;margin:0 0 16px}h1{font:700 26px 'Barlow Condensed',sans-serif;margin:0 0 6px}label{display:block;font-weight:600;margin:12px 0 4px}
select,input{font:inherit;width:100%;padding:10px;border:1px solid #C9CED8;border-radius:10px;background:#fff}.scale{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.scale label{margin:0;text-align:center;border:1px solid #C9CED8;border-radius:10px;padding:8px 0;font-weight:400;cursor:pointer}
.scale input{display:none}.scale input:checked+span{font-weight:700;color:#fff}.scale label:has(input:checked){background:var(--navy);border-color:var(--navy);color:#fff}.rpe{grid-template-columns:repeat(10,1fr)}.hint{color:var(--muted);font-size:14px;margin:2px 0 0}
button{font:700 18px Barlow,sans-serif;width:100%;margin-top:16px;padding:12px;border:0;border-radius:12px;background:var(--red);color:#fff;cursor:pointer}.ok{border-left:6px solid #2E7D32}.err{border-left:6px solid var(--red)}</style></head>
<body><header><img src="/images/lobi-stars-badge.webp" alt=""><b>Lobi Stars FC · Player check-in</b></header><main>${body}</main></body></html>`, { status, headers: HEADERS });
const scale = (name, n, lo, hi, cls = '') => `<div class="scale ${cls}">${Array.from({ length: n }, (_, i) => `<label><input type="radio" name="${name}" value="${i + 1}"><span>${i + 1}</span></label>`).join('')}</div><p class="hint">${esc(lo)} … ${esc(hi)}</p>`;
const form = (msg = '') => `${msg}<form class="card" method="post"><h1>How was today?</h1><p class="hint">Takes 30 seconds. Only the club's staff see this.</p>
  <label for="d">Date</label><input id="d" type="date" name="date" value="${new Date(Date.now() + 3600e3).toISOString().slice(0, 10)}">
  <label for="s">Session</label><select id="s" name="session"><option value="training">Training</option><option value="match">Match</option><option value="gym">Gym</option><option value="recovery">Recovery</option><option value="other">Other</option></select>
  <label for="m">Minutes</label><input id="m" type="number" name="minutes" min="0" max="300" inputmode="numeric" placeholder="e.g. 90">
  <label>How hard was it? (1–10)</label>${scale('rpe', 10, '1 very easy', '10 maximum effort', 'rpe')}
  <label>Sleep last night</label>${scale('sleep', 5, '1 very poor', '5 very good')}
  <label>Muscle soreness</label>${scale('soreness', 5, '1 very sore', '5 not sore at all')}
  <label>Energy</label>${scale('fatigue', 5, '1 exhausted', '5 full of energy')}
  <label>Stress</label>${scale('stress', 5, '1 very stressed', '5 relaxed')}
  <label>Mood</label>${scale('mood', 5, '1 very low', '5 very good')}
  <label for="n">Anything the staff should know? (optional)</label><input id="n" name="note" maxlength="300">
  <button type="submit">Send</button></form>`;

export async function onRequestGet({ env, params }) {
  let slug = null;
  try { slug = await wellnessLinkSlug(env.DB, params.token); } catch (err) { console.error('[wellness]', err); }
  if (!slug) return page('<div class="card err"><h1>This link is not available</h1><p>Ask the club\'s staff for a new check-in link.</p></div>', 404);
  return page(form());
}
export async function onRequestPost({ request, env, params }) {
  const f = Object.fromEntries(await request.formData().catch(() => new FormData()));
  let r;
  try { r = await submitWellness(env.DB, params.token, f); } catch (err) { console.error('[wellness]', err); r = { error: 'Something went wrong; please try again.' }; }
  if (r.status === 403) return page(`<div class="card err"><h1>This link is not available</h1><p>${esc(r.error)}</p></div>`, 403);
  return page(form(r.ok ? '<div class="card ok"><b>Thank you, saved.</b> You can send another session or close this page.</div>' : `<div class="card err">${esc(r.error)}</div>`), r.ok ? 200 : 400);
}
