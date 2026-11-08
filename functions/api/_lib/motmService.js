// Man of the Match: the rules (motmRules.js) connected to the database, fan accounts and settings.
// Used by GET /api/motm/current.json, POST /api/motm/vote, Matchday Live, Live Match Control and
// the sponsor page. The announcement is saved once, on the first request at or after closing time
// (UNIQUE event_id); nobody has to sign it off.
import { ensureTable, loadMatch, toPublic, listMatches, isHomeGame } from './matchCentre.js';
import { matchSlug } from './matchSlug.js';
import { currentFan } from './matchdayFan.js';
import { votingWindow, candidates, tally, isHeldAccount, sponsorView, announcementData, announcementView, clubTime } from './motmRules.js';
import { getGameSponsor, saveGameSponsor } from './gameSponsors.js';

let ready = false;
export async function ensureMotmTables(db) {
  await ensureTable(db);
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS motm_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, member_id TEXT NOT NULL, player_slug TEXT NOT NULL, player_name TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), UNIQUE (event_id, member_id))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_motm_votes_event ON motm_votes(event_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS motm_announcements (event_id TEXT PRIMARY KEY, data_json TEXT NOT NULL, announced_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT)`),
  ]);
  const cols = new Set((await db.prepare(`PRAGMA table_info(motm_votes)`).all()).results.map(r => r.name));
  // 'counted' or 'held' (account made less than 24 hours before kick-off).
  if (!cols.has('status')) await db.prepare(`ALTER TABLE motm_votes ADD COLUMN status TEXT NOT NULL DEFAULT 'counted'`).run().catch(() => {});
  ready = true;
}

// ── Sponsor (settings record "motm_sponsor", shared with the other game sponsors: gameSponsors.js) ──
export async function getSponsor(db) { await ensureMotmTables(db); return getGameSponsor(db, 'motm'); }
export async function saveSponsor(db, patch, by) { return saveGameSponsor(db, 'motm', patch, by); }

// ── Which match ──
const lagosDay = t => new Date(t + 3600e3).toISOString().slice(0, 10);
/** A match by id or slug, or the current one: today's home game, else the next home game, else the last one. */
export async function findMotmMatch(env, key = '') {
  await ensureTable(env.DB);
  let id = null;
  if (key) {
    const k = String(key).toLowerCase();
    const { results } = await env.DB.prepare(`SELECT * FROM events WHERE active = 1`).all();
    const e = results.find(x => x.id.toLowerCase() === k || matchSlug(x) === k);
    if (!e) return null;
    id = e.id;
  } else {
    const now = Date.now(), today = lagosDay(now);
    const home = (await listMatches(env.DB)).filter(isHomeGame);
    // Today's home game (the one nearest now, if there were ever two).
    const t = home.filter(e => lagosDay(Date.parse(e.event_date)) === today && !['postponed', 'cancelled'].includes(e.status)).sort((a, b) => Math.abs(Date.parse(a.event_date) - now) - Math.abs(Date.parse(b.event_date) - now))[0];
    const next = home.filter(e => Date.parse(e.event_date) > now && !['postponed', 'cancelled'].includes(e.status)).sort((a, b) => Date.parse(a.event_date) - Date.parse(b.event_date))[0];
    const last = home.filter(e => Date.parse(e.event_date) <= now).sort((a, b) => Date.parse(b.event_date) - Date.parse(a.event_date))[0];
    id = (t || next || last)?.id || null;
    if (!id) return null;
  }
  const m = await loadMatch(env.DB, id);
  return m ? toPublic(m.event, m.centre) : null;
}

const side = m => (/lobi stars/i.test(m.home_team || '') ? 'home' : 'away');
const opponentOf = m => (side(m) === 'home' ? m.away_team : m.home_team);
const venueOf = m => (/mccarthy/i.test(m.venue || '') || !m.venue ? 'McCarthy Stadium' : String(m.venue).split(',')[0]);

let rosterCache = null;
/** Squad photos (from /squad) by player slug. */
async function squadPhotos(env, request) {
  if (rosterCache && Date.now() - rosterCache.at < 300e3) return rosterCache.map;
  let list = [];
  try { list = await (await env.ASSETS.fetch(new URL('/data/players.json', request.url))).json(); } catch { /* no photos */ }
  rosterCache = { at: Date.now(), map: new Map(list.filter(p => p.photo).map(p => [p.slug, p.photo])) };
  return rosterCache.map;
}
/** The squad voting uses: Live Match Control's, or (if empty) the Media Centre line-up, with squad photos. */
async function squadFor(env, request, m) {
  let squad = m.squad?.starting?.length ? m.squad : null;
  if (!squad) {
    const { mediaLineup } = await import('./motm.js');
    const lu = await mediaLineup(env.DB, m.id);
    squad = lu ? { starting: lu.starting, bench: lu.bench } : { starting: [], bench: [] };
  }
  const photos = await squadPhotos(env, request);
  const withPhoto = p => ({ ...p, photo: photos.get(p.slug) || null });
  return { starting: (squad.starting || []).map(withPhoto), bench: (squad.bench || []).map(withPhoto) };
}

/** The saved announcement for a closed match; counts and saves it once if it isn't saved yet. */
export async function announcement(env, request, m, win) {
  const db = env.DB;
  let row = await db.prepare(`SELECT data_json FROM motm_announcements WHERE event_id = ?`).bind(m.id).first();
  if (!row) {
    const players = candidates(await squadFor(env, request, m), m.timeline, side(m), Date.parse(win.closesAt));
    const { results } = await db.prepare(`SELECT player_slug, created_at, status FROM motm_votes WHERE event_id = ?`).bind(m.id).all();
    const data = announcementData(tally({ votes: results, players, opensAt: win.opensAt, closesAt: win.closesAt }), new Date().toISOString());
    await db.prepare(`INSERT INTO motm_announcements (event_id, data_json, announced_at) VALUES (?, ?, ?) ON CONFLICT (event_id) DO NOTHING`).bind(m.id, JSON.stringify(data), data.announcedAt).run();
    row = await db.prepare(`SELECT data_json FROM motm_announcements WHERE event_id = ?`).bind(m.id).first();
  }
  return JSON.parse(row.data_json);
}

/** Past winners this season (2026/27), newest first, with the final score. */
export async function seasonArchive(env, { seasonStart = '2026-07-01', seasonEnd = '2027-07-01', sponsor = null } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT a.event_id, a.data_json, e.home_team, e.away_team, e.event_date, e.venue, m.home_score, m.away_score, m.status
     FROM motm_announcements a JOIN events e ON e.id = a.event_id LEFT JOIN match_centre m ON m.event_id = a.event_id
     WHERE e.event_date >= ? AND e.event_date < ? ORDER BY e.event_date DESC LIMIT 60`
  ).bind(seasonStart, seasonEnd).all();
  return results.map(r => {
    const d = JSON.parse(r.data_json || '{}');
    const m = { home_team: r.home_team, away_team: r.away_team, venue: r.venue };
    return {
      matchId: r.event_id, match: `Lobi Stars vs ${opponentOf(m)}`, date: r.event_date,
      score: r.status === 'full-time' && r.home_score != null ? `${r.home_score}-${r.away_score}` : null,
      ...announcementView(d, { opponent: opponentOf(m), venue: venueOf(m), sponsor }),
    };
  });
}

