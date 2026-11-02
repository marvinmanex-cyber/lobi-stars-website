import { verifyView } from '../../api/_lib/mediaAccreditation.js';
import { ZONES } from '../../api/_lib/accreditationCards.js';
import { clientIp, rateLimit, ensureFanSchema } from '../../api/_lib/fans.js';

// /media/verify/<token> -- opened by scanning the QR code on an accreditation card.
// A huge status (APPROVED / EXPIRED / NOT VALID / NOT APPROVED / NOT FOUND), the
// photo to compare with the face, name, role, organisation, number, the match and
// (when approved) the access zones. Never the phone number, email or ID card.
// Public, noindex, never cached, rate-limited.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function renderVerify(env, request, rawToken) {
  await ensureFanSchema(env.DB);
  if (!(await rateLimit(env.DB, `verify-acc:${clientIp(request)}`, 120, 600))) return new Response('Too many checks. Please wait a few minutes.', { status: 429, headers: { 'Cache-Control': 'no-store' } });
  const token = String(rawToken || '').replace(/[^\w-]/g, '').slice(0, 80);
  const v = await verifyView(env.DB, token);
  const st = v.status;
  const checked = new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' });
  const body = !v.fullName ? `<div class="st" style="background:${st.colour}"><b>${st.label}</b><span>${esc(st.text)}</span></div>`
    : `<div class="st" style="background:${st.colour}"><b>${st.label}</b><span>${esc(st.text)}</span></div>
      ${v.hasPhoto ? `<img class="ph" src="/api/media/accreditation/photo/${esc(token)}" alt="Photo of ${esc(v.fullName)}" width="240" height="300" />` : ''}
      <h1>${esc(v.fullName)}</h1><p class="org">${esc(v.role)} · CAT. ${esc(v.category)}<br>${esc(v.organisation)}</p>
      <p class="no">${esc(v.number || '')}</p>
      <dl><dt>Match</dt><dd>${esc(v.match)}</dd><dt>Date</dt><dd>${esc(v.day)}</dd><dt>Kick-off</dt><dd>${esc(v.kickOff)}</dd><dt>Venue</dt><dd>${esc(v.venue)}</dd></dl>
      ${st.key === 'approved' ? `<h2>Allowed zones</h2><ul class="zones">${ZONES.filter(z => v.zones.includes(z.n)).map(z => `<li><span>${z.n}</span>${esc(z.name)}</li>`).join('')}</ul>` : ''}`;
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Accreditation check | Lobi Stars FC</title>
  <style>body{margin:0;font:17px/1.5 Arial,Helvetica,sans-serif;background:#F2F4F9;color:#14171f}header{background:#0E2A55;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:10px;font-weight:bold}header img{width:38px;height:38px}main{max-width:520px;margin:0 auto;padding:14px 14px 40px;text-align:center}
  .st{color:#fff;border-radius:16px;padding:22px 14px;margin:0 0 16px}.st b{display:block;font-size:44px;letter-spacing:2px;line-height:1.05}.st span{display:block;margin-top:8px;font-size:17px}
  .ph{display:block;width:240px;height:300px;object-fit:cover;margin:0 auto 12px;border-radius:14px;border:4px solid #0E2A55;background:#ddd}h1{margin:6px 0 2px;font-size:26px}.org{margin:0;color:#4a5260}.no{font-weight:bold;font-size:20px;color:#C8102E;margin:6px 0 12px}
  dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;text-align:left;background:#fff;border-radius:12px;padding:14px 16px;margin:0 0 14px}dt{color:#5b6472}dd{margin:0;font-weight:bold}
  h2{font-size:18px;margin:6px 0}.zones{list-style:none;margin:0 0 14px;padding:0;text-align:left;background:#fff;border-radius:12px}.zones li{display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid #eef0f3}.zones span{width:30px;height:30px;border-radius:6px;background:#0E2A55;color:#fff;display:grid;place-items:center;font-weight:bold}
  .chk{color:#4a5260;font-size:15px}</style></head>
  <body><header><img src="/images/lobi-stars-badge.webp" alt="">LOBI STARS FC · Media accreditation check</header><main>${body}<p class="chk">Check that the face matches the photo. Checked ${esc(checked)}.</p></main></body></html>`;
  return new Response(html, { status: v.fullName ? 200 : 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' } });
}
export const onRequestGet = ({ env, request, params }) => renderVerify(env, request, params.token);
