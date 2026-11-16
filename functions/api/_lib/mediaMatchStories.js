// Media Centre: a preview before and a report after every Lobi Stars match (good for fans and for Google: fresh,
// match-specific stories). For each match from 3 days ago to 3 days ahead it checks the published stories
// (/data/news-index.json) for a preview (due 2 days before kick-off) and a report (due by noon the day after).
// Missing ones show on the Media Centre home under "Upcoming deadlines", and the media team is emailed once per
// match for each (remembered in mc_settings). Free: no AI, one small database read. Nov 2026.
import { ensureMediaSchema, mcSettings, setMcSetting, mcLog, SYSTEM } from './mediaCentre.js';
import { sendEmail } from './email.js';

const SITE = 'https://lobistarsfc.com';
const DAY = 864e5, LAGOS = 3600e3;
const lagosDay = ms => new Date(ms + LAGOS).toISOString().slice(0, 10);
// Story text in normal letters (titles pasted from social media often use 𝗯𝗼𝗹𝗱 Unicode letters).
const text = n => `${n.title || ''} ${n.summary || ''}`.normalize('NFKC');
const isPreview = n => n.contentType === 'Preview' || /\b(preview|next match|matchday|match day|build-?up|ahead of)\b/i.test(text(n));
const isReport = n => ['Match Report', 'Highlights', 'Reaction/Interview'].includes(n.contentType) || /\b(report|full[- ]?time|result|victory|win|wins|won|draw|defeat|beat|beats|lose|lost|points?)\b/i.test(text(n));
// Clearly marked as a preview / report: counts for the match it is published next to, even without the opponent's name.
const surePreview = n => n.contentType === 'Preview' || /\b(match )?preview\b/i.test(text(n));
const sureReport = n => n.contentType === 'Match Report' || /\bmatch report\b|\bfull[- ]?time\b/i.test(text(n));

async function newsIndex(env) {
  try { const r = await env.ASSETS.fetch(new URL('/data/news-index.json', SITE)); return r.ok ? await r.json() : []; } catch { return []; }
}
async function lobiMatches(db, now) {
  const { results } = await db.prepare(`SELECT id, home_team, away_team, event_date, venue FROM events WHERE active = 1 AND (home_team LIKE '%Lobi Stars%' OR away_team LIKE '%Lobi Stars%') AND event_date BETWEEN ? AND ? ORDER BY event_date`)
    .bind(new Date(now - 3 * DAY).toISOString(), new Date(now + 3 * DAY).toISOString()).all();
  return results;
}
/** The preview and report for each recent / coming match: [{ kind, matchId, title, due, done, from }]. */
export async function matchStoryStatus(env, now = Date.now()) {
  const [matches, news] = await Promise.all([lobiMatches(env.DB, now), newsIndex(env)]);
  const out = [];
  for (const m of matches) {
    const ko = Date.parse(m.event_date); if (!Number.isFinite(ko)) continue;
    const day = lagosDay(ko), name = `${m.home_team} vs ${m.away_team}`;
    // Stories linked to this match day (match date set, or published in the days around it).
    const opponent = String(/lobi stars/i.test(m.home_team) ? m.away_team : m.home_team).replace(/\s*F\.?C\.?$/i, '').split(' ')[0];
    const named = n => new RegExp(`\\b${opponent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(text(n));
    const at = n => Date.parse(n.publishedAt);
    const preview = news.some(n => (n.matchDate === day && isPreview(n)) || (n.publishedAt && at(n) < ko && ko - at(n) < 4 * DAY && ((named(n) && isPreview(n)) || surePreview(n))));
    const report = news.some(n => (n.matchDate === day && isReport(n) && (!n.publishedAt || at(n) > ko)) || (n.publishedAt && at(n) > ko && at(n) - ko < 3 * DAY && ((named(n) && isReport(n)) || sureReport(n))));
    if (ko > now) out.push({ kind: 'match_preview', matchId: m.id, title: `Match preview: ${name}`, due: new Date(ko - 2 * DAY).toISOString(), done: preview, ko });
    // Report: due by 12:00 Lagos time the day after the match.
    const next = new Date(Date.parse(`${day}T12:00:00+01:00`) + DAY).toISOString();
    if (ko <= now) out.push({ kind: 'match_report', matchId: m.id, title: `Match report: ${name}`, due: next, done: report, ko });
  }
  return out;
}
/** For the Media Centre home ("Upcoming deadlines"): only the ones not written yet. */
export async function matchStoryDeadlines(env, now = Date.now()) {
  return (await matchStoryStatus(env, now)).filter(x => !x.done).map(x => ({ kind: x.kind, title: x.title, due: x.due, state: 'not written yet' }));
}
/** Emails the media team once per match: a missing preview from 2 days before kick-off, a missing report from 3 hours after. */
export async function matchStoryReminders(env, now = Date.now()) {
  const db = env.DB;
  await ensureMediaSchema(db);
  const s = await mcSettings(db);
  const to = [s.media_team_email].filter(Boolean);
  const sent = [];
  for (const x of await matchStoryStatus(env, now)) {
    if (x.done) continue;
    const time = x.kind === 'match_preview' ? now >= x.ko - 2 * DAY : now >= x.ko + 3 * 3600e3;
    if (!time) continue;
    const key = `reminded_${x.kind}_${x.matchId}`;
    if (s[key]) continue;
    await setMcSetting(db, key, new Date(now).toISOString(), 'reminder');
    const body = x.kind === 'match_preview'
      ? `${x.title.replace('Match preview: ', '')} is coming up and there is no match preview on the website yet. Please write one in the Media Centre (Content type: Preview, Match date set), so fans and Google find it before kick-off.`
      : `${x.title.replace('Match report: ', '')} has been played and there is no match report on the website yet. Please write one in the Media Centre (Content type: Match Report, Match date set), by noon tomorrow if you can.`;
    let ok = false;
    if (env.RESEND_API_KEY && to.length) {
      try { await sendEmail(env, { to, subject: `Reminder: ${x.title}`, html: `<p style="font:16px/1.5 Arial,sans-serif">${body}</p><p style="font:14px Arial,sans-serif"><a href="${SITE}/media-centre/">Open the Media Centre</a></p>`, text: body }); ok = true; }
      catch (e) { console.error('[media centre] match story reminder', e); }
    }
    await mcLog(db, SYSTEM, 'reminder', { section: 'news', itemTitle: `Reminder: ${x.title}`, details: `${ok ? 'Emailed' : 'Email not set up; shown on the Media Centre home'}: ${to.join(', ') || 'nobody'}` });
    sent.push(x.title);
  }
  return sent;
}
