// Media Centre › Lobi Stars Weekly: the weekly newsletter template (15
// sections, in order). Media staff fill it in and submit by Tuesday 6 PM; a
// Super Admin approves; it publishes on Wednesday morning (or at once if
// approved later) through the site's existing newsletter system: the web
// version in the newsletter archive (/newsletter/<slug>/) and the email to
// every confirmed subscriber (marketing consent, not unsubscribed, weekly
// newsletter on), in batches with retries, a send log (deliveries), an
// unsubscribe link and a plain-text version.
//   1 Masthead (auto)      2 Welcome*           3 Last Match Report†   4 Match Analysis†
//   5 Player of the Match† 6 League Table*      7 Squad Update*        8 Next Match Preview*
//   9 Coming Fixtures (auto) 10 Spotlight       11 Club News           12 Fans' Corner
//   13 Partner Spotlight   14 Photo of the Week 15 Sign-off (auto)
//   * required   † required when a match was played ("No match this week" hides 3-5 and
//   offers "Training & Preparation" instead)
import { ensureNewsletterSchema, newId as nlId, renderNewsletter, NL_DEFAULTS, newsletterSettings, SITE } from './newsletter.js';
import { setPublic, fileIdsIn } from './mediaFiles.js';
import { oneLine, clean, mcSettings } from './mediaCentre.js';
import { nextWeekly, weekStart } from './mediaDeadlines.js';

