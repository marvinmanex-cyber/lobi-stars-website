import { verifyView } from '../../../api/_lib/mediaAccreditation.js';

// /media/accreditation/verify/<token> -- opened from the QR code on an
// accreditation card: photo, name, organisation, role, access zone, match and
// VALID / REVOKED / EXPIRED. Never shows the phone number or email address.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function onRequestGet({ env, params }) {
  const token = String(params.token || '').replace(/[^\w-]/g, '').slice(0, 60);
  const v = token ? await verifyView(env.DB, token) : null;
  const colour = !v ? '#6B7280' : v.state === 'VALID' ? '#0F8A4B' : v.state === 'EXPIRED' ? '#A15C00' : '#C9242C';
  const body = !v ? '<p class="st" style="background:#6B7280">NOT FOUND</p><p>This accreditation does not exist. Check the card with the club\'s media team.</p>'
    : `<p class="st" style="background:${colour}">${esc(v.state)}</p>
      <img class="ph" src="/api/media/accreditation/photo/${esc(token)}" alt="Photo of ${esc(v.fullName)}" width="180" height="240" />
      <h1>${esc(v.fullName)}</h1><p class="org">${esc(v.organisation)} · ${esc(v.role)}</p>
      <dl><dt>Match</dt><dd>${esc(v.match)}</dd><dt>Date</dt><dd>${esc(v.day)} · kick-off ${esc(v.kickOff)}</dd><dt>Venue</dt><dd>McCarthy Stadium, Makurdi</dd><dt>Access</dt><dd>${esc(v.zone)}</dd><dt>Number</dt><dd>${esc(v.number)}</dd></dl>
      ${v.state === 'REVOKED' ? `<p class="note">This accreditation was withdrawn by the club${v.revokeReason ? `: ${esc(v.revokeReason)}` : ''}.</p>` : v.state === 'EXPIRED' ? '<p class="note">This card was valid for this match only.</p>' : '<p class="note">Valid for this match only. Check the face matches the photo.</p>'}`;
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Media accreditation check | Lobi Stars FC</title>
  <style>body{margin:0;font:16px/1.5 Arial,Helvetica,sans-serif;background:#F4F6F9;color:#16181D}header{background:#4C76B2;color:#fff;padding:14px 16px;border-bottom:4px solid #EE343C;display:flex;align-items:center;gap:10px}header img{width:44px;height:44px;background:#fff;border-radius:50%;padding:2px}main{max-width:460px;margin:16px auto;padding:0 16px;text-align:center}.st{display:inline-block;color:#fff;font-weight:700;font-size:28px;letter-spacing:2px;padding:8px 22px;border-radius:12px;margin:8px 0 14px}.ph{display:block;margin:0 auto 10px;width:180px;height:240px;object-fit:cover;border-radius:10px;border:3px solid #fff;box-shadow:0 4px 14px rgba(0,0,0,.15);background:#ddd}h1{margin:6px 0 2px;font-size:24px}.org{margin:0 0 12px;color:#4A505C}dl{text-align:left;background:#fff;border-radius:12px;padding:12px 16px;margin:0}dt{font-size:12px;text-transform:uppercase;color:#4A505C;margin-top:8px}dd{margin:0;font-weight:700}.note{color:#4A505C;font-size:14px}</style></head>
  <body><header><img src="/images/lobi-stars-badge.webp" alt=""><b>LOBI STARS FC · Media accreditation check</b></header><main>${body}</main></body></html>`;
  return new Response(html, { status: v ? 200 : 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' } });
}
