// SEO Scanner › AI Fix (Super Admins only).
// 1. prepareFix: works out the change and shows it as before/after. Nothing changes yet.
// 2. applyFix: only after a Super Admin presses Approve (or an automation rule allows
//    that type): the change is saved in the website's content files on GitHub
//    (src/data/seo.json, redirects.json, image-alt.json, public/robots.txt or a news
//    story's links), the site rebuilds, and the page is checked again ~4 minutes later.
// 3. undoFix: puts the file back the way it was (one click).
// Claude only ever suggests text (titles, descriptions, alt text, drafts); our code
// checks it and applies it through this fixed list of change types. The AI never
// edits code and never publishes news: code-level issues get a VS Code instruction,
// and content suggestions are drafts for the Media Officer.
import { ensureSeoSchema, getSeoSettings, setSeoSetting, listKeywords, lagosDay, parse, now as iso } from './seoStore.js';
import { info, autoAllowed, NEVER_AUTO } from './seoChecks.js';
import { guideFor, vscodeInstruction } from './seoGuides.js';
import { rowOf } from './seoReport.js';
import { callClaude, aiReady, lagosMonth, ensureAiSchema, cleanText } from './claude.js';
import { getFile, putFile, githubReady } from './github.js';
import { submitSitemap, seoFake } from './seoGoogle.js';
import { queueRecheck, alertRecipients, escapeHtml } from './seoRun.js';
import { logAdminAction } from './adminSession.js';
import { sendEmail } from './email.js';
import site from '../../../src/data/site.json' with { type: 'json' };

const fid = () => `sf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const SITE = 'https://lobistarsfc.com';
const SEO_FILE = 'src/data/seo.json', ALT_FILE = 'src/data/image-alt.json', REDIRECTS_FILE = 'src/data/redirects.json', ROBOTS_FILE = 'public/robots.txt';
const newsFile = p => { const m = String(p || '').match(/^\/news\/([a-z0-9-]{3,100})\/$/); return m ? `src/content/news/${m[1]}.md` : null; };
const SYSTEM_RULES = 'Follow Google Search Essentials: be truthful and use only the facts given; no keyword stuffing, no hidden text, no invented claims, scores, quotes, ratings or reviews, no clickbait, no ALL CAPS. Lobi Stars FC (Makurdi, Benue State, Nigeria; "the Pride of Benue"; home ground McCarthy Stadium) has no academy and no women\'s team: never mention either.';

// ── AI spending limits for the SEO Scanner (on top of the site-wide monthly AI budget) ──
export async function seoSpend(db) {
  await ensureAiSchema(db);
  const dayStart = new Date(Date.parse(`${lagosDay()}T00:00:00Z`) - 3600e3).toISOString();
  const d = await db.prepare(`SELECT COALESCE(SUM(estimated_cost), 0) AS c, COUNT(*) AS n FROM ai_usage_log WHERE feature = 'seo_fix' AND created_at >= ?`).bind(dayStart).first();
  const m = await db.prepare(`SELECT COALESCE(SUM(estimated_cost), 0) AS c, COUNT(*) AS n FROM ai_usage_log WHERE feature = 'seo_fix' AND month = ?`).bind(lagosMonth()).first();
  const s = await getSeoSettings(db);
  return { today: d.c, todayCalls: d.n, month: m.c, monthCalls: m.n, dailyLimit: Number(s.ai_daily_limit_usd) || 0, monthlyLimit: Number(s.ai_monthly_limit_usd) || 0 };
}
async function aiAllowed(env) {
  if (!aiReady(env)) return { error: 'Claude is not connected (ANTHROPIC_API_KEY).' };
  const u = await seoSpend(env.DB);
  if (u.dailyLimit && u.today >= u.dailyLimit) return { error: `Today's SEO Scanner AI limit ($${u.dailyLimit}) is reached. It resets at midnight, or a Super Admin can raise it in SEO Scanner › Settings.` };
  if (u.monthlyLimit && u.month >= u.monthlyLimit) return { error: `This month's SEO Scanner AI limit ($${u.monthlyLimit}) is reached. A Super Admin can raise it in SEO Scanner › Settings.` };
  return { ok: true };
}
async function ai(env, admin, opts) {
  const ok = await aiAllowed(env);
  if (ok.error) return { ok: false, error: ok.error };
  return callClaude(env, { feature: 'seo_fix', adminId: admin?.id || null, ...opts });
}

// ── Guard rails for AI text ──
const count = (s, k) => { if (!k) return 0; const a = String(s).toLowerCase(), b = k.toLowerCase(); let n = 0, i = 0; while ((i = a.indexOf(b, i)) !== -1) { n++; i += b.length; } return n; };
export function checkMeta({ title, description }, keyword = '') {
  const t = cleanText(title), d = cleanText(description);
  const problems = [];
  if (t && (t.length < 20 || t.length > 70)) problems.push(`the title is ${t.length} characters`);
  if (d && (d.length < 50 || d.length > 170)) problems.push(`the description is ${d.length} characters`);
  // Any two-word phrase repeated in the title, or 3+ times overall, is stuffing (with or without a target phrase).
  const pairs = s => { const w = s.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean), m = new Map(); for (let i = 0; i + 1 < w.length; i++) { const k = `${w[i]} ${w[i + 1]}`; if (!['lobi stars', 'stars fc'].includes(k)) m.set(k, (m.get(k) || 0) + 1); } return m; };
  const repeated = [...pairs(t).values()].some(n => n > 1) || [...pairs(`${t} ${d}`).values()].some(n => n > 2);
  if ((keyword && (count(t, keyword) > 1 || count(d, keyword) > 2)) || repeated) problems.push('the search phrase is repeated too often (keyword stuffing)');
  if (/academy|women'?s team|ladies/i.test(`${t} ${d}`)) problems.push('it mentions an academy or women\'s team, which the club does not have');
  if (/\b(\d(\.\d)?\s*(\/\s*5|stars?\b)|rated|best club in|number one|no\.?\s*1\b)/i.test(`${t} ${d}`)) problems.push('it makes a rating or "best" claim');
  if ((t.match(/[A-Z]/g) || []).length > t.length * 0.6 && t.length > 10) problems.push('the title is in capitals');
  return { title: t, description: d, problems };
}
const warnLen = (t, d) => [t && (t.length < 30 || t.length > 60) ? `Title ${t.length} characters (aim 30–60).` : null, d && (d.length < 70 || d.length > 160) ? `Description ${d.length} characters (aim 70–160).` : null].filter(Boolean);