const FILE_URL = /^\/api\/media-file\/[a-z0-9_]{4,40}$/;
const t = (v, n = 1500) => clean(v, n);
const pic = p => (p && FILE_URL.test(String(p.url || '')) ? { url: String(p.url), id: String(p.url).split('/').pop() } : null);
const LINK = /^(https:\/\/[^\s"'<>]{3,300}|\/[^\s"'<>]{0,200})$/;

export const SECTION_TITLES = {
  welcome: 'Welcome', lastMatch: 'Last match report', analysis: 'Match analysis', potm: 'Player of the Match', table: 'League table',
  squad: 'Squad update', nextMatch: 'Next match preview', fixtures: 'Coming fixtures', spotlight: 'Player & staff spotlight', clubNews: 'Club news',
  fans: "Fans' corner", partner: 'Partner spotlight', photo: 'Photo of the week', training: 'Training & preparation',
};

function normalise(d) {
  d = d || {};
  const o = x => (x && typeof x === 'object' ? x : {});
  const lm = o(d.lastMatch), an = o(d.analysis), pm = o(d.potm), tb = o(d.table), sq = o(d.squad), nm = o(d.nextMatch), sp = o(d.spotlight), pa = o(d.partner), ph = o(d.photo);
  return { value: {
    headline: oneLine(d.headline, 120),
    welcome: t(d.welcome, 1200),
    noMatch: !!d.noMatch,
    training: t(d.training, 1500),
    lastMatch: { date: oneLine(lm.date, 30), competition: oneLine(lm.competition, 80), opponent: oneLine(lm.opponent, 80), venue: oneLine(lm.venue, 80), score: oneLine(lm.score, 20),
      scorers: t(lm.scorers, 400), lineup: t(lm.lineup, 600), photo: pic(lm.photo), eventId: oneLine(lm.eventId, 80) },
    analysis: { well: t(an.well, 800), improve: t(an.improve, 800), turning: t(an.turning, 600), quote: t(an.quote, 600) },
    potm: { name: oneLine(pm.name, 80), photo: pic(pm.photo), reason: t(pm.reason, 600) },
    table: { position: oneLine(tb.position, 10), points: oneLine(tb.points, 10), top: t(tb.top, 300) },
    squad: { injuries: t(sq.injuries, 600), returns: t(sq.returns, 600), suspensions: t(sq.suspensions, 600) },
    nextMatch: { opponent: oneLine(nm.opponent, 80), date: oneLine(nm.date, 40), kickoff: oneLine(nm.kickoff, 20), venue: oneLine(nm.venue, 80), form: t(nm.form, 300), expect: t(nm.expect, 800),
      ticketLink: LINK.test(String(nm.ticketLink || '').trim()) ? String(nm.ticketLink).trim() : '/tickets/', isHome: !!nm.isHome },
    spotlight: { name: oneLine(sp.name, 80), text: t(sp.text, 1200), photo: pic(sp.photo) },
    clubNews: t(d.clubNews, 1500), fans: t(d.fans, 1200),
    partner: { name: oneLine(pa.name, 80), logo: pic(pa.logo), text: t(pa.text, 600), link: LINK.test(String(pa.link || '').trim()) ? String(pa.link).trim() : '' },
    photo: { photo: pic(ph.photo), caption: oneLine(ph.caption, 200), credit: oneLine(ph.credit, 100) },
  } };
}
/** What is still missing before it can be submitted (the first problem, or null). */
export function missing(v) {
  if (v.welcome.length < 20) return '2 Welcome: write the welcome (a few sentences).';
  if (!v.noMatch) {
    const lm = v.lastMatch;
    if (!lm.opponent || !lm.score || !lm.date) return '3 Last Match Report: the date, opponent and final score are needed (or tick "No match this week").';
    if (!lm.venue || !lm.competition) return '3 Last Match Report: add the competition / matchday and the venue.';
    if (!lm.lineup) return '3 Last Match Report: add the line-up.';
    if (!lm.photo) return '3 Last Match Report: add the key photo.';
    const a = v.analysis;
    if (!a.well || !a.improve || !a.turning || !a.quote) return '4 Match Analysis: fill in what went well, areas to improve, the turning point and the coach\'s quote.';
    if (!v.potm.name || !v.potm.reason || !v.potm.photo) return '5 Player of the Match: name, photo and the reason.';
  }
  if (!v.table.position || !v.table.points || !v.table.top) return '6 League Table: Lobi Stars\' position, points and who is top of the conference.';
  if (!v.squad.injuries && !v.squad.returns && !v.squad.suspensions) return '7 Squad Update: write the injuries, returns and suspensions (write "None" where there are none).';
  const n = v.nextMatch;
  if (!n.opponent || !n.date || !n.kickoff || !n.venue || !n.form || !n.expect) return '8 Next Match Preview: opponent, date, kick-off, venue, the opponent\'s form and what to expect.';
  return null;
}
function validate(v) { return missing(v); }

/** The edition number: Lobi Stars Weekly issues already published + 1. */
async function editionNo(db, r) {
  try {
    const n = (await db.prepare(`SELECT COUNT(*) AS n FROM mc_items WHERE kind = 'newsletter' AND published_at IS NOT NULL AND id <> ?`).bind(r?.id || '').first())?.n || 0;
    return n + 1;
  } catch { return 1; }
}
async function comingFixtures(db) {
  try {
    const { results } = await db.prepare(`SELECT home_team, away_team, event_date, venue FROM events WHERE active = 1 AND event_date > ? ORDER BY event_date LIMIT 12`).bind(new Date().toISOString()).all();
    return results.filter(e => /lobi stars/i.test(`${e.home_team} ${e.away_team}`)).slice(0, 3);
  } catch { return []; }
}
const lagosDate = iso => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const lagosTime = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
const lines = (...xs) => xs.filter(Boolean).join('\n');

/** The Lobi Stars Weekly as an issue of the site's newsletter (template, sending, archive). */
export async function issueFrom(db, v, { edition, date = new Date().toISOString() }) {
  const S = [];
  const add = (key, text, image = null, url = '') => { if (text || image) S.push({ title: SECTION_TITLES[key], text: String(text || '').slice(0, 4000), image: image?.url || null, url }); };
  if (!v.noMatch) {
    const lm = v.lastMatch;
    add('lastMatch', lines(`${lm.date} · ${lm.competition}`, `Lobi Stars ${lm.score} ${lm.opponent} (${lm.venue})`, lm.scorers ? `Scorers: ${lm.scorers}` : '', lm.lineup ? `Line-up: ${lm.lineup}` : ''), lm.photo);
    const a = v.analysis;
    add('analysis', lines(a.well ? `What went well: ${a.well}` : '', a.improve ? `Areas to improve: ${a.improve}` : '', a.turning ? `Turning point: ${a.turning}` : '', a.quote ? `The coach: “${a.quote}”` : ''));
    add('potm', lines(v.potm.name, v.potm.reason), v.potm.photo);
  } else add('training', v.training);
  add('table', lines(`Lobi Stars: ${v.table.position}${/^\d+$/.test(v.table.position) ? ordinal(v.table.position) : ''} with ${v.table.points} points`, v.table.top ? `Top of the conference: ${v.table.top}` : ''));
  add('squad', lines(v.squad.injuries ? `Injuries: ${v.squad.injuries}` : '', v.squad.returns ? `Returns: ${v.squad.returns}` : '', v.squad.suspensions ? `Suspensions: ${v.squad.suspensions}` : ''));
  const n = v.nextMatch;
  add('nextMatch', lines(`Lobi Stars v ${n.opponent}`, `${n.date} · kick-off ${n.kickoff} · ${n.venue}`, n.form ? `Their form: ${n.form}` : '', n.expect), null, n.ticketLink || '/tickets/');
  const fx = await comingFixtures(db);
  if (fx.length) add('fixtures', fx.map(e => `${lagosDate(e.event_date)} ${lagosTime(e.event_date)}: ${e.home_team} v ${e.away_team}${e.venue ? ` (${e.venue})` : ''}`).join('\n'), null, '/fixtures/');
  if (v.spotlight.name || v.spotlight.text) add('spotlight', lines(v.spotlight.name, v.spotlight.text), v.spotlight.photo);
  add('clubNews', v.clubNews, null, '/news/');
  add('fans', v.fans);
  if (v.partner.name) add('partner', lines(v.partner.name, v.partner.text), v.partner.logo, v.partner.link);
  if (v.photo.photo) add('photo', lines(v.photo.caption, v.photo.credit ? `Photo: ${v.photo.credit}` : ''), v.photo.photo);
  // 15 Sign-off: tickets, socials and #WeAreLobi (the template adds the social links and unsubscribe).
  S.push({ title: '#WeAreLobi', text: 'Thank you for reading. Get your tickets for the next home match, follow the club on social media and share this newsletter with a fellow fan.', image: null, url: '/tickets/' });
  const dayLabel = new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });
  return {
    subject: `Lobi Stars Weekly #${edition}${v.headline ? `: ${v.headline}` : ''}`.slice(0, 150),
    preheader: (v.headline || v.welcome).slice(0, 140),
    headline: `Lobi Stars Weekly · Edition ${edition} · ${dayLabel}`,
    intro: v.welcome,
    hero_image: null, hero_button_text: null, hero_button_url: null,
    include_match: false, stories: S, sponsor_ids: [], top_sponsor_id: null, audience: null,
  };
}
function ordinal(n) { const x = Number(n) % 100; return x >= 11 && x <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][Number(n) % 10] || 'th'; }

