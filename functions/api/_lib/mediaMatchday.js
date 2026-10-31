// Media Centre › Matchday Desk.
//  - Line-ups: the starting XI and substitutes prepared in advance (kind
//    "lineup"); a Super Admin approves; published at the chosen time into the
//    match's Live Match Control record (the match page shows them).
//  - Live updates during a match: kick-off, goal, card, substitution,
//    half-time, full-time, note. They update the match page and the homepage
//    live score (the same record Live Match Control writes). Without a grant
//    each update waits in the Approval Queue (kind "live"); a Super Admin can
//    grant chosen users "pre-approved live updates" for a match, and theirs
//    post instantly. Everything is logged.
import { ensureTable, loadMatch, isHomeGame, LIVE_STATUSES } from './matchCentre.js';
import { autoAlert } from './matchAlerts.js';
import { fromLiveMatchControl } from './scores/consensus.js';
import { settlePredictions } from './predict.js';
import { toPublic } from './matchCentre.js';
import { ensureMediaSchema, oneLine, parseJson, mcLog } from './mediaCentre.js';

export const UPDATE_TYPES = { kickoff: 'Kick-off', goal: 'Goal', yellow: 'Yellow card', red: 'Red card', sub: 'Substitution', halftime: 'Half-time', secondhalf: 'Second half', fulltime: 'Full-time', note: 'Update' };
const nowIso = () => new Date().toISOString();

