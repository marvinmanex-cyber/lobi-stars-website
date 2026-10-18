// Bulk downloads of fans' personal data need a fresh two-step login code at the
// moment of downloading. The code is swapped for a download pass (5 minutes,
// for this person only) sent with the download request as x-export-ticket, so the
// code itself never goes in a web address. The pages ask for the code
// automatically when the server answers 428 { needCode: true }.
// File names include the date and the downloader's initials.
import { sha256Hex, randomHex } from './adminSecurity.js';

export const TICKET_MINUTES = 5;
let ready = false;
async function ensure(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS export_tickets (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL)`).run();
  ready = true;
}

export async function createExportTicket(db, admin) {
  await ensure(db);
  const token = randomHex(24);
  await db.prepare(`DELETE FROM export_tickets WHERE expires < ?`).bind(Date.now()).run();
  await db.prepare(`INSERT INTO export_tickets (token_hash, user_id, expires) VALUES (?, ?, ?)`).bind(await sha256Hex(token), admin.id, Date.now() + TICKET_MINUTES * 60000).run();
  return token;
}

/** null when this download may go ahead, otherwise the 428 answer asking for a code. */
export async function freshCodeCheck(request, env, admin) {
  // The emergency admin code has no two-step login; its downloads are alerted like everyone's.
  if (admin.id === 'owner') return null;
  // Automated tests on the local test server (STAFF_TEST_PASSWORDS=1) only.
  if (env.STAFF_TEST_PASSWORDS === '1' && request.headers.get('x-test-skip-code') === '1') return null;
  const token = request.headers.get('x-export-ticket') || '';
  if (/^[a-f0-9]{48}$/.test(token)) {
    await ensure(env.DB);
    const t = await env.DB.prepare(`SELECT user_id, expires FROM export_tickets WHERE token_hash = ?`).bind(await sha256Hex(token)).first();
    if (t && t.user_id === admin.id && t.expires > Date.now()) return null;
  }
  return Response.json({ needCode: true, twoStep: !!admin.twoStep, error: admin.twoStep
    ? 'Downloads of fans\' details need a fresh code: type the 6-digit code from your authenticator app.'
    : 'Downloads of fans\' details need two-step login. Turn it on in My account first.' }, { status: 428, headers: { 'Cache-Control': 'no-store' } });
}

/** "lobi-stars-contacts-2026-10-18-AO.xlsx": the date (Nigeria time) and the downloader's initials. */
export function exportName(base, admin, ext) {
  const date = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  const initials = String(admin?.name || 'staff').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'X';
  return `${base}-${date}-${initials}.${ext}`;
}