/** Email (or web) version for the preview. */
export async function previewHtmlFor(env, v, { web = false, r = null } = {}) {
  await ensureNewsletterSchema(env.DB);
  const edition = await editionNo(env.DB, r);
  const issue = await issueFrom(env.DB, v, { edition });
  return renderNewsletter({ issue: { ...issue, id: 'preview', status: 'draft' }, sponsors: [], match: null, recipient: { firstName: 'Ada' }, preview: true, web, base: SITE, settings: { ...NL_DEFAULTS, ...(await newsletterSettings(env.DB)), title: 'Lobi Stars Weekly' } });
}
function previewHtml(v) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const row = (k, val) => val ? `<p style="margin:0 0 8px"><b>${esc(k)}:</b> ${esc(val).replace(/\n/g, '<br>')}</p>` : '';
  return `<h2 style="margin:0 0 8px">Lobi Stars Weekly${v.headline ? `: ${esc(v.headline)}` : ''}</h2>${row('Welcome', v.welcome)}${v.noMatch ? row('No match this week · Training', v.training) : `${row('Last match', `${v.lastMatch.date} ${v.lastMatch.competition}: Lobi Stars ${v.lastMatch.score} ${v.lastMatch.opponent} (${v.lastMatch.venue})\nScorers: ${v.lastMatch.scorers}\nLine-up: ${v.lastMatch.lineup}`)}${row('Analysis', `${v.analysis.well}\n${v.analysis.improve}\n${v.analysis.turning}\n“${v.analysis.quote}”`)}${row('Player of the Match', `${v.potm.name}: ${v.potm.reason}`)}`}
    ${row('Table', `${v.table.position}, ${v.table.points} pts · top: ${v.table.top}`)}${row('Squad', `${v.squad.injuries}\n${v.squad.returns}\n${v.squad.suspensions}`)}${row('Next match', `v ${v.nextMatch.opponent}, ${v.nextMatch.date} ${v.nextMatch.kickoff}, ${v.nextMatch.venue}\n${v.nextMatch.form}\n${v.nextMatch.expect}`)}
    ${row('Spotlight', v.spotlight.name && `${v.spotlight.name}: ${v.spotlight.text}`)}${row('Club news', v.clubNews)}${row("Fans' corner", v.fans)}${row('Partner', v.partner.name && `${v.partner.name}: ${v.partner.text}`)}${row('Photo of the week', v.photo.caption)}
    <p style="font-size:13px;color:#4A505C">Open "Preview the email" in the Media Centre for the full design.</p>`;
}

