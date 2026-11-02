// Media accreditation system: per-match card settings (colour design, opponent,
// competition, matchday, approving officer and signature), accreditation numbers
// (LSFC/MED/0020 onwards, never reused), access zones, the 4 × 6 in card (front
// and back, drawn in HTML for printing), the approval email (sent once, from
// media@lobistarsfc.com) and the public verification statuses.
// Applications and decisions themselves are in mediaAccreditation.js.
import { sendEmail } from './email.js';
import { mcLog, mediaActor, parseJson, oneLine, randomToken } from './mediaCentre.js';
import { TEAM_LOGOS } from './teamLogos.js';
import qrcodeGenerator from 'qrcode-generator';

export const SITE = 'https://lobistarsfc.com';
export const MEDIA_FROM = 'Lobi Stars FC Media <media@lobistarsfc.com>';
const nowIso = () => new Date().toISOString();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lagos = (iso, opts) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', ...opts });
const LOBI_CREST = '/images/lobi-stars-fc-transparent-256.png';

// Roles: the category code on the card and the access zones ticked by default.
export const ROLES = [
  { name: 'Journalist', code: 'J', zones: [1, 2, 4, 5] },
  { name: 'Photographer', code: 'P', zones: [1, 2, 3, 5] },
  { name: 'Camera / Broadcast', code: 'B', zones: [1, 2, 3, 4, 5] },
  { name: 'Radio', code: 'R', zones: [1, 2, 4, 5] },
  { name: 'Digital / Social Media', code: 'D', zones: [1, 2, 4, 5] },
];
// Applications made before the role list changed.
const OLD_ROLES = { Writer: 'Journalist', 'TV Camera': 'Camera / Broadcast', 'Radio Commentator': 'Radio', 'Digital/Social Media': 'Digital / Social Media' };
export const roleInfo = name => ROLES.find(r => r.name === (OLD_ROLES[name] || name)) || ROLES[0];
export const ZONES = [
  { n: 1, name: 'Press Box / Media Tribune' },
  { n: 2, name: 'Media Centre / Work Room' },
  { n: 3, name: "Pitchside (photographers' positions)" },
  { n: 4, name: 'Mixed Zone (player interviews)' },
  { n: 5, name: 'Post-match Press Conference' },
];
// Card colour designs: one per match day; same layout, only the colours change.
export const THEMES = {
  classic: { name: 'Lobi Classic', main: '#0E2A55', band: '#F5C11A', alert: '#D62839' },
  crest: { name: 'Crest Blue', main: '#2B5A97', band: '#F7D046', alert: '#C8102E' },
  crimson: { name: 'Crimson', main: '#8E1B2A', band: '#F5C11A', alert: '#0E2A55' },
  midnight: { name: 'Midnight', main: '#141B2D', band: '#7CC4F2', alert: '#D62839' },
  sky: { name: 'Sky', main: '#1F3F73', band: '#A9D8F7', alert: '#D62839' },
};
const HEX = /^#[0-9a-f]{6}$/i;
export const SHOW_CONTACT_ON_CARD = false; // the card never shows the phone number or email (since 2 Nov 2026)

let ready = false;
export async function ensureCardSchema(db) {
  if (ready) return;
  const cols = new Set((await db.prepare(`PRAGMA table_info(mc_accreditations)`).all()).results.map(c => c.name));
  for (const [c, t] of [['zones', 'TEXT'], ['seq', 'INTEGER'], ['email_sent_at', 'TEXT'], ['reviewed_at', 'TEXT'], ['reviewed_by', 'TEXT']]) if (!cols.has(c)) await db.prepare(`ALTER TABLE mc_accreditations ADD COLUMN ${c} ${t}`).run();
  await db.batch([
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS mc_accreditations_seq ON mc_accreditations (seq) WHERE seq IS NOT NULL`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mc_accr_matches (
      event_id TEXT PRIMARY KEY,
      opponent TEXT, opponent_logo_id TEXT,
      competition TEXT, matchday TEXT, kickoff_text TEXT, venue TEXT,
      collection_time TEXT,                    -- e.g. 12:00 (written "12 noon")
      accept INTEGER NOT NULL DEFAULT 1,       -- accept applications on the website
      theme TEXT, custom_main TEXT, custom_band TEXT, custom_alert TEXT,
      approver_name TEXT, approver_title TEXT, approver_signature_id TEXT,
      updated_at TEXT, updated_by TEXT)`),
    // Accreditation numbers: LSFC/MED/0020 is the first; the counter only goes up.
    db.prepare(`CREATE TABLE IF NOT EXISTS mc_accr_counter (id TEXT PRIMARY KEY, n INTEGER NOT NULL)`),
    db.prepare(`INSERT OR IGNORE INTO mc_accr_counter (id, n) VALUES ('med', 19)`),
  ]);
  ready = true;
}

