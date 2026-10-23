import { requireAdminUser } from '../../_lib/adminEvents.js';
import { can } from '../../_lib/adminRoles.js';
import { withName, DEFAULT_FROM } from '../../_lib/email.js';
import { logExport, logProfile } from '../../_lib/squadProfiles.js';
import { exportRecipients } from '../../_lib/squadPortal.js';

// POST /api/admin/squad-profiles/export-email -- Super Admins only. A squad data
// export (PDF, Word, Excel, CSV, JSON, Data Package ZIP or the full club records),
// made in the Super Admin's browser, is emailed to dkakaan@lobistarsfc.com and the
// other admins chosen in Settings › Squad & Staff Data Portal. Nobody else receives
// or downloads squad data.
// Body: the file as base64 text. Headers: X-File-Name, X-Format, X-Profiles, X-Filters.
// The base64 is passed straight into the email (never decoded here), so a large ZIP
// stays within Cloudflare's per-request limits.
const MAX_B64 = 30 * 1024 * 1024; // about 22 MB of file (Resend allows 40 MB per email)
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FORMAT = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', csv: 'CSV (ZIP)', json: 'JSON', zip: 'Media Partner Data Package (ZIP)', 'records-xlsx': 'Full club records (Excel, includes private details)', 'records-pdf': 'Full club records (PDF, includes private details)' };

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (!can(admin, 'squad.portal.manage')) return json({ error: 'Only Super Admins can export squad data.' }, 403);
  if (!env.RESEND_API_KEY) return json({ error: 'Email is not set up (RESEND_API_KEY), so the export cannot be sent. Use "Download to this computer".' }, 503);
  const name = String(request.headers.get('X-File-Name') || '').replace(/[^\w.\-]+/g, '-').slice(0, 120);
  const format = String(request.headers.get('X-Format') || '');
  const profiles = Number(request.headers.get('X-Profiles')) || 0;
  let filters = {}; try { filters = JSON.parse(request.headers.get('X-Filters') || '{}'); } catch { filters = {}; }
  if (!name || !FORMAT[format]) return json({ error: 'Unknown export.' }, 400);
  const b64 = (await request.text()).trim();
  if (!b64 || b64.length > MAX_B64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(b64.slice(0, 2000))) return json({ error: b64.length > MAX_B64 ? 'The file is too large to email (over about 22 MB). Choose fewer profiles, or use "Download to this computer".' : 'The file did not arrive.' }, 400);
  const to = await exportRecipients(env.DB);
  const full = format.startsWith('records');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#16181D">
    <p><b>${esc(admin.name)}</b> exported squad data from the Lobi Stars admin: <b>${esc(FORMAT[format])}</b>, ${profiles} profile${profiles === 1 ? '' : 's'} (${esc(filters.which || '')}, ${esc(filters.season === 'all' ? 'all seasons' : 'current season')}).</p>
    <p>The file is attached: <b>${esc(name)}</b>.</p>
    ${full ? '<p style="color:#A3161B"><b>Confidential:</b> it includes private details (phone, email, emergency and guardian contacts). Do not forward it.</p>' : ''}
    <p style="color:#4A505C;font-size:13px">Squad data exports are sent only to the addresses set by the Super Admins (Settings › Squad &amp; Staff Data Portal).</p></div>`;
  // The JSON is built around the base64 text so it is never parsed or copied as an object.
  const head = JSON.stringify({ from: withName(env.RESEND_FROM || DEFAULT_FROM), to, subject: `Lobi Stars squad data: ${FORMAT[format]} (${profiles} profiles)`, html, attachments: [{ filename: name, content: '@@B64@@' }] });
  const [before, after] = head.split('"@@B64@@"');
  const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: `${before}"${b64.replace(/\s+/g, '')}"${after}` });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    await logExport(env.DB, { by: admin.name, place: 'admin', format, filters, profiles, ok: false, note: `email failed: ${detail}` });
    return json({ error: `The email could not be sent (${res.status}). Try again, or use "Download to this computer".` }, 502);
  }
  await logExport(env.DB, { by: admin.name, place: 'admin', format, filters, profiles, ok: true, note: `emailed to ${to.join(', ')}` });
  await logProfile(env.DB, admin, full ? 'squad_full_records' : 'squad_export', `${admin.name} exported ${FORMAT[format]} of ${profiles} profiles; emailed to ${to.join(', ')}`);
  return json({ ok: true, to });
}