/** Approved: publish on the Wednesday of its week at the set time, or now if that time has passed. */
async function scheduleFor(env, r) {
  const s = await mcSettings(env.DB);
  const target = nextWeekly(s.newsletter_publish, Date.parse(weekStart(Date.parse(r.created_at))) - 1);
  return Date.parse(target) > Date.now() + 60e3 ? target : null;
}
async function publish(env, r, v) {
  const db = env.DB;
  await ensureNewsletterSchema(db);
  const edition = await editionNo(db, r);
  const issue = await issueFrom(db, v, { edition });
  await setPublic(db, fileIdsIn(v), true); // pictures must open in email programs
  const id = nlId('nl'), at = new Date().toISOString();
  await db.prepare(`INSERT INTO newsletter_issues (id, subject, preheader, headline, intro, hero_image, hero_button_text, hero_button_url, include_match, stories, sponsor_ids, top_sponsor_id, status, created_at, created_by, updated_at, updated_by, scheduled_at, scheduled_by, audience)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, '[]', NULL, 'scheduled', ?, 'Media Centre', ?, 'Media Centre', ?, ?, NULL)`)
    .bind(id, issue.subject, issue.preheader, issue.headline, issue.intro, JSON.stringify(issue.stories), at, at, at, `Media Centre (approved by ${r.decided_by || 'a Super Admin'})`).run();
  await db.prepare(`UPDATE mc_items SET ref = ? WHERE id = ?`).bind(id, r.id).run();
  return { ok: true, note: `Lobi Stars Weekly #${edition} is being sent to the subscribers (in batches) and goes into the newsletter archive.` };
}
async function unpublish(env, r) {
  if (!r.ref) return { ok: true };
  const row = await env.DB.prepare(`SELECT status FROM newsletter_issues WHERE id = ?`).bind(r.ref).first();
  if (row?.status === 'sending') return { error: 'It is being sent right now; try again in a few minutes.' };
  // Emails already sent cannot be called back; this removes it from the archive (or stops it if not sent yet).
  await env.DB.prepare(`UPDATE newsletter_issues SET status = CASE WHEN status = 'sent' THEN 'withdrawn' ELSE 'draft' END WHERE id = ?`).bind(r.ref).run();
  return { ok: true };
}

export const NEWSLETTER = {
  label: 'Lobi Stars Weekly', section: 'newsletter', schedulable: true, scheduleFor, noCorrections: true,
  normalise, validate, previewHtml, publish, unpublish,
  titleOf: v => `Lobi Stars Weekly${v.headline ? `: ${v.headline}` : ''}`,
  adminFields: [
    { key: 'headline', label: 'Headline (in the subject line)', type: 'text' }, { key: 'welcome', label: 'Welcome', type: 'textarea' },
    { key: 'lastMatch', label: 'Last match', type: 'json' }, { key: 'analysis', label: 'Match analysis', type: 'json' }, { key: 'potm', label: 'Player of the Match', type: 'json' },
    { key: 'table', label: 'League table', type: 'json' }, { key: 'squad', label: 'Squad update', type: 'json' }, { key: 'nextMatch', label: 'Next match', type: 'json' },
    { key: 'clubNews', label: 'Club news', type: 'textarea' }, { key: 'fans', label: "Fans' corner", type: 'textarea' },
  ],
};