// ── Reading the page facts the scanner stored ──
async function pageOf(db, path) {
  const r = path ? await db.prepare(`SELECT * FROM seo_pages WHERE path = ?`).bind(path).first() : null;
  return r ? { ...r, data: parse(r.data, {}) } : null;
}
async function issueOf(db, id) {
  const r = await db.prepare(`SELECT * FROM seo_issues WHERE id = ?`).bind(id).first();
  return r ? rowOf(r) : null;
}
const jsonFile = async (env, file, empty) => { const f = await getFile(env, file); return { sha: f?.sha, data: f ? parse(f.text, empty) : empty, text: f?.text ?? null }; };
const META_TYPES = ['title_missing', 'title_duplicate', 'title_length', 'desc_missing', 'desc_duplicate', 'desc_length', 'low_ctr', 'almost_top', 'rank_drop', 'clicks_drop', 'keyword_missing'];
const DESC_ONLY = ['desc_missing', 'desc_duplicate', 'desc_length'];

/** Prepares the fix for an issue. Returns the fix row (proposal shown as before/after) or { error }. */
export async function prepareFix(env, admin, issueId, { auto = false, note = '' } = {}) {
  const db = env.DB;
  await ensureSeoSchema(db);
  const issue = await issueOf(db, issueId);
  if (!issue) return { error: 'That issue is no longer open.', status: 404 };
  const kind = info(issue.type).ai;
  if (!kind) return { error: 'This issue has no AI Fix: use "Fix it myself".', status: 400 };
  let p;
  try {
    // Code-level: structured data that must come from the page's own data (matches, breadcrumbs) or has errors.
    const need = issue.data?.need || [];
    const codeOnly = kind === 'vscode' || issue.type === 'schema_invalid' || (issue.type === 'schema_missing' && !need.some(n => ['NewsArticle', 'Person', 'SportsTeam / Organization'].includes(n)));
    if (codeOnly) {
      p = { kind: 'vscode', summary: 'This needs a change in the website’s code, so nothing on the live site is changed. Copy the instruction into VS Code (Claude Code), or send it to the developer.', vscode: vscodeInstruction(issue) };
    } else if (META_TYPES.includes(issue.type)) p = await proposeMeta(env, admin, issue, note);
    else if (kind === 'alt_text') p = await proposeAlt(env, admin, issue, note);
    else if (kind === 'schema') p = await proposeSchema(env, issue);
    else if (kind === 'redirect') p = await proposeRedirect(env, issue);
    else if (kind === 'fix_link') p = await proposeUnlink(env, issue);
    else if (kind === 'internal_links') p = issue.type === 'news_player_links' ? await proposeNewsLinks(env, issue) : await proposeLinkIdeas(env, issue);
    else if (kind === 'sitemap') p = proposeSitemap(env, issue);
    else if (kind === 'robots') p = await proposeRobots(env, issue);
    else if (kind === 'mark_staff') p = { kind: 'flag', summary: 'Emails the Super Admins and the SEO alert list that the fixtures or table need updating (Matchday › Matches, League).', preview: { before: issue.problem, after: 'Flagged for the matchday team. The page is checked again at the next scan.' } };
    else if (kind === 'draft_text') p = await proposeDraft(env, admin, issue, note);
    else p = { kind: 'vscode', summary: 'Copy the instruction into VS Code.', vscode: vscodeInstruction(issue) };
  } catch (err) {
    console.error('[seo] prepare', issue.type, err);
    return { error: `The fix could not be prepared: ${String(err.message || err).slice(0, 200)}`, status: 500 };
  }
  if (p.error) return { error: p.error, status: p.status || 400 };
  const status = p.kind === 'vscode' ? 'instruction' : p.kind === 'draft' || p.kind === 'ideas' ? 'draft' : 'proposed';
  const id = fid();
  await db.prepare(`INSERT INTO seo_fixes (id, issue_id, type, path, status, auto, proposal, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, issue.id, issue.type, issue.path, status, auto ? 1 : 0, JSON.stringify(p), note ? String(note).slice(0, 300) : null, admin?.name || 'Automation rule', iso()).run();
  if (admin) await logAdminAction(db, admin, 'seo_fix', `SEO Scanner: AI Fix prepared for "${info(issue.type).name}"${issue.path ? ` on ${issue.path}` : ''} (${p.kind})`);
  return { fix: await fixRow(db, id) };
}
export async function fixRow(db, id) {
  const r = await db.prepare(`SELECT * FROM seo_fixes WHERE id = ?`).bind(id).first();
  return r ? { ...r, proposal: parse(r.proposal, {}), before: parse(r.before, null), applied: parse(r.applied, null), metrics: parse(r.metrics, null), name: info(r.type).name } : null;
}

// ── The proposals ──
async function proposeMeta(env, admin, issue, note) {
  const db = env.DB;
  const page = await pageOf(db, issue.path);
  if (!page || !page.data?.title && !page.data?.h1) return { error: 'The scanner has not read this page yet: press "Check again" first.' };
  const kws = (await listKeywords(db)).filter(k => k.target_path === issue.path);
  const keyword = issue.data?.keyword || kws[0]?.keyword || '';
  const seo = await jsonFile(env, SEO_FILE, {});
  const current = seo.data[issue.path] || {};
  const descOnly = DESC_ONLY.includes(issue.type);
  const facts = [`Page address: ${SITE}${issue.path}`, `Current title: ${page.data.title || '(none)'}`, `Current description: ${page.data.desc || '(none)'}`, `Main heading: ${(page.data.h1 || []).join(' / ') || '(none)'}`,
    `First paragraph: ${page.data.firstPara || '(none)'}`, keyword && `Target search phrase (use naturally, at most once): ${keyword}`, `Problem found: ${issue.problem}`, note && `Notes from the Super Admin: ${note}`,
    issue.type === 'title_duplicate' && issue.data?.pages ? `Other pages with the same title: ${issue.data.pages.filter(x => x !== issue.path).join(', ')}` : null].filter(Boolean).join('\n');
  const r = await ai(env, admin, { system: `You write Google search titles and descriptions for pages of the official Lobi Stars FC website. ${SYSTEM_RULES} Title: 30–60 characters, ending with " | Lobi Stars FC" when it fits. Description: 70–160 characters, one or two plain sentences saying what a fan finds on the page.`,
    prompt: facts, schema: { title: { type: 'string', min: 15, max: 75 }, description: { type: 'string', min: 40, max: 180 } }, maxTokens: 300, relatedId: issue.id });
  if (!r.ok) return { error: r.error };
  const c = checkMeta(r.data, keyword);
  if (c.problems.length) return { error: `The AI suggestion was not used (${c.problems.join('; ')}). Press AI Fix again, or edit it yourself.` };
  const after = { ...current, ...(descOnly ? {} : { title: c.title }), description: c.description };
  return { kind: 'seo_meta', summary: `New Google ${descOnly ? 'description' : 'title and description'} for ${issue.path} (saved in src/data/seo.json; the page itself is not changed).`, editable: descOnly ? ['description'] : ['title', 'description'], keyword,
    changes: [{ file: SEO_FILE, op: 'json_set', key: issue.path, before: seo.data[issue.path] ?? null, after }],
    preview: { before: { title: page.data.title, description: page.data.desc }, after: { title: after.title || page.data.title, description: after.description } }, warnings: warnLen(after.title || '', after.description), cost: r.cost };
}
async function proposeAlt(env, admin, issue, note) {
  const db = env.DB;
  const page = await pageOf(db, issue.path);
  const list = (issue.data?.images || []).filter(s => /^\/images\//.test(s));
  const others = (issue.data?.images || []).filter(s => !/^\/images\//.test(s));
  const alt = await jsonFile(env, ALT_FILE, {});
  const todo = list.filter(s => !alt.data[s]).slice(0, 6);
  if (!todo.length) return others.length ? { kind: 'vscode', summary: 'These pictures are not stored in the website’s images folder, so their alt text is added where they were uploaded (e.g. the news story).', vscode: vscodeInstruction(issue) } : { error: 'These pictures already have alt text waiting for the next build.' };
  const content = [{ type: 'text', text: `Page: ${SITE}${issue.path}\nPage title: ${page?.data?.title || ''}\nMain heading: ${(page?.data?.h1 || []).join(' / ')}\n${note ? `Notes: ${note}\n` : ''}Write alt text for each picture below, in order (alt1 for the first picture, and so on).` }];
  todo.forEach((src, n) => content.push({ type: 'text', text: `Picture ${n + 1}: ${src}` }, { type: 'image', source: { type: 'url', url: `${SITE}${encodeURI(src)}` } }));
  const schema = Object.fromEntries(todo.map((_, n) => [`alt${n + 1}`, { type: 'string', min: 5, max: 140 }]));
  const r = await ai(env, admin, { system: `You write alt text (picture descriptions for blind fans and Google Images) for the official Lobi Stars FC website. ${SYSTEM_RULES} Describe only what is visible, under 125 characters, without "image of" or "photo of". Name a person only if the page text names them.`,
    messages: [{ role: 'user', content }], schema, maxTokens: 120 + todo.length * 60, relatedId: issue.id });
  if (!r.ok) return { error: r.error };
  const after = { ...alt.data };
  const rows = todo.map((src, n) => ({ src, alt: cleanText(r.data[`alt${n + 1}`]).slice(0, 125) }));
  for (const x of rows) after[x.src] = x.alt;
  return { kind: 'alt', summary: `Alt text for ${rows.length} picture${rows.length === 1 ? '' : 's'} on ${issue.path} (saved in src/data/image-alt.json and added to every page showing them at the next build; only where a picture has none).`,
    editable: rows.map((_, n) => `alt${n + 1}`), rows, changes: rows.map(x => ({ file: ALT_FILE, op: 'json_set', key: x.src, before: alt.data[x.src] ?? null, after: x.alt })),
    preview: { before: rows.map(x => ({ src: x.src, alt: '(none)' })), after: rows }, note: others.length ? `${others.length} other picture(s) are stored elsewhere: see the VS Code instruction.` : null, cost: r.cost };
}
function teamLd(site) {
  const sameAs = Object.values(site?.social || {}).filter(u => /^https:\/\//.test(u));
  return { '@context': 'https://schema.org', '@type': 'SportsTeam', name: 'Lobi Stars FC', alternateName: 'Lobi Stars', sport: 'Soccer', url: `${SITE}/`, logo: `${SITE}/images/lobi-stars-badge.png`,
    location: { '@type': 'Place', name: 'McCarthy Stadium', address: { '@type': 'PostalAddress', addressLocality: 'Makurdi', addressRegion: 'Benue State', addressCountry: 'NG' } }, ...(sameAs.length ? { sameAs } : {}) };
}
async function proposeSchema(env, issue) {
  const db = env.DB;
  const page = await pageOf(db, issue.path || '/');
  if (!page?.data) return { error: 'The scanner has not read this page yet: press "Check again" first.' };
  const d = page.data, path = issue.path || '/';
  const blocks = [];
  if (path === '/' || issue.type === 'org_social') blocks.push(teamLd(site));
  else if (/^\/news\/[^/]+\/$/.test(path)) {
    if (!d.published) return { kind: 'vscode', summary: 'The story page has no publish date, so its article data has to be added in code.', vscode: vscodeInstruction(issue) };
    blocks.push({ '@context': 'https://schema.org', '@type': 'NewsArticle', headline: (d.h1?.[0] || d.title.split(' | ')[0]).slice(0, 110), datePublished: d.published, ...(d.modified ? { dateModified: d.modified } : {}),
      mainEntityOfPage: `${SITE}${path}`, author: { '@type': 'Organization', name: 'Lobi Stars FC', url: `${SITE}/` }, publisher: { '@type': 'Organization', name: 'Lobi Stars FC', logo: { '@type': 'ImageObject', url: `${SITE}/images/lobi-stars-badge.png` } },
      ...(d.images?.[0] ? { image: [`${SITE}${d.images[0].src}`] } : {}) });
  } else if (/^\/squad\//.test(path)) {
    if (!d.h1?.[0]) return { error: 'The profile has no name heading to use.' };
    blocks.push({ '@context': 'https://schema.org', '@type': 'Person', name: d.h1[0], url: `${SITE}${path}`, memberOf: { '@type': 'SportsTeam', name: 'Lobi Stars FC', url: `${SITE}/` }, ...(d.images?.[0] ? { image: `${SITE}${d.images[0].src}` } : {}) });
  } else return { kind: 'vscode', summary: 'This kind of structured data has to come from the page’s own data (code).', vscode: vscodeInstruction(issue) };
  // Only the types the page does not already have.
  const missing = blocks.filter(b => !d.schema.includes(b['@type']) || issue.type === 'org_social');
  if (!missing.length) return { error: 'The page already has this structured data.' };
  const seo = await jsonFile(env, SEO_FILE, {});
  const current = seo.data[path] || {};
  const keep = (current.jsonLd || []).filter(b => !missing.some(m => m['@type'] === b['@type']));
  const after = { ...current, jsonLd: [...keep, ...missing] };
  return { kind: 'jsonld', summary: `Adds ${missing.map(b => b['@type']).join(', ')} structured data to ${path} (from facts already on the page; saved in src/data/seo.json).`,
    changes: [{ file: SEO_FILE, op: 'json_set', key: path, before: seo.data[path] ?? null, after }], preview: { before: d.schema.length ? d.schema.join(', ') : '(no structured data)', after: JSON.stringify(missing, null, 2) },
    note: issue.type === 'org_social' && path === '/' ? 'The homepage already describes the club; this adds a second, fuller description with the social profiles. A developer can later merge the two (VS Code instruction available).' : null };
}
// The closest live page for a missing address (same section, most words in common).
export function bestMatch(missing, candidates) {
  const words = s => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  const mw = new Set(words(missing));
  const section = missing.split('/')[1] || '';
  let best = null;
  for (const c of candidates) {
    if (c === missing) continue;
    const cw = words(c);
    const shared = cw.filter(w => mw.has(w)).length;
    const score = shared / Math.max(1, Math.max(mw.size, cw.length)) + (c.split('/')[1] === section ? 0.15 : 0);
    if (!best || score > best.score) best = { path: c, score };
  }
  if (best && best.score >= 0.4) return best.path;
  return section && candidates.includes(`/${section}/`) ? `/${section}/` : '/';
}
async function proposeRedirect(env, issue) {
  const db = env.DB;
  const from = issue.path;
  if (!from || from === '/') return { error: 'The homepage cannot be redirected.' };
  const live = (await db.prepare(`SELECT path FROM seo_pages WHERE status = 200`).all()).results.map(r => r.path);
  if (live.includes(from)) return { error: `${from} opens normally now: no redirect needed. Press "Check again".` };
  const to = bestMatch(from, live);
  const red = await jsonFile(env, REDIRECTS_FILE, []);
  if (red.data.some(r => r.from === from)) return { error: 'A redirect for this address is already waiting for the next build.' };
  if (red.data.some(r => r.from === to)) return { error: 'The suggested page is itself redirected; use "Fix it myself".' };
  return { kind: 'redirect', summary: `Sends visitors and Google from ${from} to ${to} (a permanent 301 redirect, saved in src/data/redirects.json). The links on the pages listed should still be corrected.`, editable: ['to'],
    changes: [{ file: REDIRECTS_FILE, op: 'array_add', item: { from, to } }], preview: { before: `${from} → error ${issue.data?.status || 404}`, after: `${from} → ${to}` }, from: issue.data?.from || [] };
}
async function proposeUnlink(env, issue) {
  const file = newsFile(issue.path);
  const url = issue.data?.url;
  if (!file || !url) return { kind: 'vscode', summary: 'This link is not in a news story, so it is changed in code.', vscode: vscodeInstruction(issue) };
  const f = await getFile(env, file);
  if (!f) return { error: 'The story file was not found.' };
  const re = new RegExp(`\\[([^\\]]+)\\]\\(${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^)]*\\)`);
  const m = f.text.match(re);
  if (!m) return { error: 'The link is not written in the story text (it may come from the page design): use "Fix it myself".' };
  return { kind: 'unlink', summary: `Removes the dead link to ${url} from the story (the words stay).`, changes: [{ file, op: 'replace', pairs: [{ find: m[0], replace: m[1] }] }], preview: { before: m[0], after: m[1] } };
}
async function proposeNewsLinks(env, issue) {
  const file = newsFile(issue.path);
  if (!file) return { error: 'Not a news story.' };
  const f = await getFile(env, file);
  if (!f) return { error: 'The story file was not found.' };
  const fm = f.text.match(/^---[\s\S]*?\n---\n?/)?.[0] || '';
  const body = f.text.slice(fm.length);
  const pairs = [];
  const already = (body.match(/\]\(\/squad\//g) || []).length;
  for (const pl of (issue.data?.people || []).slice(0, Math.max(0, 3 - already))) {
    // The first plain mention: not in a heading, not already a link, not in a picture.
    const lines = body.split('\n');
    for (const line of lines) {
      if (/^\s*(#|!\[|>|\|)/.test(line)) continue;
      const i = line.toLowerCase().indexOf(pl.name.toLowerCase());
      if (i < 0) continue;
      const before = line.slice(0, i);
      if ((before.match(/\[/g) || []).length > (before.match(/\]/g) || []).length) continue;
      const word = line.slice(i, i + pl.name.length);
      const snippet = line.slice(Math.max(0, i - 30), i + pl.name.length + 30);
      const newSnippet = snippet.replace(word, `[${word}](${pl.path})`);
      if (body.split(snippet).length === 2) { pairs.push({ find: snippet, replace: newSnippet, name: word, to: pl.path }); break; }
    }
  }
  if (!pairs.length) return { error: 'No plain mention could be linked safely (names in headings, pictures or already linked). Use "Fix it myself".' };
  return { kind: 'news_links', summary: `Adds ${pairs.length} link${pairs.length === 1 ? '' : 's'} to player profiles in the story (the first mention of each; at most 3 per story).`,
    changes: [{ file, op: 'replace', pairs: pairs.map(({ find, replace }) => ({ find, replace })) }], preview: { before: pairs.map(p => p.find), after: pairs.map(p => p.replace) } };
}
async function proposeLinkIdeas(env, issue) {
  const db = env.DB;
  const live = (await db.prepare(`SELECT path, data FROM seo_pages WHERE status = 200`).all()).results.map(r => ({ path: r.path, d: parse(r.data, {}) }));
  const target = live.find(p => p.path === issue.path);
  const words = s => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3));
  const tw = words(`${target?.d?.title || ''} ${(target?.d?.h1 || []).join(' ')}`);
  const ideas = live.filter(p => p.path !== issue.path && !p.d.noindex && !(p.d.links || []).includes(issue.path))
    .map(p => ({ path: p.path, score: [...words(`${p.d.title} ${(p.d.h1 || []).join(' ')}`)].filter(w => tw.has(w)).length + (p.path.split('/')[1] === issue.path.split('/')[1] ? 1 : 0) }))
    .filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  const anchor = (target?.d?.h1?.[0] || target?.d?.title?.split(' | ')[0] || issue.path).slice(0, 70);
  const text = ideas.length ? ideas.map((x, n) => `${n + 1}. On ${x.path}, add a link with the words "${anchor}" to ${issue.path}.`).join('\n') : `Add a link to ${issue.path} from its section page (/${issue.path.split('/')[1]}/) with the words "${anchor}".`;
  return { kind: 'ideas', summary: 'Suggestions only: nothing is changed. Add the links yourself in Admin › News (or ask the developer for pages in the design).', draft: text };
}
function proposeSitemap(env, issue) {
  return { kind: 'sitemap', summary: `${env.PAGES_DEPLOY_HOOK ? 'Rebuilds the website (sitemap.xml is written fresh from the live pages) and then ' : ''}sends sitemap.xml to Google Search Console again.`,
    preview: { before: issue.problem, after: `${env.PAGES_DEPLOY_HOOK ? 'Site rebuilt; ' : ''}sitemap.xml resubmitted to Google.` }, note: issue.type === 'sitemap_missing_page' ? 'Pages made on request by the server are not in the built sitemap: if a page is still missing afterwards, use the VS Code instruction.' : null,
    vscode: issue.type === 'sitemap_missing_page' ? vscodeInstruction(issue) : null };
}
const ROBOTS_KEEP = ['/admin', '/api/', '/scan', '/staff/'];
export function fixRobots(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  for (const l of lines) {
    if (/^\s*disallow:\s*\/\s*$/i.test(l) || /^\s*disallow:\s*\/\*\s*$/i.test(l)) continue; // blocks the whole site
    if (/^\s*sitemap:/i.test(l)) continue;
    out.push(l);
  }
  if (!out.some(l => /^\s*user-agent:\s*\*/i.test(l))) out.unshift('User-agent: *');
  const at = out.findIndex(l => /^\s*user-agent:\s*\*/i.test(l));
  for (const k of [...ROBOTS_KEEP].reverse()) if (!out.some(l => new RegExp(`^\\s*disallow:\\s*${k.replace(/[/]/g, '\\/')}\\s*$`, 'i').test(l))) out.splice(at + 1, 0, `Disallow: ${k}`);
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return `${out.join('\n')}\n\nSitemap: ${SITE}/sitemap.xml\n`;
}
async function proposeRobots(env, issue) {
  const f = await getFile(env, ROBOTS_FILE);
  const before = f?.text ?? '';
  const after = fixRobots(before);
  if (after.trim() === before.trim()) return { error: 'robots.txt in the website files is already correct; the live one may be from an older build. Press "Check again" after the next build.' };
  return { kind: 'robots', summary: 'A corrected robots.txt: Google may read every public page; the admin, staff and system areas stay closed; it points to the sitemap.', editable: ['text'],
    changes: [{ file: ROBOTS_FILE, op: 'text', before, after }], preview: { before, after } };
}
async function proposeDraft(env, admin, issue, note) {
  const page = await pageOf(env.DB, issue.path);
  if (!page?.data) return { error: 'The scanner has not read this page yet.' };
  const r = await ai(env, admin, { system: `You help the Media Officer of Lobi Stars FC improve a short web page. ${SYSTEM_RULES} Write a DRAFT of 2–3 short paragraphs that expands the page using ONLY the facts given. Never invent scores, names, quotes or dates. The draft is checked and published by a person, never automatically.`,
    prompt: `Page: ${SITE}${issue.path}\nTitle: ${page.data.title}\nMain heading: ${(page.data.h1 || []).join(' / ')}\nText on the page: ${String(page.data.textSample || page.data.firstPara || '').slice(0, 2500)}\n${note ? `Notes: ${note}` : ''}`,
    schema: { draft: { type: 'string', min: 80, max: 1600, multiline: true } }, maxTokens: 700, allowNeeds: true, relatedId: issue.id });
  if (!r.ok) return { error: r.error };
  if (r.needs) return { kind: 'draft', summary: 'Claude needs more facts before it can draft anything.', draft: `Question for the Media Officer: ${r.needs}`, cost: r.cost };
  return { kind: 'draft', summary: 'A draft for the Media Officer to check and add (nothing is published). Copy it into Admin › News.', draft: r.data.draft, cost: r.cost };
}

// ── Applying and undoing ──
async function applyChanges(env, changes, message) {
  const done = [];
  for (const c of changes) {
    if (c.op === 'json_set') {
      const f = await jsonFile(env, c.file, {});
      const data = { ...f.data };
      if (c.after === null) delete data[c.key]; else data[c.key] = c.after;
      done.push({ file: c.file, commit: await putFile(env, c.file, `${JSON.stringify(data, null, 2)}\n`, message, f.sha) });
    } else if (c.op === 'array_add') {
      const f = await jsonFile(env, c.file, []);
      const data = [...f.data.filter(x => x.from !== c.item.from), c.item];
      done.push({ file: c.file, commit: await putFile(env, c.file, `${JSON.stringify(data, null, 2)}\n`, message, f.sha) });
    } else if (c.op === 'text') {
      const f = await getFile(env, c.file);
      if ((f?.text ?? '') !== c.before) throw new Error(`${c.file} changed since the fix was prepared: prepare it again.`);
      done.push({ file: c.file, commit: await putFile(env, c.file, c.after, message, f?.sha) });
    } else if (c.op === 'replace') {
      const f = await getFile(env, c.file);
      if (!f) throw new Error(`${c.file} was not found.`);
      let t = f.text;
      for (const p of c.pairs) { if (t.split(p.find).length !== 2) throw new Error('The story changed since the fix was prepared: prepare it again.'); t = t.replace(p.find, p.replace); }
      done.push({ file: c.file, commit: await putFile(env, c.file, t, message, f.sha) });
    }
  }
  return done;
}
async function undoChanges(env, changes, message) {
  for (const c of [...changes].reverse()) {
    if (c.op === 'json_set') {
      const f = await jsonFile(env, c.file, {});
      const data = { ...f.data };
      if (JSON.stringify(data[c.key] ?? null) !== JSON.stringify(c.after ?? null)) throw new Error(`${c.key} in ${c.file} was changed again after this fix; undo the later change first.`);
      if (c.before === null) delete data[c.key]; else data[c.key] = c.before;
      await putFile(env, c.file, `${JSON.stringify(data, null, 2)}\n`, message, f.sha);
    } else if (c.op === 'array_add') {
      const f = await jsonFile(env, c.file, []);
      await putFile(env, c.file, `${JSON.stringify(f.data.filter(x => !(x.from === c.item.from && x.to === c.item.to)), null, 2)}\n`, message, f.sha);
    } else if (c.op === 'text') {
      const f = await getFile(env, c.file);
      if ((f?.text ?? '') !== c.after) throw new Error(`${c.file} was changed again after this fix.`);
      await putFile(env, c.file, c.before, message, f?.sha);
    } else if (c.op === 'replace') {
      const f = await getFile(env, c.file);
      let t = f?.text || '';
      for (const p of c.pairs) { if (t.split(p.replace).length !== 2) throw new Error('The story was changed again after this fix; undo it by hand in Admin › News.'); t = t.replace(p.replace, p.find); }
      await putFile(env, c.file, t, message, f.sha);
    }
  }
}
// Google figures for a page over 28 days (for History: before and after).
async function pageFigures(db, path, fromDay, toDay) {
  if (!path) return null;
  const r = await db.prepare(`SELECT SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) AS pw FROM gsc_daily WHERE dim = 'page' AND (value = ? OR value = ?) AND date >= ? AND date < ?`)
    .bind(`${SITE}${path}`, path, fromDay, toDay).first().catch(() => null);
  if (!r || !r.i) return { clicks: r?.c || 0, impressions: 0, ctr: 0, position: null };
  return { clicks: r.c || 0, impressions: r.i, ctr: Math.round((r.c / r.i) * 1000) / 10, position: Math.round((r.pw / r.i) * 10) / 10 };
}
const dayOff = (ms, n) => new Date(ms + n * 864e5).toISOString().slice(0, 10);

/** Approve: applies a prepared fix. edited: the Super Admin's own changes to the editable fields. */
export async function applyFix(env, admin, fixId, { edited = null, auto = false } = {}) {
  const db = env.DB;
  const fix = await fixRow(db, fixId);
  if (!fix) return { error: 'Not found.', status: 404 };
  if (fix.status !== 'proposed') return { error: fix.status === 'applied' ? 'Already applied.' : 'This fix can no longer be applied.', status: 409 };
  const p = fix.proposal;
  if (auto && (!autoAllowed(fix.type) || NEVER_AUTO.includes(fix.type))) return { error: 'This type is never fixed automatically.', status: 400 };
  if (['seo_meta', 'alt', 'jsonld', 'redirect', 'unlink', 'news_links', 'robots'].includes(p.kind) && !githubReady(env)) return { error: 'The website’s GitHub connection (GITHUB_TOKEN) is not set up, so content files cannot be changed.', status: 400 };
  let changes = p.changes || [];
  // The Super Admin's edits (checked again).
  if (edited && typeof edited === 'object') {
    if (p.kind === 'seo_meta') {
      const c = checkMeta({ title: edited.title ?? p.preview.after.title, description: edited.description ?? p.preview.after.description }, p.keyword);
      if (c.problems.length) return { error: `Not saved: ${c.problems.join('; ')}.`, status: 400 };
      const ch = { ...changes[0], after: { ...changes[0].after, ...(p.editable.includes('title') ? { title: c.title } : {}), description: c.description } };
      changes = [ch];
    } else if (p.kind === 'alt') {
      changes = changes.map((c, n) => { const v = edited[`alt${n + 1}`]; return v ? { ...c, after: cleanText(v).slice(0, 125) } : c; });
    } else if (p.kind === 'redirect' && edited.to) {
      const to = String(edited.to).trim();
      if (!/^\/[^\s]*$/.test(to) || to === changes[0].item.from) return { error: 'Type a page address on this website, e.g. /news/', status: 400 };
      changes = [{ ...changes[0], item: { ...changes[0].item, to: to.replace(/\/?$/, '/') } }];
    } else if (p.kind === 'robots' && edited.text) {
      const t = String(edited.text).replace(/\r/g, '');
      if (/^\s*disallow:\s*\/\s*$/im.test(t)) return { error: 'robots.txt must not block the whole website ("Disallow: /").', status: 400 };
      if (!/sitemap:/i.test(t)) return { error: 'Keep the "Sitemap:" line.', status: 400 };
      changes = [{ ...changes[0], after: t.endsWith('\n') ? t : `${t}\n` }];
    }
  }
  const label = `${info(fix.type).name}${fix.path ? ` on ${fix.path}` : ''}`;
  let applied;
  try {
    if (p.kind === 'sitemap') {
      if (env.PAGES_DEPLOY_HOOK && !seoFake(env)) await fetch(env.PAGES_DEPLOY_HOOK, { method: 'POST', signal: AbortSignal.timeout(15000) }).catch(() => null);
      const s = await submitSitemap(env);
      if (!s.ok) return { error: s.error, status: 400 };
      applied = { submitted: true, rebuilt: !!env.PAGES_DEPLOY_HOOK };
    } else if (p.kind === 'flag') {
      const to = await alertRecipients(env);
      if (to.length && env.RESEND_API_KEY) await sendEmail(env, { to, subject: 'Website: fixtures or league table need updating', html: `<p>${escapeHtml(fix.proposal.preview.before)}</p><p>Please update them in <a href="${SITE}/admin/matches/">Admin › Matchday › Matches</a> and <a href="${SITE}/admin/league/">Admin › League</a>. Out-of-date fixtures make the site look neglected to fans and to Google.</p>` }).catch(() => null);
      applied = { flagged: to.length };
    } else if (changes.length) {
      applied = { commits: await applyChanges(env, changes, `SEO Scanner${auto ? ' (automatic)' : ''}: ${label}`) };
    } else return { error: 'Nothing to apply.', status: 400 };
  } catch (err) {
    await db.prepare(`UPDATE seo_fixes SET status = 'failed', note = ? WHERE id = ?`).bind(String(err.message || err).slice(0, 300), fixId).run();
    return { error: `Not applied: ${String(err.message || err).slice(0, 200)}`, status: 500 };
  }
  const t = Date.now();
  const metrics = { before: await pageFigures(db, fix.path, dayOff(t, -30), dayOff(t, -2)) };
  await db.prepare(`UPDATE seo_fixes SET status = 'applied', applied = ?, before = ?, proposal = ?, applied_at = ?, metrics = ?, auto = ? WHERE id = ?`)
    .bind(JSON.stringify(applied), JSON.stringify(changes.map(c => ({ file: c.file, key: c.key, before: c.before ?? null }))), JSON.stringify({ ...p, changes }), iso(), JSON.stringify(metrics), auto ? 1 : fix.auto, fixId).run();
  await db.prepare(`UPDATE seo_issues SET status = 'open' WHERE id = ? AND status = 'ignored'`).bind(fix.issue_id).run();
  if (fix.path && p.kind !== 'flag') await queueRecheck(db, [fix.path], p.kind === 'sitemap' ? 1 : 4);
  if (admin) await logAdminAction(db, admin, 'seo_fix_apply', `SEO Scanner: approved and applied "${label}" (${p.kind})`);
  return { ok: true, fix: await fixRow(db, fixId), message: changes.length ? 'Saved. The website rebuilds in about 2–3 minutes; the page is then checked again automatically.' : 'Done.' };
}
export async function cancelFix(env, admin, fixId) {
  const db = env.DB;
  const fix = await fixRow(db, fixId);
  if (!fix) return { error: 'Not found.', status: 404 };
  if (!['proposed', 'draft', 'instruction'].includes(fix.status)) return { error: 'Only a fix that is waiting can be cancelled.', status: 409 };
  await db.prepare(`UPDATE seo_fixes SET status = 'cancelled' WHERE id = ?`).bind(fixId).run();
  await logAdminAction(db, admin, 'seo_fix', `SEO Scanner: cancelled the fix for "${fix.name}"${fix.path ? ` on ${fix.path}` : ''}`);
  return { ok: true };
}
export async function undoFix(env, admin, fixId) {
  const db = env.DB;
  const fix = await fixRow(db, fixId);
  if (!fix) return { error: 'Not found.', status: 404 };
  if (fix.status !== 'applied') return { error: 'Only an applied fix can be undone.', status: 409 };
  const p = fix.proposal;
  if (['sitemap', 'flag'].includes(p.kind)) return { error: 'Nothing to undo: this fix did not change any file.', status: 400 };
  try { await undoChanges(env, p.changes || [], `SEO Scanner: undo ${fix.name}${fix.path ? ` on ${fix.path}` : ''}`); }
  catch (err) { return { error: String(err.message || err).slice(0, 240), status: 409 }; }
  await db.prepare(`UPDATE seo_fixes SET status = 'undone', undone_at = ? WHERE id = ?`).bind(iso(), fixId).run();
  if (fix.path) await queueRecheck(db, [fix.path], 4);
  await logAdminAction(db, admin, 'seo_fix_undo', `SEO Scanner: undid "${fix.name}"${fix.path ? ` on ${fix.path}` : ''}`);
  return { ok: true, message: 'Undone. The website rebuilds in about 2–3 minutes.' };
}

/** History: the fixes, newest first, with Google figures 28 days before and (when available) after. */
export async function fixHistory(env, { limit = 60 } = {}) {
  const db = env.DB;
  await ensureSeoSchema(db);
  const rows = (await db.prepare(`SELECT * FROM seo_fixes WHERE status IN ('applied', 'undone', 'failed', 'cancelled') ORDER BY COALESCE(applied_at, created_at) DESC LIMIT ?`).bind(limit).all()).results;
  const out = [];
  for (const r of rows) {
    const m = parse(r.metrics, {}) || {};
    if (r.status === 'applied' && r.applied_at && !m.after && Date.now() - Date.parse(r.applied_at) > 30 * 864e5) {
      const t = Date.parse(r.applied_at);
      m.after = await pageFigures(db, r.path, dayOff(t, 1), dayOff(t, 29));
      await db.prepare(`UPDATE seo_fixes SET metrics = ?, checked_at = ? WHERE id = ?`).bind(JSON.stringify(m), iso(), r.id).run();
    }
    const p = parse(r.proposal, {});
    out.push({ id: r.id, issueId: r.issue_id, type: r.type, name: info(r.type).name, path: r.path, status: r.status, auto: !!r.auto, kind: p.kind, summary: p.summary, preview: p.preview, by: r.created_by,
      createdAt: r.created_at, appliedAt: r.applied_at, undoneAt: r.undone_at, note: r.note, metrics: m, undoable: r.status === 'applied' && !['sitemap', 'flag'].includes(p.kind) });
  }
  return out;
}

// ── "Send to developer" ──
export async function sendToDeveloper(env, admin, issueId) {
  const db = env.DB;
  const issue = await issueOf(db, issueId);
  if (!issue) return { error: 'Not found.', status: 404 };
  const s = await getSeoSettings(db);
  const to = String(s.developer_email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { error: 'Add the developer’s email address in SEO Scanner › Settings first.', status: 400 };
  if (!env.RESEND_API_KEY) return { error: 'Email is not set up (RESEND_API_KEY).', status: 400 };
  const text = vscodeInstruction(issue);
  await sendEmail(env, { to, subject: `Website fix needed: ${info(issue.type).name}${issue.path ? ` (${issue.path})` : ''}`,
    html: `<p>Hello, the SEO Scanner on lobistarsfc.com found this. Sent by ${escapeHtml(admin.name)}.</p><pre style="white-space:pre-wrap;background:#f1f5f9;padding:12px;border-radius:8px;font-size:13px">${escapeHtml(text)}</pre><p>Google help: <a href="${guideFor(issue.type).help}">${guideFor(issue.type).help}</a></p>` });
  await logAdminAction(db, admin, 'seo_developer', `SEO Scanner: sent "${info(issue.type).name}"${issue.path ? ` (${issue.path})` : ''} to the developer (${to})`);
  return { ok: true, message: `Sent to ${to}.` };
}

// ── Automation rules (Phase 5) ──
export const RULE_MODES = ['off', 'approve', 'auto'];
export const RULE_SCOPES = { all: 'All pages', new: 'New pages only (published in the last 7 days)', news: 'News stories only' };
export async function listRules(db) {
  await ensureSeoSchema(db);
  return (await db.prepare(`SELECT * FROM seo_rules ORDER BY type`).all()).results;
}
export async function saveRule(db, admin, { type, mode, scope = 'all', daily_max = 5, notify = 'email' }) {
  if (!info(type).ai || info(type).ai === 'vscode') return { error: 'This issue type cannot be fixed by the AI (it needs code or a person).', status: 400 };
  if (!RULE_MODES.includes(mode)) return { error: 'Unknown mode.', status: 400 };
  if (mode === 'auto' && !autoAllowed(type)) return { error: 'This type is never fixed automatically: choose "AI prepares, I approve".', status: 400 };
  if (!RULE_SCOPES[scope]) return { error: 'Unknown scope.', status: 400 };
  const max = Math.max(1, Math.min(50, Math.round(Number(daily_max) || 5)));
  const n = ['email', 'bell', 'none'].includes(notify) ? notify : 'email';
  await db.prepare(`INSERT INTO seo_rules (type, mode, scope, daily_max, notify, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (type) DO UPDATE SET mode = excluded.mode, scope = excluded.scope, daily_max = excluded.daily_max, notify = excluded.notify, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(type, mode, scope, max, n, admin.name, iso()).run();
  await logAdminAction(db, admin, 'seo_rule', `SEO Scanner automation: "${info(type).name}" → ${mode === 'off' ? 'off' : mode === 'auto' ? 'AI fixes automatically' : 'AI prepares, Super Admin approves'} (${RULE_SCOPES[scope]}; at most ${max} a day; notify: ${n})`);
  return { ok: true };
}
async function inScope(db, rule, issue) {
  if (rule.scope === 'all') return true;
  if (rule.scope === 'news') return /^\/news\//.test(issue.path || '');
  const p = await pageOf(db, issue.path);
  const when = p?.data?.published || p?.lastmod;
  return !!when && Date.now() - Date.parse(when) < 7 * 864e5;
}
/** For the new issues of a scan: prepare (and, where allowed, apply) fixes according to the rules. */
export async function runRules(env, fresh) {
  const db = env.DB;
  const rules = new Map((await listRules(db)).filter(r => r.mode !== 'off').map(r => [r.type, r]));
  if (!rules.size || !fresh.length) return { prepared: 0, applied: 0 };
  const dayStart = new Date(Date.parse(`${lagosDay()}T00:00:00Z`) - 3600e3).toISOString();
  const done = { prepared: [], applied: [], skipped: [] };
  for (const i of fresh) {
    const rule = rules.get(i.type);
    if (!rule || !(await inScope(db, rule, i))) continue;
    const today = (await db.prepare(`SELECT COUNT(*) AS n FROM seo_fixes WHERE auto = 1 AND type = ? AND created_at >= ?`).bind(i.type, dayStart).first()).n;
    if (today >= rule.daily_max) { done.skipped.push(i.id); continue; }
    const open = await db.prepare(`SELECT 1 FROM seo_fixes WHERE issue_id = ? AND status IN ('proposed', 'applied') AND created_at >= ?`).bind(i.id, new Date(Date.now() - 2 * 864e5).toISOString()).first();
    if (open) continue;
    const prep = await prepareFix(env, null, i.id, { auto: true });
    if (prep.error || !prep.fix) { done.skipped.push(i.id); continue; }
    if (rule.mode === 'auto' && autoAllowed(i.type) && prep.fix.status === 'proposed') {
      const a = await applyFix(env, null, prep.fix.id, { auto: true });
      if (a.ok) done.applied.push({ type: i.type, path: i.path, notify: rule.notify }); else done.skipped.push(i.id);
    } else if (prep.fix.status === 'proposed') done.prepared.push({ type: i.type, path: i.path, notify: rule.notify });
  }
  const mail = [...done.prepared, ...done.applied].filter(x => x.notify === 'email');
  if (mail.length && env.RESEND_API_KEY) {
    const to = await alertRecipients(env);
    const li = x => `<li>${escapeHtml(info(x.type).name)}${x.path ? ` on ${escapeHtml(x.path)}` : ''}</li>`;
    if (to.length) await sendEmail(env, { to, subject: `SEO Scanner: ${done.applied.length} fixed automatically, ${done.prepared.length} waiting for approval`,
      html: `${done.applied.length ? `<p><b>Fixed automatically</b> (each can be undone in SEO Scanner › History):</p><ul>${done.applied.filter(x => x.notify === 'email').map(li).join('')}</ul>` : ''}${done.prepared.length ? `<p><b>Prepared, waiting for your approval:</b></p><ul>${done.prepared.filter(x => x.notify === 'email').map(li).join('')}</ul>` : ''}<p><a href="${SITE}/admin/seo/">Open the SEO Scanner</a></p>` }).catch(err => console.error('[seo] rules email', err));
  }
  return { prepared: done.prepared.length, applied: done.applied.length, skipped: done.skipped.length };
}

/** Mark as ignored (with a reason) or bring back. */
export async function ignoreIssue(db, admin, id, reason, undo = false) {
  const r = await db.prepare(`SELECT type, path, status FROM seo_issues WHERE id = ?`).bind(id).first();
  if (!r) return { error: 'Not found.', status: 404 };
  if (undo) {
    await db.prepare(`UPDATE seo_issues SET status = 'open', ignored_reason = NULL, ignored_by = NULL WHERE id = ?`).bind(id).run();
    await logAdminAction(db, admin, 'seo_ignore', `SEO Scanner: "${info(r.type).name}"${r.path ? ` on ${r.path}` : ''} no longer ignored`);
    return { ok: true };
  }
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 3) return { error: 'Say why it is being ignored (for the others).', status: 400 };
  await db.prepare(`UPDATE seo_issues SET status = 'ignored', ignored_reason = ?, ignored_by = ? WHERE id = ?`).bind(why, admin.name, id).run();
  await logAdminAction(db, admin, 'seo_ignore', `SEO Scanner: ignored "${info(r.type).name}"${r.path ? ` on ${r.path}` : ''}: ${why}`);
  return { ok: true };
}
export { setSeoSetting };