/** Everything the page and Matchday Live need. */
export async function motmStatus(env, request, key = '') {
  const db = env.DB;
  await ensureMotmTables(db);
  const m = await findMotmMatch(env, key);
  const sponsor = sponsorView(await getSponsor(db));
  if (!m) return { status: 'no_match', opensAt: null, closesAt: null, matchId: null, opponent: null, sponsor };
  const win = votingWindow(m);
  const out = { status: win.status, opensAt: win.opensAt, closesAt: win.closesAt, matchId: m.id, slug: m.slug, opponent: opponentOf(m), venue: venueOf(m), kickoff: m.event_date, sponsor };
  if (win.status === 'not_home' || win.status === 'cancelled') return out;
  const fan = await currentFan(request, env);
  if (fan) {
    out.fan = { firstName: fan.first_name, verified: !!fan.email_verified };
    const mine = await db.prepare(`SELECT player_slug, player_name, created_at FROM motm_votes WHERE event_id = ? AND member_id = ?`).bind(m.id, fan.id).first();
    out.myVote = mine ? { slug: mine.player_slug, name: mine.player_name, at: mine.created_at } : null;
  } else { out.fan = null; out.myVote = null; }
  if (win.status === 'open') {
    out.candidates = candidates(await squadFor(env, request, m), m.timeline, side(m)).map(p => ({ id: p.slug, slug: p.slug, name: p.name, number: p.number ?? null, position: p.position || '', photoUrl: p.photo || null, role: p.role }));
  }
  if (win.status === 'closed') out.announcement = announcementView(await announcement(env, request, m, win), { opponent: out.opponent, venue: out.venue, sponsor });
  return out;
}