/** The next accreditation number (atomic: two approvals at once never get the same one). */
export async function nextAccreditationNumber(db) {
  await ensureCardSchema(db);
  const row = await db.prepare(`UPDATE mc_accr_counter SET n = n + 1 WHERE id = 'med' RETURNING n`).first();
  return { seq: row.n, number: `LSFC/MED/${String(row.n).padStart(4, '0')}` };
}
export const newVerifyToken = () => `${randomToken(24)}${randomToken(12)}`.replace(/[^\w-]/g, ''); // 48+ characters

const opponentOf = e => (/lobi stars/i.test(e.home_team) ? e.away_team : e.home_team);
/** A match's card settings, with defaults (and the last approving officer carried over). */
export async function matchSettings(db, e) {
  await ensureCardSchema(db);
  const row = await db.prepare(`SELECT * FROM mc_accr_matches WHERE event_id = ?`).bind(e.id).first();
  const last = row?.approver_name ? null : await db.prepare(`SELECT approver_name, approver_title, approver_signature_id FROM mc_accr_matches WHERE approver_name IS NOT NULL AND approver_name != '' ORDER BY updated_at DESC LIMIT 1`).first();
  const theme = THEMES[row?.theme] ? row.theme : 'classic';
  const t = THEMES[theme];
  const kickoffText = row?.kickoff_text || lagos(e.event_date, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([ap])\.?m\.?/i, (_, x) => ` ${x.toUpperCase()}M`);
  return {
    eventId: e.id,
    opponent: row?.opponent || opponentOf(e),
    opponentLogoId: row?.opponent_logo_id || null,
    competition: row?.competition || 'Nigeria National League (NNL)',
    matchday: row?.matchday || '',
    kickoff: kickoffText,
    venue: row?.venue || 'McCarthy Stadium, Makurdi',
    collectionTime: row?.collection_time || '12:00',
    accept: row ? !!row.accept : true,
    theme,
    custom: { main: row?.custom_main || '', band: row?.custom_band || '', alert: row?.custom_alert || '' },
    colours: { main: HEX.test(row?.custom_main || '') ? row.custom_main : t.main, band: HEX.test(row?.custom_band || '') ? row.custom_band : t.band, alert: HEX.test(row?.custom_alert || '') ? row.custom_alert : t.alert },
    approverName: row?.approver_name || last?.approver_name || '',
    approverTitle: row?.approver_title || last?.approver_title || 'Media Officer',
    approverSignatureId: row?.approver_signature_id || (row?.approver_name ? null : last?.approver_signature_id) || null,
    saved: !!row,
  };
}
export async function saveMatchSettings(db, user, e, v, request) {
  await ensureCardSchema(db);
  const old = await matchSettings(db, e);
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(v.collectionTime || '') ? v.collectionTime : old.collectionTime;
  const colour = c => (HEX.test(String(c || '').trim()) ? String(c).trim() : '');
  const name = oneLine(v.approverName, 80);
  // A new approver name without a new signature: don't reuse the old person's signature.
  const sig = v.approverSignatureId || (name && name !== old.approverName ? null : old.approverSignatureId);
  await db.prepare(`INSERT INTO mc_accr_matches (event_id, opponent, opponent_logo_id, competition, matchday, kickoff_text, venue, collection_time, accept, theme, custom_main, custom_band, custom_alert, approver_name, approver_title, approver_signature_id, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET opponent = excluded.opponent, opponent_logo_id = excluded.opponent_logo_id, competition = excluded.competition, matchday = excluded.matchday, kickoff_text = excluded.kickoff_text,
      venue = excluded.venue, collection_time = excluded.collection_time, accept = excluded.accept, theme = excluded.theme, custom_main = excluded.custom_main, custom_band = excluded.custom_band, custom_alert = excluded.custom_alert,
      approver_name = excluded.approver_name, approver_title = excluded.approver_title, approver_signature_id = excluded.approver_signature_id, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(e.id, oneLine(v.opponent, 80) || old.opponent, v.opponentLogoId || old.opponentLogoId, oneLine(v.competition, 80) || old.competition, oneLine(v.matchday, 10), oneLine(v.kickoff, 20) || null,
      oneLine(v.venue, 120) || old.venue, time, v.accept === false ? 0 : 1, THEMES[v.theme] ? v.theme : old.theme, colour(v.customMain), colour(v.customBand), colour(v.customAlert),
      name || null, oneLine(v.approverTitle, 60) || 'Media Officer', sig || null, nowIso(), user.fullName).run();
  await mcLog(db, mediaActor(user), 'card_settings', { section: 'accreditation', itemType: 'match', itemId: e.id, itemTitle: `Lobi Stars FC vs ${oneLine(v.opponent, 80) || old.opponent}`, details: `Design ${THEMES[v.theme]?.name || old.theme}; approver ${name || '(none)'}`, request });
  return { ok: true };
}

// ── Card pieces ──
export function qrSvg(text, size = 84) {
  const qr = qrcodeGenerator(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), q = 2, total = n + q * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
export const verifyUrl = token => `${SITE}/media/verify/${token}`;
const fileUrl = id => (id ? `/api/media-file/${encodeURIComponent(id)}` : '');
export const zonesOf = r => { const z = parseJson(r.zones, null); return Array.isArray(z) && z.length ? z.map(Number).filter(n => n >= 1 && n <= 5) : roleInfo(r.role).zones; };
const shortDate = iso => lagos(iso, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/,/g, '');
export const longDate = iso => lagos(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const noonText = t => (t === '12:00' ? '12 noon' : (() => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; })());

/** One card (front and back) as HTML. */
export function cardHtml(r, e, ms) {
  const c = ms.colours, role = roleInfo(r.role), zones = zonesOf(r);
  const oppLogo = ms.opponentLogoId ? fileUrl(ms.opponentLogoId) : TEAM_LOGOS[ms.opponent] || TEAM_LOGOS[opponentOf(e)] || '';
  const photo = r.photo_id ? fileUrl(r.photo_id) : '';
  const revoked = r.status === 'revoked';
  const vars = `--main:${c.main};--band:${c.band};--alert:${c.alert}`;
  const front = `<section class="card front" style="${vars}">
    <header class="c-head"><img src="${LOBI_CREST}" alt="" class="c-crest"/><div><b>LOBI STARS FC</b><span class="c-acc">MEDIA ACCREDITATION</span><small>2026/27 SEASON · HOME MATCH</small></div></header>
    <div class="c-role"><span>${esc(role.name.toUpperCase())}</span><em>CAT. ${role.code}</em></div>
    <div class="c-match"><img src="${LOBI_CREST}" alt="" /><div class="c-mt"><b>LOBI STARS FC</b><i>VS</i><b>${esc(ms.opponent.toUpperCase())}</b></div>${oppLogo ? `<img src="${esc(oppLogo)}" alt="" />` : '<span class="c-ph"></span>'}
      <p>${esc(ms.competition)}${ms.matchday ? ` · Matchday ${esc(ms.matchday)}` : ''}</p><p>${esc(shortDate(e.event_date))} · KO ${esc(ms.kickoff)} · ${esc(ms.venue)}</p></div>
    <div class="c-holder">${photo ? `<img src="${esc(photo)}" alt="" class="c-photo"/>` : '<span class="c-photo"></span>'}<div><small>FULL NAME</small><b>${esc(r.full_name.toUpperCase())}</b><small>MEDIA ORGANISATION</small><span>${esc(r.organisation)}</span><small>ACCREDITATION NO.</small><strong>${esc(r.number || '—')}</strong></div></div>
    <div class="c-zones">${ZONES.map(z => `<span class="${zones.includes(z.n) ? 'on' : 'off'}">${z.n}</span>`).join('')}</div>
    <div class="c-appr"><div><small>APPROVED BY</small>${ms.approverSignatureId ? `<img src="${esc(fileUrl(ms.approverSignatureId))}" alt="" class="c-sig"/>` : '<span class="c-sig"></span>'}<b>${esc(ms.approverName || '—')}</b><span>${esc(ms.approverTitle)}, Lobi Stars FC</span></div>${r.verify_token ? qrSvg(verifyUrl(r.verify_token), 84) : ''}</div>
    <footer class="c-foot">VALID FOR THIS MATCH ONLY · NON-TRANSFERABLE</footer>
    ${revoked ? '<div class="c-revoked">REVOKED</div>' : ''}
  </section>`;
  // The back (club design, 2 Nov 2026): holder name, number, match and special needs (no phone or email),
  // the access zone key, conditions of use, and where to return a lost card.
  const back = `<section class="card back" style="${vars}">
    <header class="b-head"><img src="${LOBI_CREST}" alt="" /><b>LOBI STARS FC</b><span>MEDIA<br>ACCREDITATION</span></header>
    <div class="b-sec"><h3>HOLDER DETAILS</h3>
      <dl class="b-dl"><dt>Name</dt><dd>${esc(r.full_name)}</dd><dt>Accreditation no.</dt><dd>${esc(r.number || '—')}</dd>
        <dt>Match</dt><dd>Lobi Stars FC vs ${esc(ms.opponent)}, ${esc(shortDate(e.event_date))}</dd><dt>Special needs</dt><dd>${esc(r.needs || 'None stated')}</dd></dl></div>
    <div class="b-sec"><h3>ACCESS ZONE KEY</h3><ol class="b-key">${ZONES.map(z => `<li><span>${z.n}</span>${esc(z.name)}</li>`).join('')}</ol></div>
    <div class="b-sec b-last"><h3>CONDITIONS OF USE</h3><ol class="b-cond"><li>Wear this card visibly at all times inside the stadium.</li><li>Valid only for the match on the front. Not transferable.</li><li>Entry is limited to the zones marked on the front.</li><li>Follow directions from stewards, security and media officers.</li><li>Misuse or lending this card leads to its withdrawal.</li></ol></div>
    <div class="b-found"><small>IF FOUND, PLEASE RETURN TO</small><b>Media Department, Lobi Stars FC</b><span>lobistarsfc.com/media</span></div>
    <footer class="c-foot"></footer>
    ${revoked ? '<div class="c-revoked">REVOKED</div>' : ''}
  </section>`;
  return { front, back };
}
export const CARD_CSS = `
.card{position:relative;width:384px;height:576px;box-sizing:border-box;background:#fff;color:#14171f;font-family:Inter,Arial,sans-serif;overflow:hidden;display:flex;flex-direction:column;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.card b,.card strong,.card h3{font-family:Oswald,Arial Narrow,sans-serif;font-weight:600}
.c-head{height:90px;flex:none;background:var(--main);color:#fff;display:flex;align-items:center;gap:12px;padding:0 16px}
.c-head.small{height:72px;border-bottom:4px solid var(--band)}
.c-crest{width:62px;height:62px;object-fit:contain}.c-head.small .c-crest{width:48px;height:48px}
.c-head b{display:block;font-size:22px;letter-spacing:1px;line-height:1.1}.c-acc{display:block;color:var(--band);font:600 14px/1.2 Oswald,sans-serif;letter-spacing:2px}.c-head small{display:block;color:#c9d1dd;font-size:10px;letter-spacing:1.5px;margin-top:2px}
.c-role{height:42px;flex:none;background:var(--band);color:var(--main);display:flex;align-items:center;justify-content:space-between;padding:0 16px}
.c-role span{font:700 24px/1 Oswald,sans-serif;letter-spacing:2px}.c-role em{font-style:normal;background:var(--alert);color:#fff;font:600 12px/1 Oswald,sans-serif;padding:5px 8px;border-radius:4px;letter-spacing:1px}
.c-match{flex:none;background:#F2F4F9;display:grid;grid-template-columns:44px 1fr 44px;align-items:center;gap:6px;padding:9px 14px 7px}
.c-match>img,.c-ph{width:44px;height:44px;object-fit:contain}.c-mt{text-align:center;line-height:1.05}.c-mt b{display:block;font-size:15px;color:var(--main)}.c-mt i{display:block;font:600 11px/1.3 Oswald,sans-serif;color:var(--alert);font-style:normal}
.c-match p{grid-column:1/-1;margin:2px 0 0;text-align:center;font-size:10.5px;color:#3b4252;line-height:1.3}
.c-holder{flex:none;display:flex;gap:12px;padding:12px 16px 8px}
.c-photo{width:92px;height:115px;object-fit:cover;border-radius:8px;border:3px solid var(--main);background:#e8ebf1;flex:none;display:block}
.c-holder small{display:block;font-size:8.5px;letter-spacing:1px;color:#6b7280;margin-top:3px}.c-holder b{display:block;font-size:17px;line-height:1.1}.c-holder span{display:block;font-size:12px;line-height:1.25}.c-holder strong{display:block;color:var(--alert);font-size:17px;letter-spacing:.5px}
.c-zones{flex:none;display:flex;gap:8px;padding:2px 16px 10px}
.c-zones span{flex:1;height:34px;border-radius:6px;display:grid;place-items:center;font:700 18px/1 Oswald,sans-serif}
.c-zones .on{background:var(--main);color:#fff}.c-zones .off{border:2px solid #c7ccd6;color:#c7ccd6;text-decoration:line-through}
.c-appr{flex:1;border-top:3px solid #C9A227;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 16px}
.c-appr small{display:block;font-size:8.5px;letter-spacing:1px;color:#6b7280}.c-sig{display:block;height:34px;max-width:170px;object-fit:contain;border-bottom:1px solid #9aa1ad;min-width:150px}
.c-appr b{display:block;font-size:14px;margin-top:2px}.c-appr span{display:block;font-size:10.5px;color:#3b4252}
.c-foot{height:30px;flex:none;background:var(--alert);color:#fff;display:grid;place-items:center;font:600 11px/1 Oswald,sans-serif;letter-spacing:1.2px}
.back .c-foot{margin-top:auto}
.c-sec{padding:8px 16px 2px}.c-sec h3{margin:0 0 4px;font-size:13px;letter-spacing:1.5px;color:var(--main);border-bottom:2px solid var(--band);padding-bottom:2px}
.c-sec p{margin:0 0 2px;font-size:11.5px}.c-sec small{display:inline-block;width:92px;color:#6b7280}
.c-key,.c-cond{margin:0;padding:0 0 0 2px;list-style:none;font-size:11px;line-height:1.45}
.c-key li{display:flex;gap:8px;align-items:center}.c-key span{width:18px;height:18px;border-radius:4px;background:var(--main);color:#fff;display:grid;place-items:center;font:600 11px/1 Oswald,sans-serif}
.c-cond{counter-reset:k}.c-cond li{counter-increment:k;padding-left:16px;position:relative}.c-cond li::before{content:counter(k);position:absolute;left:0;font-weight:700;color:var(--alert)}
.c-found{margin:8px 16px 10px;background:#F2F4F9;border-radius:8px;padding:8px 12px;text-align:center;font-size:11px}.c-found small{display:block;font-size:9px;letter-spacing:1px;color:#6b7280}.c-found b{display:block;font-size:13px}
.b-head{height:60px;flex:none;background:var(--main);color:#fff;display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:4px solid var(--band)}
.b-head img{width:38px;height:38px;object-fit:contain}.card .b-head b{font:800 19px/1 Inter,Arial,sans-serif;letter-spacing:1.5px}.b-head span{color:var(--band);font:800 8.5px/1.15 Inter,Arial,sans-serif;letter-spacing:1.6px}
.b-sec{margin:0 16px;padding:11px 0 8px;border-bottom:1px solid #E1E4EA}.b-sec.b-last{border-bottom:0}
.card .b-sec h3{margin:0 0 7px;font:800 12px/1 Inter,Arial,sans-serif;letter-spacing:1.6px;color:var(--main);border:0;padding:0}
.b-dl{display:grid;grid-template-columns:104px 1fr;gap:5px 8px;margin:0;font-size:10px;line-height:1.35}.b-dl dt{font-weight:700;color:#5b6472}.b-dl dd{margin:0;color:#14171f}
.b-key{margin:0;padding:0;list-style:none;font-size:10px;line-height:1.3;display:grid;gap:5px}.b-key li{display:flex;gap:9px;align-items:center}
.b-key span{width:20px;height:20px;border-radius:4px;background:var(--main);color:#fff;display:grid;place-items:center;font:800 10px/1 Inter,Arial,sans-serif;flex:none}
.b-cond{margin:0;padding:0 0 0 16px;font-size:9.5px;line-height:1.55;color:#3b4252}
.b-found{margin:4px 16px 12px;background:#F2F4F9;border-radius:8px;padding:12px 12px 14px;font-size:10px}.b-found small{display:block;font-size:8px;letter-spacing:1.4px;color:#6b7280;font-weight:700}
.card .b-found b{display:block;font:800 11px/1.4 Inter,Arial,sans-serif;color:#14171f}.b-found span{display:block;color:var(--alert);font-weight:700}
.c-revoked{position:absolute;inset:0;display:grid;place-items:center;font:700 74px/1 Oswald,sans-serif;color:rgba(214,40,57,.38);transform:rotate(-28deg);letter-spacing:6px;pointer-events:none}`;

/** A printable page of cards (front and back, one face per 4 × 6 in page). */
export function printPage(title, cards) {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Oswald:wght@500;600;700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#E5E8EE;font-family:Inter,Arial,sans-serif}.bar{position:sticky;top:0;z-index:5;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 18px;background:#0E2A55;color:#fff}
.bar button{min-height:44px;padding:0 20px;border:0;border-radius:8px;background:#F5C11A;color:#0E2A55;font:700 15px/1 Oswald,sans-serif;letter-spacing:1px;cursor:pointer}
.grid{display:flex;flex-wrap:wrap;gap:22px;justify-content:center;padding:22px}.empty{padding:40px;text-align:center}
${CARD_CSS}
@page{size:4in 6in;margin:0}
@media print{body{background:#fff}.bar{display:none}.grid{display:block;padding:0}.card{width:4in;height:6in;border-radius:0;box-shadow:none;page-break-after:always;break-after:page;zoom:1}}
</style></head><body><div class="bar"><b>${esc(title)}</b><button type="button" onclick="print()">Print cards</button></div>
<div class="grid">${cards.length ? cards.map(c => c.front + c.back).join('') : '<p class="empty">No approved cards for this match yet.</p>'}</div></body></html>`;
}

// ── The approval email ──
export function approvalEmail(r, e, ms) {
  const c = ms.colours, role = roleInfo(r.role), first = String(r.full_name).split(/\s+/)[0];
  const day = longDate(e.event_date), when = noonText(ms.collectionTime);
  const row = (k, v) => `<tr><td style="padding:6px 0;color:#5b6472;font-size:14px;width:150px;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-size:15px;font-weight:bold">${esc(v)}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#F2F4F9;font-family:Arial,Helvetica,sans-serif;color:#14171f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:${c.main};padding:18px 24px;border-bottom:5px solid ${c.band}"><img src="${SITE}/images/lobi-stars-badge.png" width="52" height="52" alt="Lobi Stars FC" style="vertical-align:middle;border:0"> <span style="color:#fff;font-size:19px;font-weight:bold;vertical-align:middle;margin-left:8px">LOBI STARS FC</span><br><span style="color:${c.band};font-size:13px;letter-spacing:2px;font-weight:bold">MEDIA ACCREDITATION</span></td></tr>
<tr><td style="padding:24px 26px">
<p style="margin:0 0 14px;font-size:16px">Dear ${esc(first)},</p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.5">Your media accreditation for <b>Lobi Stars FC vs ${esc(ms.opponent)}</b> has been approved.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F4F9;border-left:5px solid ${c.main};border-radius:8px;padding:10px 16px;margin:0 0 18px">
${row('Competition', `${ms.competition}${ms.matchday ? `, Matchday ${ms.matchday}` : ''}`)}${row('Date and kick-off', `${day}, ${ms.kickoff}`)}${row('Venue', ms.venue)}${row('Role', role.name)}${row('Accreditation no.', r.number)}</table>
<h2 style="margin:0 0 8px;font-size:18px;color:${c.main}">Collecting your card</h2>
<p style="margin:0 0 12px;font-size:15px;line-height:1.55">Your accreditation card will be ready for collection at ${esc(ms.venue)} from <b>${esc(when)}</b> on match day, <b>${esc(day)}</b>. Please bring your press ID or a valid photo ID. The card is only released to you in person.</p>
<p style="margin:0 0 12px;font-size:15px;line-height:1.55">The card is valid for this match only. Wear it visibly at all times inside the stadium, and stay within the access zones printed on it.</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.55">For any questions, reply to this email or write to <a href="mailto:media@lobistarsfc.com" style="color:${c.main}">media@lobistarsfc.com</a>.</p>
<p style="margin:0;font-size:15px;line-height:1.5">Regards,<br><b>${esc(ms.approverName)}</b><br>${esc(ms.approverTitle)}, Lobi Stars FC</p>
</td></tr><tr><td style="background:${c.alert};color:#fff;text-align:center;font-size:12px;letter-spacing:1px;padding:10px">LOBI STARS FC · MEDIA DEPARTMENT · LOBISTARSFC.COM</td></tr></table></td></tr></table></body></html>`;
  const subject = `Media accreditation approved: Lobi Stars FC vs ${ms.opponent}, ${lagos(e.event_date, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return { subject, html, text: html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<br>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim() };
}
/** Sends the approval email to one approved applicant (records the time). */
export async function sendApprovalTo(env, r, e, ms) {
  const m = approvalEmail(r, e, ms);
  if (env.RESEND_API_KEY) await sendEmail(env, { to: r.email, from: MEDIA_FROM, replyTo: 'media@lobistarsfc.com', subject: m.subject, html: m.html, text: m.text });
  else if (String(env.FANS_DEV_LINKS) !== '1') return false;
  await env.DB.prepare(`UPDATE mc_accreditations SET email_sent_at = ? WHERE id = ?`).bind(nowIso(), r.id).run();
  return true;
}

// ── Verification (public) ──
export function verifyStatus(r, e) {
  if (!r) return { key: 'notfound', label: 'NOT FOUND', colour: '#C62828', text: 'This card is not recognised. Do not allow entry.' };
  if (r.status === 'revoked') return { key: 'revoked', label: 'NOT VALID', colour: '#C62828', text: 'This card has been withdrawn by the club. Do not allow entry.' };
  if (r.status !== 'approved') return { key: 'notapproved', label: 'NOT APPROVED', colour: '#C62828', text: 'This application has not been approved. Do not allow entry.' };
  const day = e ? lagos(e.event_date, { year: 'numeric', month: '2-digit', day: '2-digit' }) : '';
  const today = lagos(new Date().toISOString(), { year: 'numeric', month: '2-digit', day: '2-digit' });
  const past = e && Date.parse(e.event_date) < Date.now() && day !== today;
  if (!e || past) return { key: 'expired', label: 'EXPIRED', colour: '#B26A00', text: 'The match on this card has already been played.' };
  return { key: 'approved', label: 'APPROVED', colour: '#1B7F3B', text: 'This accreditation is valid for the match below.' };
}
