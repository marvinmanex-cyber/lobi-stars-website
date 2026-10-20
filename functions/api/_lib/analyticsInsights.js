// Analytics intelligence, Phase 4: plain-English findings and recommendations,
// worked out in code from the figures the website already has (Google Search
// Console and GA4, copied by the daily sync, plus the website's own counting).
// Shown in Admin › Analytics › Recommendations, each with a step-by-step guide.
//
// Always over the last 28 days compared with the 28 days before. Search Console
// and GA4 windows end on the latest day Google has delivered (search figures
// arrive 2-3 days late), so a late day never looks like a drop.
//
// Optional: a short weekly summary written by Claude (Anthropic API). OFF unless
// AI_SUMMARY=on and ANTHROPIC_API_KEY are set; it is sent only totals (no names,
// emails, phones or orders). See handover A28.
import { ensureAnalyticsSyncSchema } from './analyticsSync.js';
import { ensureAnalyticsSchema } from './analytics.js';
import { classifySource } from '../admin/analytics.js';

const DAY = 864e5, WAT = 3600e3, WINDOW = 28;
const SITE = 'https://lobistarsfc.com';
const SC = 'sc-domain:lobistarsfc.com';
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const today = () => new Date(Date.now() + WAT).toISOString().slice(0, 10);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const change = (now, prev) => (prev ? Math.round(((now - prev) / prev) * 100) : null);
const fmt = n => Number(n || 0).toLocaleString('en-NG');
const pathOf = u => (String(u || '').replace(/^https?:\/\/(www\.)?lobistarsfc\.com/i, '') || '/').split(/[?#]/)[0] || '/';
const PAGE_NAMES = { '/': 'Home page', '/tickets/': 'Tickets', '/kitchen/': 'MatchDay Kitchen', '/fixtures/': 'Fixtures', '/results/': 'Results', '/table/': 'League table',
  '/news/': 'News', '/squad/': 'Squad', '/membership/': 'Membership', '/watch/': 'Watch live', '/shop/': 'Shop', '/contact/': 'Contact', '/newsletter/': 'Newsletter' };
const pageName = p => PAGE_NAMES[p] || p;
// A suggested Google title for the main pages (what fans search for first, then the club name).
const TITLE_IDEAS = {
  '/': 'Lobi Stars FC Official Website: Fixtures, Tickets, News',
  '/tickets/': 'Buy Lobi Stars Tickets Online: Home Matches | Lobi Stars FC',
  '/fixtures/': 'Lobi Stars Fixtures and Kick-off Times | Lobi Stars FC',
  '/results/': 'Lobi Stars Results and Match Reports | Lobi Stars FC',
  '/table/': 'NPFL Table: Where Lobi Stars Stand | Lobi Stars FC',
  '/kitchen/': 'MatchDay Kitchen: Order Food to Your Seat | Lobi Stars FC',
  '/squad/': 'Lobi Stars Squad: Players and Staff | Lobi Stars FC',
  '/news/': 'Lobi Stars News: Team News and Transfers | Lobi Stars FC',
  '/membership/': 'Join Lobi Stars FC Membership: Benefits and Prices',
  '/watch/': 'Watch Lobi Stars Live | Lobi Stars FC',
};
const inspectUrl = path => `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(SC)}&id=${encodeURIComponent(SITE + path)}`;
const PRIORITY = { high: 0, medium: 1, low: 2 };

/** Every figure the rules need (totals only). */
async function gather(db) {
  await Promise.all([ensureAnalyticsSyncSchema(db), ensureAnalyticsSchema(db)]);
  const one = async (sql, b = []) => (await db.prepare(sql).bind(...b).first()) || {};
  const all = async (sql, b = []) => (await db.prepare(sql).bind(...b).all()).results;
  const latest = await one(`SELECT (SELECT MAX(date) FROM gsc_daily WHERE dim = 'total') AS gsc, (SELECT MAX(date) FROM ga4_daily) AS ga4, (SELECT MAX(date) FROM ga4_events_daily) AS ev`);
  const win = end => { const e = end || today(); const s = addDays(e, -(WINDOW - 1)); return { now: [s, e], prev: [addDays(s, -WINDOW), addDays(s, -1)] }; };
  const G = win(latest.gsc), A = win(latest.ga4 || latest.ev), O = win(today());

  const gTot = `SELECT COALESCE(SUM(clicks),0) AS clicks, COALESCE(SUM(impressions),0) AS impressions, SUM(position * impressions) / MAX(SUM(impressions), 1) AS position FROM gsc_daily WHERE dim = 'total' AND date >= ? AND date <= ?`;
  const gDim = (dim, limit) => all(`SELECT value, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) / MAX(SUM(impressions), 1) AS position
    FROM gsc_daily WHERE dim = ? AND date >= ? AND date <= ? GROUP BY value ORDER BY impressions DESC LIMIT ${limit}`, [dim, ...G.now]);
  const aTot = `SELECT COALESCE(SUM(sessions),0) AS sessions, SUM(engagement_rate * sessions) / MAX(SUM(sessions), 1) AS engagement FROM ga4_daily WHERE date >= ? AND date <= ?`;
  const ev = range => all(`SELECT event_name AS name, SUM(event_count) AS n FROM ga4_events_daily WHERE date >= ? AND date <= ? GROUP BY event_name`, range);
  const oTot = `SELECT COUNT(*) AS views FROM pageviews WHERE ts >= ? AND ts < ?`;
  const ts = d => d + ' 00:00:00';
  const oRange = r => [ts(r[0]), ts(addDays(r[1], 1))];

  const [gNow, gPrev, gPages, gQueries, gCountries, gDevices, aNow, aPrev, aChannels, aPages, aDevices, evNow, evPrev, oNow, oPrev, oPages, oDevices, oSources, ownEv] = await Promise.all([
    one(gTot, G.now), one(gTot, G.prev), gDim('page', 200), gDim('query', 200), gDim('country', 20), gDim('device', 5),
    one(aTot, A.now), one(aTot, A.prev),
    all(`SELECT channel, SUM(sessions) AS sessions FROM ga4_daily WHERE date >= ? AND date <= ? GROUP BY channel ORDER BY sessions DESC`, A.now),
    all(`SELECT page_path AS path, SUM(sessions) AS sessions, SUM(engagement_rate * sessions) / MAX(SUM(sessions), 1) AS engagement FROM ga4_daily WHERE date >= ? AND date <= ? GROUP BY page_path ORDER BY sessions DESC LIMIT 100`, A.now),
    all(`SELECT device, SUM(sessions) AS sessions, SUM(engagement_rate * sessions) / MAX(SUM(sessions), 1) AS engagement FROM ga4_daily WHERE date >= ? AND date <= ? GROUP BY device`, A.now),
    ev(A.now), ev(A.prev),
    one(oTot, oRange(O.now)), one(oTot, oRange(O.prev)),
    all(`SELECT path, COUNT(*) AS views FROM pageviews WHERE ts >= ? AND ts < ? GROUP BY path ORDER BY views DESC LIMIT 30`, oRange(O.now)),
    all(`SELECT COALESCE(device, 'unknown') AS device, COUNT(*) AS views FROM pageviews WHERE ts >= ? AND ts < ? GROUP BY device`, oRange(O.now)),
    all(`SELECT LOWER(COALESCE(NULLIF(utm_source, ''), NULLIF(referrer_host, ''), '')) AS src, COUNT(*) AS views FROM pageviews WHERE ts >= ? AND ts < ? GROUP BY src`, oRange(O.now)),
    all(`SELECT name, COUNT(*) AS n FROM track_events WHERE ts >= ? AND ts < ? GROUP BY name`, oRange(O.now)),
  ]);
  const sources = {};
  for (const r of oSources) { const k = classifySource(r.src); sources[k] = (sources[k] || 0) + r.views; }
  const evm = rows => Object.fromEntries(rows.map(r => [r.name, r.n || 0]));
  return {
    windows: { gsc: G, ga4: A, own: O }, latest,
    gsc: { now: gNow, prev: gPrev, pages: gPages.map(p => ({ ...p, path: pathOf(p.value) })), queries: gQueries, countries: gCountries, devices: gDevices },
    ga4: { now: aNow, prev: aPrev, channels: aChannels, pages: aPages, devices: aDevices, events: evm(evNow), eventsPrev: evm(evPrev) },
    own: { now: oNow.views || 0, prev: oPrev.views || 0, pages: oPages, devices: oDevices, sources, events: evm(ownEv) },
  };
}

/** The rules: each one looks at the figures and may add findings and recommendations. */
function analyse(f) {
  const recs = [], glance = [];
  const add = r => recs.push(r);
  const { gsc, ga4, own } = f;
  const hasGsc = !!f.latest.gsc, hasGa4 = !!(f.latest.ga4 || f.latest.ev);

  // ── At a glance ──
  if (hasGsc) {
    const c = change(gsc.now.clicks, gsc.prev.clicks);
    glance.push(`Google search: ${fmt(gsc.now.clicks)} clicks from ${fmt(gsc.now.impressions)} appearances (click rate ${pct(gsc.now.clicks, gsc.now.impressions)}%, average position ${Math.round(gsc.now.position * 10) / 10})${c === null ? '' : `, clicks ${c >= 0 ? 'up' : 'down'} ${Math.abs(c)}% on the 28 days before`}.`);
    const top = [...gsc.queries].sort((a, b) => b.clicks - a.clicks)[0];
    if (top) glance.push(`Most-searched way people find the club: "${top.value}" (${fmt(top.impressions)} appearances, ${fmt(top.clicks)} clicks).`);
    const abroad = gsc.countries.filter(c => c.value !== 'nga').reduce((s, c) => s + c.impressions, 0);
    const allCountries = gsc.countries.reduce((s, c) => s + c.impressions, 0);
    if (allCountries) glance.push(`${pct(abroad, allCountries)}% of Google appearances were outside Nigeria.`);
  }
  if (hasGa4 && ga4.now.sessions) {
    const c = change(ga4.now.sessions, ga4.prev.sessions);
    const ch = ga4.channels[0];
    glance.push(`GA4: ${fmt(ga4.now.sessions)} sessions (visitors who accepted cookies), engagement ${Math.round(ga4.now.engagement * 100)}%${c === null ? '' : `, ${c >= 0 ? 'up' : 'down'} ${Math.abs(c)}%`}${ch ? `. Most came from ${ch.channel} (${pct(ch.sessions, ga4.now.sessions)}%)` : ''}.`);
  }
  if (own.now) {
    const c = change(own.now, own.prev);
    const phones = own.devices.filter(d => d.device === 'mobile').reduce((s, d) => s + d.views, 0);
    glance.push(`The website's own counting: ${fmt(own.now)} page views${c === null ? '' : ` (${c >= 0 ? 'up' : 'down'} ${Math.abs(c)}%)`}; ${pct(phones, own.now)}% on phones.`);
  }
  const E = { ...own.events, ...ga4.events };
  const started = ga4.events.ticket_purchase_start || 0, bought = ga4.events.ticket_purchase_complete || 0;
  if (started) glance.push(`Tickets: ${fmt(started)} checkouts started, ${fmt(bought)} completed${bought <= started ? ` (${pct(bought, started)}%)` : ''}.`);

  // ── Setup and data health ──
  if (!hasGsc) add({ id: 'setup:gsc', priority: 'high', area: 'Setup', title: 'Google search figures are not coming in',
    finding: 'There are no Search Console figures yet, so the search advice below cannot be worked out.',
    steps: ['Open Admin › Analytics and look at the Google & Search section for a red note.', 'If it says "Not connected", follow handover item A27 (service account, access in Search Console).', 'Press Sync now and wait for "Sync finished".'],
    link: { href: '#sec-google', label: 'Google & Search' } });
  if (hasGsc && f.latest.gsc < addDays(today(), -6)) add({ id: 'setup:stale', priority: 'high', area: 'Setup', title: 'The daily Google sync has stopped',
    finding: `The newest search figures are from ${f.latest.gsc}. Normally they are 2-3 days old.`,
    steps: ['Scroll to Google & Search and read the note next to Sync now.', 'Press Sync now. If a red note mentions 403 or "sign-in", the robot account lost access: re-add website-sync@lobi-stars-analytics.iam.gserviceaccount.com in Search Console (Settings › Users and permissions, Restricted) and GA4 (Property access management, Viewer).', 'If it still fails, send the red note to your web developer.'],
    link: { href: '#sec-google', label: 'Google & Search' } });

  // ── Search: pages Google shows but people don't click ──
  for (const p of gsc.pages) {
    const ctr = p.impressions ? p.clicks / p.impressions : 0;
    if (p.impressions >= 60 && ctr < 0.03 && p.position <= 15) add({ id: `ctr:${p.path}`, priority: p.impressions >= 300 ? 'high' : 'medium', area: 'Google search', score: p.impressions,
      title: `Make more people click "${pageName(p.path)}" in Google`,
      finding: `Google showed ${p.path} ${fmt(p.impressions)} times in the last 28 days (average position ${Math.round(p.position * 10) / 10}), but only ${fmt(p.clicks)} people clicked (${pct(p.clicks, p.impressions)}%). The page is being seen; its title and description are not convincing people.`,
      steps: [
        `Search Google for the phrases people use (see "Top search phrases" in Google & Search) and look at how ${p.path} appears.`,
        `Write a new page title of at most 60 characters: start with what the fan is looking for and include "Lobi Stars". ${TITLE_IDEAS[p.path] ? `Suggestion: "${TITLE_IDEAS[p.path]}"` : 'For example: "Lobi Stars Tickets: Buy Home Match Tickets Online"'}.`,
        'Write a description of at most 155 characters with a reason to click: a price, a date, "official", "pay online, QR ticket by email".',
        'Send both to your web developer, or ask Claude in VS Code: "change the title and description of ' + p.path + ' to …", then deploy.',
        `After the change, open Search Console › URL inspection for ${SITE + p.path} and press "Request indexing".`,
        'Check this box again in 2-3 weeks: the click rate should rise.',
      ], link: { href: inspectUrl(p.path), label: 'Inspect in Search Console', external: true } });
  }

  // ── Search: phrases just below the top of Google ──
  const close = gsc.queries.filter(q => q.impressions >= 20 && q.position > 3.5 && q.position <= 20).sort((a, b) => b.impressions - a.impressions).slice(0, 3);
  for (const q of close) add({ id: `rank:${q.value}`, priority: q.position <= 10 ? 'medium' : 'low', area: 'Google search', score: q.impressions,
    title: `Climb higher in Google for "${q.value}"`,
    finding: `"${q.value}" brought ${fmt(q.impressions)} appearances, but the club sits at position ${Math.round(q.position * 10) / 10} on average${q.position > 10 ? ' (page 2, where few people look)' : ''}. Moving into the top 3 usually multiplies clicks.`,
    steps: [
      `Google "${q.value}" yourself and note which club page appears and what ranks above it.`,
      `Publish a news article that uses the exact words "${q.value}" in its headline and first paragraph (Admin › News), and link to the best page for it (for example Tickets or Fixtures).`,
      'Make sure that page also uses the phrase in its heading or first lines (ask your web developer if it needs a code change).',
      'Share the article on the WhatsApp Channel, Facebook and Instagram (Admin › Share Hub): visits from social media help Google notice it.',
      'Check the phrase\'s position here again in 3-4 weeks.',
    ], link: { href: '/admin/news', label: 'Write a news article' } });

  // ── Search: busy pages Google barely shows ──
  const gPaths = new Map(gsc.pages.map(p => [p.path, p]));
  if (hasGsc) for (const p of own.pages.slice(0, 15)) {
    if (p.views < 40 || /^\/(admin|api|scan|helper|payment|unsubscribe|fans\/account)/.test(p.path)) continue;
    const g = gPaths.get(p.path);
    if (!g || g.impressions < 5) { add({ id: `index:${p.path}`, priority: 'medium', area: 'Google search', score: p.views,
      title: `Get "${pageName(p.path)}" showing in Google`,
      finding: `${p.path} had ${fmt(p.views)} page views on the website but ${g ? fmt(g.impressions) : 'no'} appearances in Google search. People who search for it may not be finding it.`,
      steps: [
        `Open Search Console › URL inspection and paste ${SITE + p.path}.`,
        'If it says "URL is not on Google", press "Request indexing".',
        'If it says the page is excluded (for example "noindex" or "duplicate"), send the message to your web developer.',
        'Link to the page from a news article or the home page so Google finds it more easily.',
      ], link: { href: inspectUrl(p.path), label: 'Inspect in Search Console', external: true } }); }
  }

  // ── Search: trend ──
  const cc = change(gsc.now.clicks, gsc.prev.clicks);
  if (hasGsc && cc !== null && gsc.prev.clicks >= 20 && cc <= -25) add({ id: 'trend:gsc-down', priority: 'high', area: 'Google search', title: 'Google search clicks dropped',
    finding: `${fmt(gsc.now.clicks)} clicks in the last 28 days against ${fmt(gsc.prev.clicks)} before (${cc}%).`,
    steps: ['In Google & Search, compare the Pages table with the previous period (use the Custom dates) to see which page lost clicks.', 'Open Search Console › Pages to check whether pages dropped out of Google ("Why pages aren\'t indexed").', 'Check Admin › Website Health for broken pages.', 'If one page lost its position, refresh it: update the text, add the current season and date, then Request indexing.'],
    link: { href: 'https://search.google.com/search-console/index?resource_id=' + encodeURIComponent(SC), label: 'Search Console › Pages', external: true } });

  // ── Phones ──
  const mob = ga4.devices.find(d => d.device === 'mobile'), desk = ga4.devices.find(d => d.device === 'desktop');
  if (mob && desk && mob.sessions >= 50 && desk.sessions >= 20 && mob.engagement < desk.engagement - 0.12) add({ id: 'ux:mobile', priority: 'high', area: 'Phones', score: mob.sessions,
    title: 'Phone visitors leave sooner than computer visitors',
    finding: `Engagement on phones is ${Math.round(mob.engagement * 100)}% against ${Math.round(desk.engagement * 100)}% on computers, and phones bring ${fmt(mob.sessions)} sessions. Something on phones is getting in the way.`,
    steps: ['Open the website on an ordinary Android phone using mobile data (not Wi-Fi).', 'Go through the main journeys: buy a ticket, order food, read a news article, open fixtures.', 'Note anything slow, cut off, too small to tap or hidden behind the cookie banner or a pop-up.', 'Send the list with screenshots to your web developer.'],
    link: { href: '/admin/health', label: 'Website Health' } });

  // ── Pages people leave quickly ──
  const weak = ga4.pages.filter(p => p.sessions >= 40 && p.engagement < 0.4).slice(0, 2);
  for (const p of weak) add({ id: `eng:${p.path}`, priority: 'medium', area: 'Content', score: p.sessions,
    title: `Visitors leave "${pageName(p.path)}" quickly`,
    finding: `${p.path} had ${fmt(p.sessions)} GA4 sessions but only ${Math.round(p.engagement * 100)}% were engaged (stayed 10+ seconds, clicked or viewed another page).`,
    steps: [`Open ${SITE + p.path} on a phone and ask: does the first screen answer what the visitor came for?`, 'Put the most wanted thing (next match, price, button) at the top.', 'Add clear next steps: "Buy tickets", "See fixtures", "Order food".', 'Check that images load quickly and nothing jumps around while loading.'],
    link: { href: SITE + p.path, label: 'Open the page', external: true } });

  // ── Checkouts ──
  const funnel = (startKey, doneKey, area, what, link) => {
    const s = ga4.events[startKey] || 0, d = ga4.events[doneKey] || 0;
    if (s >= 10 && d / s < 0.5) add({ id: `funnel:${startKey}`, priority: 'high', area, score: s,
      title: `Many ${what} are started but not finished`,
      finding: `${fmt(s)} started, ${fmt(d)} finished (${pct(d, s)}%) in the last 28 days.`,
      steps: [`Go through the ${what.replace(/s$/, '')} yourself on a phone, up to the payment page (use a small real payment, or stop at Paystack).`, 'Note every place you had to think, wait or retype something.', 'Check Paystack (dashboard.paystack.com › Transactions) for failed or abandoned payments and their reasons.', 'Make sure prices, fees and what happens next are clear before the Pay button.', 'Send what you found to your web developer.'],
      link });
  };
  funnel('ticket_purchase_start', 'ticket_purchase_complete', 'Tickets', 'ticket checkouts', { href: '/admin/tickets', label: 'Tickets admin' });
  funnel('kitchen_order_start', 'kitchen_order_complete', 'MatchDay Kitchen', 'food orders', { href: '/admin/food-orders', label: 'Food orders' });

  // ── Growth: newsletter, WhatsApp Channel, social ──
  const visits = ga4.now.sessions || own.now;
  const signups = E.newsletter_signup || 0;
  if (visits >= 300 && signups / visits < 0.005) add({ id: 'grow:newsletter', priority: 'medium', area: 'Fans', score: visits,
    title: 'Turn more visitors into newsletter subscribers',
    finding: `${fmt(visits)} visits but ${fmt(signups)} newsletter sign-ups in the last 28 days.`,
    steps: ['Mention the newsletter at the end of every news article ("Get team news first: join the newsletter").', 'Post the newsletter link on the WhatsApp Channel and social media once a week.', 'Offer a reason to join: early ticket news, exclusive photos, a monthly prize draw (Rewards).', 'Check Admin › Newsletter that the weekly send is set up.'],
    link: { href: '/admin/newsletter', label: 'Newsletter' } });
  const social = (own.sources.Facebook || 0) + (own.sources.Instagram || 0) + (own.sources.X || 0) + (own.sources.WhatsApp || 0);
  if (own.now >= 300 && social / own.now < 0.1) add({ id: 'grow:social', priority: 'medium', area: 'Social media', score: own.now,
    title: 'Bring more visitors from WhatsApp and social media',
    finding: `Only ${pct(social, own.now)}% of page views came from WhatsApp, Facebook, Instagram or X (${fmt(social)} of ${fmt(own.now)}).`,
    steps: ['Every post about a match, ticket sale or news story should include the link to that page on lobistarsfc.com.', 'Use Admin › Share Hub to post the Match Day Programme and news with the right links.', 'Pin the tickets link in the WhatsApp Channel before each home game.', 'Compare this figure again in 4 weeks.'],
    link: { href: '/admin/share', label: 'Share Hub' } });

  // ── Supporters abroad ──
  const abroad = gsc.countries.filter(c => c.value !== 'nga');
  const abroadImp = abroad.reduce((s, c) => s + c.impressions, 0), countryImp = gsc.countries.reduce((s, c) => s + c.impressions, 0);
  if (hasGsc && countryImp >= 200 && abroadImp / countryImp >= 0.2) add({ id: 'grow:diaspora', priority: 'low', area: 'Fans', score: abroadImp,
    title: 'Reach supporters abroad',
    finding: `${pct(abroadImp, countryImp)}% of Google appearances came from outside Nigeria (mostly ${abroad.slice(0, 2).map(c => c.value.toUpperCase()).join(' and ')}).`,
    steps: ['Promote "Watch live" and the live commentary before each match, with kick-off times in Nigerian time.', 'Mention online membership and the shop (they can be paid from abroad).', 'Ask supporters abroad to share the WhatsApp Channel with friends.'],
    link: { href: '/admin/fan-alerts', label: 'Fan alerts' } });

  // ── Good news (shown as findings, no action needed) ──
  if (cc !== null && gsc.prev.clicks >= 10 && cc >= 25) glance.push(`Good news: Google search clicks rose ${cc}% on the 28 days before. Keep publishing news with clear headlines.`);

  recs.sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || (b.score || 0) - (a.score || 0));
  const CAP = { ctr: 3, rank: 3, index: 2, eng: 2 }, seen = {};
  const varied = recs.filter(r => { const k = r.id.split(':')[0]; seen[k] = (seen[k] || 0) + 1; return seen[k] <= (CAP[k] || 1); });
  return { glance, recs: varied.slice(0, 10) };
}

/** Recommendations for the Analytics page (marked-done ones hidden for 30 days). */
export async function recommendations(env) {
  const db = env.DB;
  const f = await gather(db);
  const out = analyse(f);
  const done = await doneMap(db);
  const cutoff = Date.now() - 30 * DAY;
  const active = [], hidden = [];
  for (const r of out.recs) (done[r.id] && Date.parse(done[r.id].at) > cutoff ? hidden : active).push(done[r.id] ? { ...r, done: done[r.id] } : r);
  const ai = await getKey(db, 'ai_summary');
  return { windows: f.windows, latest: f.latest, glance: out.glance, recs: active, done: hidden, ai: { enabled: aiEnabled(env), summary: ai } };
}

const getKey = async (db, key) => { const r = await db.prepare(`SELECT value FROM analytics_sync WHERE key = ?`).bind(key).first(); try { return r ? JSON.parse(r.value) : null; } catch { return null; } };
const setKey = (db, key, v) => db.prepare(`INSERT INTO analytics_sync (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(key, JSON.stringify(v), new Date().toISOString()).run();
const doneMap = async db => (await getKey(db, 'recs_done')) || {};

/** "Mark as done" / "Show again". */
export async function markDone(db, id, by, undo = false) {
  await ensureAnalyticsSyncSchema(db);
  const m = await doneMap(db);
  if (undo) delete m[id]; else m[id] = { at: new Date().toISOString(), by };
  for (const [k, v] of Object.entries(m)) if (Date.parse(v.at) < Date.now() - 60 * DAY) delete m[k];
  await setKey(db, 'recs_done', m);
}

// ── Optional weekly summary by Claude (off by default) ──
export const aiEnabled = env => String(env.AI_SUMMARY || '').toLowerCase() === 'on' && !!env.ANTHROPIC_API_KEY;

/** Writes the summary from totals only. Returns the stored summary. */
export async function writeAiSummary(env, by = 'Weekly') {
  if (!aiEnabled(env)) return { error: 'The weekly AI summary is off (AI_SUMMARY and ANTHROPIC_API_KEY, handover A28).' };
  const db = env.DB;
  const f = await gather(db);
  const out = analyse(f);
  const facts = {
    period: `last 28 days (search to ${f.latest.gsc || 'n/a'}, GA4 to ${f.latest.ga4 || 'n/a'})`,
    glance: out.glance,
    searchTopPhrases: f.gsc.queries.slice(0, 10).map(q => ({ phrase: q.value, clicks: q.clicks, appearances: q.impressions, position: Math.round(q.position * 10) / 10 })),
    ga4Channels: f.ga4.channels.slice(0, 6), keyEvents: f.ga4.events, keyEventsBefore: f.ga4.eventsPrev,
    recommendations: out.recs.map(r => ({ area: r.area, title: r.title, finding: r.finding })),
  };
  const model = env.AI_SUMMARY_MODEL || 'claude-haiku-5-5';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4000, output_config: { effort: 'low' }, system: 'You write a short weekly website report for the staff of Lobi Stars FC, a Nigerian football club. Plain English for non-technical readers, no jargon. 120-200 words: what went well, what needs attention, and the three most useful actions this week. Use only the figures given; never invent numbers.',
      messages: [{ role: 'user', content: 'Figures (totals only):\n' + JSON.stringify(facts) }] }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { error: `Claude: ${(d.error && d.error.message) || r.status}` };
  const text = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  if (!text) return { error: 'Claude returned no summary text; try again later.' };
  const summary = { at: new Date().toISOString(), text, model, by };
  await setKey(db, 'ai_summary', summary);
  return summary;
}

/** Called by the timer after the daily sync: on Mondays, one AI summary a week (when switched on). */
export async function weeklyAiTick(env) {
  if (!aiEnabled(env)) return;
  const lagos = new Date(Date.now() + WAT);
  if (lagos.getUTCDay() !== 1 || lagos.getUTCHours() < 6) return;
  const last = await getKey(env.DB, 'ai_summary');
  if (last && Date.now() - Date.parse(last.at) < 6 * DAY) return;
  await writeAiSummary(env, 'Weekly');
}