const fail = (error, code, status = 409) => ({ error, code, status });
/** One vote: { ok, myVote } or { error, code, status }. Messages are the ones fans see. */
export async function castVote(env, request, key, playerId) {
  const db = env.DB;
  await ensureMotmTables(db);
  const m = await findMotmMatch(env, key);
  if (!m) return fail('There is no match to vote on.', 'no_match', 404);
  const win = votingWindow(m);
  if (win.status === 'not_home') return fail('Man of the Match voting is only for Lobi Stars home games.', 'not_home', 404);
  if (win.status === 'cancelled') return fail('There is no Man of the Match vote for this match.', 'off');
  if (win.status === 'upcoming') return fail(`Voting opens at ${clubTime(win.opensAt)}.`, 'before');
  if (win.status === 'closed') return fail(`Voting closed at ${clubTime(win.closesAt)}.`, 'closed');
  const fan = await currentFan(request, env);
  if (!fan) return fail('Log in to vote.', 'login', 401);
  if (!fan.email_verified) return fail('Confirm your email address to vote.', 'unverified', 403);
  const player = candidates(await squadFor(env, request, m), m.timeline, side(m)).find(p => p.slug === String(playerId || ''));
  if (!player) return fail('You can only vote for players taking part in the match.', 'not_playing', 400);
  const acct = await db.prepare(`SELECT created_at FROM members WHERE id = ?`).bind(fan.id).first();
  const status = isHeldAccount(acct?.created_at, m.event_date) ? 'held' : 'counted';
  const at = new Date().toISOString();
  const res = await db.prepare(`INSERT INTO motm_votes (event_id, member_id, player_slug, player_name, created_at, status) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (event_id, member_id) DO NOTHING`)
    .bind(m.id, fan.id, player.slug, player.name, at, status).run();
  if (!res.meta?.changes) return fail('You have already voted in this match.', 'voted');
  return { ok: true, match: m, fan, myVote: { slug: player.slug, name: player.name, at } };
}

/** Staff view (any time): every valid vote so far, the held and invalid ones counted separately. */
export async function staffTally(env, request, m) {
  await ensureMotmTables(env.DB);
  const win = votingWindow(m);
  const at = Math.min(Date.now(), Date.parse(win.closesAt || new Date().toISOString()));
  const players = candidates(await squadFor(env, request, m), m.timeline, side(m), at);
  const { results } = await env.DB.prepare(`SELECT player_slug, created_at, status FROM motm_votes WHERE event_id = ?`).bind(m.id).all();
  return { win, players, ...tally({ votes: results, players, opensAt: win.opensAt || new Date(0).toISOString(), closesAt: win.closesAt || new Date().toISOString() }) };
}
