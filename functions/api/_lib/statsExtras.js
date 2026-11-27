// Statistics Center: best-practice improvements with free tools (owner's request, 27 Nov 2026).
//  - Weather at kick-off from Open-Meteo (free, no key, no account): the venue's town is looked up with its free
//    geocoding service; past dates use its free archive. Only the town name and the date are sent.
//  - A public stats feed (JSON) of PUBLISHED matches and season leaders, for media partners and the club's apps.
//  - A private Google Sheets link (IMPORTDATA) with a secret key, switched off by making a new one.
//  - The second check: when switched on, a match can be published only after someone other than the publisher
//    has checked it.
import { ensureStatsCentreSchema, sxSettings, setSxSetting, sxLog, statsActor, sha256Hex, randomToken, oneLine } from './statsCentre.js';
import { publishedMatches, playerTotals, teamTotals, eventsCsv, getMatchRow } from './statsCentreData.js';

const WMO = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail' };
const DEFAULT_PLACE = { name: 'Makurdi', latitude: 7.73375, longitude: 8.52139 }; // McCarthy Stadium's town

/** "Partly cloudy, 31°C, wind 9 km/h" at the kick-off hour, or { error }. */
export async function matchWeather(db, matchId) {
  const m = await getMatchRow(db, matchId);
  if (!m) return { error: 'Match not found.' };
  const day = String(m.match_date).slice(0, 10);
  const hour = /^\d{2}:\d{2}$/.test(m.kickoff_time || '') ? Number(m.kickoff_time.slice(0, 2)) : 16;
  // The town: the last part of the venue ("McCarthy Stadium, Makurdi" -> Makurdi); Makurdi when unknown.
  const town = oneLine(String(m.venue || '').split(',').pop(), 60).replace(/stadium|arena|ground|township|pitch/ig, '').trim();
  let place = DEFAULT_PLACE;
  if (town && !/^makurdi$/i.test(town)) {
    try {
      const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(town)}&count=5&countryCode=NG`, { signal: AbortSignal.timeout(8000) })).json();
      const ng = (g.results || []).find(r => r.country_code === 'NG'); // Nigerian towns only; otherwise Makurdi
      if (ng) place = ng;
    } catch { /* fall back to Makurdi */ }
  }
  const daysAgo = Math.floor((Date.now() - Date.parse(`${day}T12:00:00Z`)) / 864e5);
  if (daysAgo < -15) return { error: 'The forecast only covers the next 15 days.' };
  const base = daysAgo > 60 ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const u = new URL(base);
  for (const [k, v] of Object.entries({ latitude: place.latitude, longitude: place.longitude, hourly: 'temperature_2m,precipitation,weather_code,wind_speed_10m', timezone: 'Africa/Lagos', start_date: day, end_date: day })) u.searchParams.set(k, v);
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    const i = (d.hourly?.time || []).findIndex(t => Number(String(t).slice(11, 13)) === hour);
    if (i < 0) return { error: 'No weather data for that day yet.' };
    const t = Math.round(d.hourly.temperature_2m[i]), w = Math.round(d.hourly.wind_speed_10m[i]), rain = d.hourly.precipitation[i], code = d.hourly.weather_code[i];
    const text = `${WMO[code] || 'Weather'}, ${t}°C, wind ${w} km/h${rain > 0 ? `, rain ${rain} mm` : ''}`;
    return { ok: true, text, place: place.name, source: daysAgo > 60 ? 'Open-Meteo archive' : daysAgo >= 0 ? 'Open-Meteo (recorded)' : 'Open-Meteo forecast' };
  } catch { return { error: 'The weather service did not answer. Try again in a minute.' }; }
}

/** The public feed: published matches and season leaders only (no ratings, notes, analysis or staff names). */
export async function publicFeed(db, season) {
  const snaps = await publishedMatches(db, season);
  const players = playerTotals(snaps), team = teamTotals(snaps);
  const top = k => players.filter(p => p[k] > 0).sort((a, b) => b[k] - a[k]).slice(0, 10).map(p => ({ player: p.name, slug: p.slug, url: `/squad/${p.slug}/`, [k]: p[k], appearances: p.apps }));
  return {
    club: 'Lobi Stars FC', season, generatedAt: new Date().toISOString(), licence: 'Free to use with credit to Lobi Stars FC (lobistarsfc.com).',
    record: { played: team.all.p, won: team.all.w, drawn: team.all.d, lost: team.all.l, goalsFor: team.all.gf, goalsAgainst: team.all.ga, cleanSheets: team.all.cleanSheets },
    form: team.form.map(f => f.r).join(''),
    topScorers: top('goals'), topAssists: top('assists'),
    matches: snaps.slice().reverse().map(s => ({ date: s.match.date, competition: s.match.competition, home: s.match.home, away: s.match.away, score: [s.match.homeScore, s.match.awayScore],
      shots: [s.derived.team.home.shots, s.derived.team.away.shots], shotsOnTarget: [s.derived.team.home.shotsOnTarget, s.derived.team.away.shotsOnTarget], corners: [s.derived.team.home.corners, s.derived.team.away.corners],
      cards: { yellow: [s.derived.team.home.yellow, s.derived.team.away.yellow], red: [s.derived.team.home.red, s.derived.team.away.red] } })),
  };
}

// ── Google Sheets link (IMPORTDATA): a secret key in the address; a new key switches the old link off ──
export async function makeSheetsKey(db, user, { request = null } = {}) {
  const key = randomToken(24).replace(/[^A-Za-z0-9]/g, 'x');
  await setSxSetting(db, 'sheets_key_hash', await sha256Hex(key), user.fullName);
  await setSxSetting(db, 'sheets_key_made', new Date().toISOString(), user.fullName);
  await sxLog(db, statsActor(user), 'sheets_link', { details: 'New Google Sheets link (the old one stops working)', request });
  return { ok: true, key };
}
export async function stopSheetsKey(db, user, { request = null } = {}) {
  await setSxSetting(db, 'sheets_key_hash', '', user.fullName);
  await sxLog(db, statsActor(user), 'sheets_link', { details: 'Google Sheets link switched off', request });
  return { ok: true };
}
export async function sheetsCsv(db, key, season) {
  if (!/^[A-Za-z0-9]{20,60}$/.test(String(key || ''))) return null;
  const s = await sxSettings(db);
  if (!s.sheets_key_hash || s.sheets_key_hash !== await sha256Hex(key)) return null;
  return eventsCsv(db, { season });
}

// ── The second check ──
export async function ensureSecondCheck(db) {
  await ensureStatsCentreSchema(db);
  const cols = new Set((await db.prepare(`PRAGMA table_info(sx_matches)`).all()).results.map(r => r.name));
  for (const c of ['second_check_by', 'second_check_at']) if (!cols.has(c)) await db.prepare(`ALTER TABLE sx_matches ADD COLUMN ${c} TEXT`).run();
}
export async function secondCheck(db, user, id, { request = null } = {}) {
  await ensureSecondCheck(db);
  const m = await getMatchRow(db, id);
  if (!m) return { error: 'Match not found.' };
  const by = user.admin ? `${user.fullName} (Super Admin)` : `${user.fullName} (${user.loginId})`;
  await db.prepare(`UPDATE sx_matches SET second_check_by = ?, second_check_at = ? WHERE id = ?`).bind(by, new Date().toISOString(), id).run();
  await sxLog(db, statsActor(user), 'second_check', { itemType: 'match', itemId: id, details: 'Checked the match before publishing', request });
  return { ok: true };
}
/** null when publishing may go ahead, else the reason. */
export async function secondCheckProblem(db, user, id) {
  const s = await sxSettings(db);
  if (s.second_check !== '1') return null;
  await ensureSecondCheck(db);
  const m = await getMatchRow(db, id);
  const by = user.admin ? `${user.fullName} (Super Admin)` : `${user.fullName} (${user.loginId})`;
  if (!m?.second_check_by) return 'A second person must press "I have checked this match" before it can be published (Settings › Second check).';
  if (m.second_check_by === by) return 'The second check must be done by someone other than the person publishing.';
  return null;
}
