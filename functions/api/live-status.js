import { publicCommentaryState } from './_lib/commentary.js';
import { partnerStatus } from './_lib/partnerRadio.js';
import { checkRadioOnAir } from './_lib/matchAlerts.js';

// GET /api/live-status -- everything a Lobi Stars FC Live player shows, in one poll:
//   { onAir, listeners, broadcast, liveMatch, stale, live, nextMatch, ...commentary state }
// - onAir / listeners / broadcast come from the broadcast partner's status feed,
//   read server-side and cached 15 s (partnerRadio.js); if it can't be reached:
//   onAir false, stale true (never an error page).
// - liveMatch: the club's own Live Match Control (score, status, goal scorers)
//   first, with the partner's values where the club has none (e.g. the minute).
// - The commentary state (and the stream address, only while a match's
//   commentary window is open) is the same as /api/commentary, cached 15 s.
// Nothing here names the partner or links anywhere (white-label).
const fresh = { 'Cache-Control': 'no-store' };

export async function onRequestGet({ request, env, waitUntil }) {
  const now = Date.now();
  let partner;
  try { partner = await partnerStatus(env, { now }); }
  catch (err) { console.error('[live-status] partner', err); partner = { onAir: false, listeners: null, broadcast: null, liveMatch: null, stale: true, updatedAt: null }; }

  // The commentary state: shared with /api/commentary's 15-second cache.
  let c = null;
  const cache = caches.default;
  const key = new Request(new URL('/api/commentary', request.url).toString());
  try { const hit = await cache.match(key); if (hit) c = await hit.json(); } catch {}
  if (!c) {
    try {
      c = await publicCommentaryState(env, now);
      waitUntil(cache.put(key, Response.json(c, { headers: { 'Cache-Control': 'public, max-age=15' } })));
    } catch (err) {
      console.error('[live-status] commentary', err);
      c = { enabled: false, brand: 'Lobi Stars FC Live', state: 'off', fixture: null, streamUrl: null, backupUrl: null, commentators: null, upcoming: [], serverTime: new Date(now).toISOString() };
    }
  }
  if (c.state === 'live') waitUntil(checkRadioOnAir(env, { waitUntil, origin: new URL(request.url).origin }).catch(() => {}));

  const liveMatch = c.state === 'live' && c.fixture ? await clubMatch(env.DB, c.fixture, partner.liveMatch, now) : null;
  const commentators = partner.broadcast?.commentators?.length ? partner.broadcast.commentators
    : String(c.commentators || '').split(/\s*(?:,|&| and )\s*/i).map(s => s.trim()).filter(Boolean);
  const body = {
    ...c,
    onAir: !!partner.onAir,
    stale: !!partner.stale,
    listeners: partner.stale ? null : partner.listeners,
    broadcast: { title: partner.broadcast?.title || c.brand || 'Lobi Stars FC Live', commentators, startedAt: partner.broadcast?.startedAt || null },
    liveMatch,
    // Shown as live: a match's commentary window is open with a stream, and the
    // partner says it is on air (or its feed can't be read, so we don't block fans).
    live: c.state === 'live' && !!c.streamUrl && (partner.stale || partner.onAir),
    nextMatch: c.state === 'live' ? null : (c.fixture || c.upcoming?.[0] || null),
    statusUpdatedAt: partner.updatedAt,
  };
  return Response.json(body, { headers: fresh });
}

// "Lobi Stars FC" ~ "Lobi Stars": lower case, no "FC", letters and digits only.
const teamKey = s => String(s || '').toLowerCase().replace(/\bf\.?c\.?\b/g, '').replace(/[^a-z0-9]/g, '');
const sameTeam = (a, b) => { const x = teamKey(a), y = teamKey(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

/** Score, minute and goal scorers for the live fixture: the club's data first, then the partner's (same teams only). */
async function clubMatch(db, f, partnerMatch, now) {
  // The partner's details only count when they are about this same match.
  const p = partnerMatch && sameTeam(partnerMatch.home, f.home_team) && sameTeam(partnerMatch.away, f.away_team) ? partnerMatch : null;
  let timeline = [], kickoffAt = null;
  try {
    const row = await db.prepare(`SELECT timeline_json, kickoff_at FROM match_centre WHERE event_id = ?`).bind(f.id).first();
    timeline = row?.timeline_json ? JSON.parse(row.timeline_json) : [];
    kickoffAt = row?.kickoff_at || null;
  } catch {}
  const goals = (Array.isArray(timeline) ? timeline : []).filter(e => ['goal', 'penalty', 'own-goal'].includes(e.type) && e.player)
    .map(e => ({
      player: `${e.player}${e.type === 'penalty' ? ' (pen)' : e.type === 'own-goal' ? ' (OG)' : ''}`,
      minute: e.minute ? `${String(e.minute).replace(/'$/, '')}'` : '',
      // An own goal counts for the other side.
      team: e.type === 'own-goal' ? (e.team === 'home' ? 'away' : 'home') : (e.team === 'away' ? 'away' : 'home'),
    }));
  const started = ['live', 'half-time', 'full-time'].includes(f.status);
  let minute = null;
  if (f.status === 'half-time') minute = 'HT';
  else if (f.status === 'full-time') minute = 'FT';
  else if (p?.minute) minute = p.minute;
  else if (f.status === 'live' && kickoffAt) {
    // Without a second-half start time only the first half can be counted reliably.
    const m = Math.floor((now - Date.parse(kickoffAt)) / 60000) + 1;
    if (m >= 1 && m <= 45) minute = `${m}'`;
    else if (m > 45 && m <= 50) minute = "45+'";
  }
  return {
    home: f.home_team, away: f.away_team,
    homeScore: started && f.home_score !== null ? f.home_score : (p?.homeScore ?? null),
    awayScore: started && f.away_score !== null ? f.away_score : (p?.awayScore ?? null),
    minute,
    status: f.status || 'scheduled',
    scorers: goals.length ? goals : (p?.scorers || []),
  };
}