let ready = false;
export async function ensureMatchdaySchema(db) {
  if (ready) return;
  await ensureMediaSchema(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS mc_live_grants (event_id TEXT NOT NULL, user_id TEXT NOT NULL, granted_by TEXT, granted_at TEXT NOT NULL, PRIMARY KEY (event_id, user_id))`).run();
  ready = true;
}
export async function hasGrant(db, eventId, userId) {
  await ensureMatchdaySchema(db);
  return !!(await db.prepare(`SELECT 1 FROM mc_live_grants WHERE event_id = ? AND user_id = ?`).bind(eventId, userId).first());
}
export async function grants(db) {
  await ensureMatchdaySchema(db);
  return (await db.prepare(`SELECT g.*, u.full_name, u.login_id, e.home_team, e.away_team, e.event_date FROM mc_live_grants g LEFT JOIN mc_users u ON u.id = g.user_id LEFT JOIN events e ON e.id = g.event_id ORDER BY e.event_date DESC LIMIT 100`).all()).results;
}

/** Checks one live update. */
export function checkUpdate(u) {
  u = u || {};
  const type = UPDATE_TYPES[u.type] ? u.type : null;
  if (!type) return { error: 'Choose what happened.' };
  const v = { type, minute: oneLine(u.minute, 6).replace(/[^\d+']/g, ''), team: u.team === 'away' ? 'away' : u.team === 'home' ? 'home' : '', player: oneLine(u.player, 80), detail: oneLine(u.detail, 160) };
  if (['goal', 'yellow', 'red', 'sub'].includes(type) && !v.team) return { error: 'Choose which team.' };
  if (['goal', 'yellow', 'red', 'sub'].includes(type) && !v.player) return { error: 'Enter the player.' };
  if (type === 'note' && v.detail.length < 3) return { error: 'Write the update.' };
  return { value: v };
}

/** Applies a live update to the match record (status, score, timeline) and sends the usual fan alerts. */
export async function applyLiveUpdate(env, eventId, u, { by = 'Media Centre', waitUntil = null } = {}) {
  const db = env.DB;
  await ensureTable(db);
  const m = await loadMatch(db, eventId);
  if (!m) return { error: 'Match not found.' };
  const c = m.centre || {};
  let status = c.status || 'scheduled', home = Number(c.home_score) || 0, away = Number(c.away_score) || 0;
  const prev = { status, home, away };
  const timeline = parseJson(c.timeline_json, []);
  const add = (type, extra = {}) => timeline.push({ minute: u.minute || '', type, team: u.team || '', player: u.player || '', detail: u.detail || '', ...extra });
  if (u.type === 'kickoff') { status = 'live'; add('note', { detail: u.detail || 'Kick-off', team: '' }); }
  if (u.type === 'halftime') { status = 'half-time'; add('note', { detail: u.detail || `Half-time: ${home}-${away}`, team: '' }); }
  if (u.type === 'secondhalf') { status = 'live'; add('note', { detail: u.detail || 'Second half under way', team: '' }); }
  if (u.type === 'fulltime') { status = 'full-time'; add('note', { detail: u.detail || `Full-time: ${home}-${away}`, team: '' }); }
  if (u.type === 'goal') { if (u.team === 'home') home++; else away++; add('goal'); }
  if (u.type === 'yellow' || u.type === 'red' || u.type === 'sub') add(u.type);
  if (u.type === 'note') add('note');
  const kickoffAt = c.kickoff_at || (LIVE_STATUSES.includes(status) || status === 'full-time' ? nowIso() : null);
  const endedAt = status === 'full-time' ? (c.ended_at || nowIso()) : null;
  await db.prepare(`INSERT INTO match_centre (event_id, status, home_score, away_score, timeline_json, kickoff_at, ended_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(event_id) DO UPDATE SET status = excluded.status, home_score = excluded.home_score, away_score = excluded.away_score, timeline_json = excluded.timeline_json,
      kickoff_at = excluded.kickoff_at, ended_at = excluded.ended_at, updated_at = excluded.updated_at`)
    .bind(eventId, status, home, away, JSON.stringify(timeline.slice(-80)), kickoffAt, endedAt).run();
  // The homepage is cached for 30 seconds: clear it so the live score shows at once.
  try { await caches.default.delete(new Request(`${env.SITE_URL || 'https://lobistarsfc.com'}/`)); } catch { /* no cache */ }
  const later = p => { if (waitUntil) waitUntil(p.catch(() => {})); else p.catch(() => {}); };
  later(fromLiveMatchControl(env, eventId, { status, home, away, admin: { name: by } }));
  const alert = (kind, extra = {}, onceKey) => later(autoAlert(env, kind, m.event, { home, away, ...extra }, { onceKey, waitUntil, origin: env.SITE_URL || 'https://lobistarsfc.com' }));
  if (prev.status === 'scheduled' && status === 'live') alert('kickoff');
  if (u.type === 'goal') alert('goal', { scorerTeam: u.team === 'home' ? m.event.home_team : m.event.away_team }, `goal:${home}-${away}`);
  if (prev.status === 'live' && status === 'half-time') alert('halftime');
  if (prev.status === 'half-time' && status === 'live') alert('second_half');
  if (status === 'full-time' && prev.status !== 'full-time') {
    alert('fulltime');
    if (isHomeGame(m.event)) later(settlePredictions(env, { ...toPublic(m.event, c), home_score: home, away_score: away }));
  }
  return { ok: true, status, home, away };
}

// ── The two kinds in the Approval Queue ──
async function lineupNormalise(d) {
  d = d || {};
  const names = l => (Array.isArray(l) ? l : []).map(x => ({ slug: oneLine(x?.slug, 80).toLowerCase(), name: oneLine(x?.name, 80), number: Number.isInteger(Number(x?.number)) ? Number(x.number) : null, position: oneLine(x?.position, 40) })).filter(x => x.name).slice(0, 25);
  return { value: { eventId: oneLine(d.eventId, 80), label: oneLine(d.label, 120), starting: names(d.starting).slice(0, 11), subs: names(d.subs).slice(0, 14), formation: oneLine(d.formation, 12), notes: oneLine(d.notes, 300) } };
}
function lineupValidate(v) {
  if (!v.eventId) return 'Choose the match.';
  if (v.starting.length !== 11) return `Pick exactly 11 starters (now ${v.starting.length}).`;
  return null;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lineupPreview = v => `<h3 style="margin:0 0 6px">${esc(v.label)}${v.formation ? ` · ${esc(v.formation)}` : ''}</h3><p><b>Starting XI:</b> ${v.starting.map(p => `${p.number != null ? `${p.number} ` : ''}${esc(p.name)}`).join(', ')}</p><p><b>Substitutes:</b> ${v.subs.map(p => `${p.number != null ? `${p.number} ` : ''}${esc(p.name)}`).join(', ') || 'none'}</p>`;
async function lineupPublish(env, r, v) {
  const db = env.DB;
  await ensureTable(db);
  const m = await loadMatch(db, v.eventId);
  if (!m) return { error: 'The match no longer exists.' };
  const side = /lobi stars/i.test(m.event.home_team) ? 'home' : 'away';
  const lu = parseJson(m.centre?.lineups_json, { home: { starting: [], subs: [] }, away: { starting: [], subs: [] } });
  lu[side] = { starting: v.starting.map(p => p.name), subs: v.subs.map(p => p.name) };
  const squad = { starting: v.starting.map(p => ({ slug: p.slug, name: p.name, number: p.number, position: p.position, photo: null })), bench: v.subs.map(p => ({ slug: p.slug, name: p.name, number: p.number, position: p.position, photo: null })) };
  await db.prepare(`INSERT INTO match_centre (event_id, status, lineups_json, squad_json, updated_at) VALUES (?, 'scheduled', ?, ?, datetime('now'))
    ON CONFLICT(event_id) DO UPDATE SET lineups_json = excluded.lineups_json, squad_json = excluded.squad_json, updated_at = excluded.updated_at`).bind(v.eventId, JSON.stringify(lu), JSON.stringify(squad)).run();
  return { ok: true, note: 'The line-up is on the match page.' };
}
export const LINEUP = {
  label: 'Line-up', section: 'matchday', schedulable: true,
  normalise: lineupNormalise, validate: lineupValidate, previewHtml: lineupPreview, publish: lineupPublish,
  unpublish: async () => ({ error: 'A published line-up can be changed in Live Match Control.' }),
  titleOf: v => `Line-up: ${v.label || 'match'}`,
  adminFields: [{ key: 'starting', label: 'Starting XI', type: 'json' }, { key: 'subs', label: 'Substitutes', type: 'json' }, { key: 'formation', label: 'Formation', type: 'text' }],
};
async function liveNormalise(d) {
  const c = checkUpdate(d?.update);
  if (c.error) return c;
  return { value: { eventId: oneLine(d.eventId, 80), label: oneLine(d.label, 120), update: c.value } };
}
const livePreview = v => `<p><b>${esc(v.label)}</b></p><p style="font-size:18px">${esc(v.update.minute ? `${v.update.minute}'` : '')} <b>${esc(UPDATE_TYPES[v.update.type])}</b> ${esc(v.update.team ? `(${v.update.team})` : '')} ${esc(v.update.player)} ${esc(v.update.detail)}</p>`;
export const LIVE = {
  label: 'Live update', section: 'matchday', mediaCreate: false,
  normalise: liveNormalise, validate: v => (v.eventId ? null : 'No match.'), previewHtml: livePreview,
  publish: async (env, r, v) => { const res = await applyLiveUpdate(env, v.eventId, v.update, { by: r.decided_by || 'Media Centre' }); return res.ok ? { ok: true, note: `Score now ${res.home}-${res.away} (${res.status}).` } : res; },
  unpublish: async () => ({ error: 'Live updates are corrected in Live Match Control.' }),
  titleOf: v => `${v.label}: ${UPDATE_TYPES[v.update?.type] || 'update'}${v.update?.player ? ` · ${v.update.player}` : ''}`,
};
export { mcLog };
