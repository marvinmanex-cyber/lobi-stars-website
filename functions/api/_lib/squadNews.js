// Squad Phase 7 (news): linking stories to players and staff.
//  1. Tag suggestions. Every 10 minutes the published stories (the site's news
//     and Media Centre stories) are scanned for current and former players'
//     and staff members' names and nicknames. A name found in a story that is
//     not tagged with that person becomes a suggestion ("Musa Adeyemi
//     mentioned in 'Lobi edge Kada Warriors': tag?") in Admin › Squad: Tag
//     suggestions. One click tags the story (the news file is updated, so the
//     story appears on the person's page after the site rebuilds) or dismisses it.
//  2. AI fact suggestions (optional; needs the Claude key). For stories tagged
//     with a player, Claude suggests up to 3 short facts about that player
//     taken only from the story ("Scored a late winner against Kada Warriors
//     on 18 Oct 2026"). Each goes to Squad: Approvals; only approved facts are
//     kept (squad_facts) and go to the media partner's Data Package. AI text
//     is never published on the website.
import { ensureProfileSchema, parseJson, getProfile } from './squadProfiles.js';
import { profileName, nameOf } from '../../../src/lib/squadFields.js';
import { githubReady, getFile, putFile, commitFiles } from './github.js';
import { newsMarkdown } from './mediaNews.js';
import { fileRow } from './mediaFiles.js';
import { callClaude, aiReady } from './claude.js';
import { mcSettings, setMcSetting } from './mediaCentre.js';

const RECENT_MS = 60 * 86400e3, EVERY_MS = 10 * 60e3, AI_PER_RUN = 2;
const nowIso = () => new Date().toISOString();

let ready = false;
export async function ensureNewsLinkSchema(db) {
  if (ready) return;
  await ensureProfileSchema(db);
  await db.batch([
    // (the same table as Squad: Approvals, in case the fact job runs first)
    db.prepare(`CREATE TABLE IF NOT EXISTS squad_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT, kind TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending', submitted_by TEXT, submitted_at TEXT NOT NULL, decided_by TEXT, decided_at TEXT, note TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS squad_tag_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, article_slug TEXT NOT NULL, article_title TEXT, mc_id TEXT,
      slug TEXT NOT NULL, kind TEXT NOT NULL, name TEXT, matched TEXT, status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL, decided_by TEXT, decided_at TEXT, error TEXT, UNIQUE (article_slug, slug))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS squad_fact_runs (article_slug TEXT NOT NULL, slug TEXT NOT NULL, ran_at TEXT NOT NULL, facts INTEGER NOT NULL DEFAULT 0, error TEXT, PRIMARY KEY (article_slug, slug))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS squad_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, person_key TEXT NOT NULL, slug TEXT, text TEXT NOT NULL, fact_date TEXT,
      source_slug TEXT, source_title TEXT, approved_by TEXT, approved_at TEXT NOT NULL)`),
  ]);
  ready = true;
}

// ── The stories ──
/** Published stories: the site's news (built list) and Media Centre stories already published. */
export async function publishedStories(env) {
  const out = new Map();
  try {
    const r = await env.ASSETS.fetch(new Request(`${env.SITE_URL || 'https://lobistarsfc.com'}/data/news-text.json`));
    if (r.ok) for (const a of await r.json()) out.set(a.slug, a);
  } catch { /* no built list (tests) */ }
  const mc = (await env.DB.prepare(`SELECT id, slug, live_json, published_at FROM mc_items WHERE kind = 'news' AND status = 'published' AND slug IS NOT NULL`).all().catch(() => ({ results: [] }))).results;
  for (const r of mc) {
    const v = parseJson(r.live_json, {});
    if (!out.has(r.slug)) out.set(r.slug, { slug: r.slug, title: v.headline, summary: v.summary, text: String(v.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000), players: v.players || [], staff: v.staff || [], publishedAt: r.published_at, mcId: r.id });
    else out.get(r.slug).mcId ||= r.id;
  }
  return [...out.values()];
}
/** Current and former players and staff with the names to look for (newest profile of each person). */
export async function people(db) {
  const rows = (await db.prepare(`SELECT id, person_id, type, public_slug, data_json, live_json, status FROM squad_profiles WHERE status IN ('LIVE', 'ON_LOAN', 'FORMER') AND public_slug IS NOT NULL ORDER BY season DESC`).all()).results;
  const seen = new Set(), out = [];
  for (const r of rows) {
    const key = r.person_id || r.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const d = parseJson(r.live_json, {})?.data || parseJson(r.data_json, {});
    const n = nameOf(d), name = profileName(d);
    if (!name) continue;
    const names = [...new Set([name, [n.firstName, n.surname].filter(Boolean).join(' ')].filter(x => x && x.includes(' ')))];
    if (d.nickname && String(d.nickname).trim().length >= 4) names.push(String(d.nickname).trim());
    out.push({ key, profileId: r.id, slug: r.public_slug, kind: r.type, name, names, current: r.status !== 'FORMER' });
  }
  return out;
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The name variant found in the text, or null (whole words, any case). */
export function mentioned(text, names) {
  for (const n of names) if (new RegExp(`(^|[^\\p{L}])${esc(n)}($|[^\\p{L}])`, 'iu').test(text)) return n;
  return null;
}

/** The scan: new tag suggestions for recent stories. */
export async function scanMentions(env, { now = Date.now() } = {}) {
  const db = env.DB;
  await ensureNewsLinkSchema(db);
  const stories = (await publishedStories(env)).filter(a => !a.publishedAt || now - Date.parse(a.publishedAt) <= RECENT_MS);
  const folk = await people(db);
  const known = new Set((await db.prepare(`SELECT article_slug || '|' || slug AS k FROM squad_tag_suggestions`).all()).results.map(r => r.k));
  let added = 0;
  for (const a of stories) {
    const text = `${a.title || ''} ${a.summary || ''} ${a.text || ''}`;
    for (const p of folk) {
      const tagged = (p.kind === 'player' ? a.players : a.staff) || [];
      if (tagged.includes(p.slug) || known.has(`${a.slug}|${p.slug}`)) continue;
      const hit = mentioned(text, p.names);
      if (!hit) continue;
      await db.prepare(`INSERT OR IGNORE INTO squad_tag_suggestions (article_slug, article_title, mc_id, slug, kind, name, matched, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(a.slug, String(a.title || a.slug).slice(0, 200), a.mcId || null, p.slug, p.kind, p.name, hit, new Date(now).toISOString()).run();
      known.add(`${a.slug}|${p.slug}`); added++;
    }
  }
  return { stories: stories.length, people: folk.length, suggested: added };
}

export async function listSuggestions(db, status = 'pending') {
  await ensureNewsLinkSchema(db);
  return (await db.prepare(`SELECT * FROM squad_tag_suggestions WHERE status = ? ORDER BY created_at DESC LIMIT 200`).bind(status).all()).results;
}

// ── Tagging a story (one click) ──
/** Adds `slug` to a front-matter list (players / staff), whichever way the list is written. */
export function addToFrontMatter(md, field, slug) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error('The story file has no front matter.');
  const nl = md.includes('\r\n') ? '\r\n' : '\n';
  let fm = m[1];
  const inline = fm.match(new RegExp(`^${field}:\\s*\\[(.*)\\]\\s*$`, 'm'));
  const block = fm.match(new RegExp(`^${field}:\\s*\\r?\\n((?:\\s+-\\s+.*\\r?\\n?)+)`, 'm'));
  const empty = fm.match(new RegExp(`^${field}:\\s*(null|~)?\\s*$`, 'm'));
  if (inline) {
    const items = inline[1].split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    if (items.includes(slug)) return md;
    fm = fm.replace(inline[0], `${field}: ${JSON.stringify([...items, slug])}`);
  } else if (block) {
    const items = [...block[1].matchAll(/-\s+["']?([^"'\r\n]+)["']?/g)].map(x => x[1].trim());
    if (items.includes(slug)) return md;
    fm = fm.replace(block[0], `${field}: ${JSON.stringify([...items, slug])}${nl}`);
  } else if (empty) fm = fm.replace(empty[0], `${field}: ${JSON.stringify([slug])}`);
  else fm = `${fm}${nl}${field}: ${JSON.stringify([slug])}`;
  return md.replace(m[1], fm.replace(/\r?\n$/, ''));
}
export async function decideSuggestion(env, admin, id, decision) {
  const db = env.DB;
  await ensureNewsLinkSchema(db);
  const s = await db.prepare(`SELECT * FROM squad_tag_suggestions WHERE id = ?`).bind(Number(id)).first();
  if (!s || s.status !== 'pending') return { error: 'This suggestion has already been decided.', status: 409 };
  const by = admin.name || admin.email;
  if (decision === 'dismiss') {
    await db.prepare(`UPDATE squad_tag_suggestions SET status = 'dismissed', decided_by = ?, decided_at = ? WHERE id = ?`).bind(by, nowIso(), s.id).run();
    return { ok: true };
  }
  if (decision !== 'tag') return { error: 'Unknown decision.' };
  if (!githubReady(env)) return { error: 'Tagging needs the GitHub connection (GITHUB_TOKEN in Cloudflare).' };
  const field = s.kind === 'player' ? 'players' : 'staff';
  const mc = s.mc_id ? await db.prepare(`SELECT * FROM mc_items WHERE id = ?`).bind(s.mc_id).first() : null;
  try {
    if (mc && mc.status === 'published') {
      // A Media Centre story: add the tag to its published version and write the news file again.
      const v = parseJson(mc.live_json, {});
      v[field] = [...new Set([...(v[field] || []), s.slug])];
      const paths = {};
      for (const fid of [...JSON.stringify(v).matchAll(/\/api\/media-file\/([a-z0-9_]{4,40})/g)].map(x => x[1])) { const f = await fileRow(db, fid); if (f?.committed_path) paths[fid] = f.committed_path.replace(/^public/, ''); }
      const tab = (await db.prepare(`SELECT tab FROM mc_categories WHERE name = ?`).bind(v.category).first().catch(() => null))?.tab || 'Team News';
      await commitFiles(env, [{ path: `src/content/news/${mc.slug}.md`, text: newsMarkdown(v, { slug: mc.slug, tab, publishedAt: mc.published_at, updatedAt: null, paths, mcId: mc.id }) }], `News: tagged ${s.name} in "${s.article_title}"`);
      const d = parseJson(mc.data_json, {}); d[field] = [...new Set([...(d[field] || []), s.slug])];
      await db.prepare(`UPDATE mc_items SET live_json = ?, data_json = ? WHERE id = ?`).bind(JSON.stringify(v), JSON.stringify(d), mc.id).run();
    } else {
      const path = `src/content/news/${s.article_slug}.md`;
      const f = await getFile(env, path);
      if (!f) return { error: 'The story file was not found (it may have been renamed or deleted).' };
      await putFile(env, path, addToFrontMatter(f.text, field, s.slug), `News: tagged ${s.name} in "${s.article_title}"`, f.sha);
    }
  } catch (e) {
    await db.prepare(`UPDATE squad_tag_suggestions SET error = ? WHERE id = ?`).bind(String(e?.message || e).slice(0, 300), s.id).run();
    return { error: `Could not tag the story: ${e?.message || e}` };
  }
  await db.prepare(`UPDATE squad_tag_suggestions SET status = 'tagged', decided_by = ?, decided_at = ?, error = NULL WHERE id = ?`).bind(by, nowIso(), s.id).run();
  return { ok: true, note: 'Tagged. The story appears on their page after the site rebuilds (about 3 minutes).' };
}

// ── AI fact suggestions ──
// The site's JSON check takes plain text fields: one fact per line, "YYYY-MM-DD | fact" (or just the fact).
const FACT_SCHEMA = { facts: { type: 'string', max: 900, multiline: true, optional: true } };
const FACT_SYSTEM = 'You pick short factual items about one football player from a Lobi Stars FC news story, for the club\'s media records. Use ONLY what the story says about that player: no guesses, no opinions, no praise, nothing about other people. Each fact is one plain sentence under 25 words, ideally with the date and opponent (e.g. "Scored a late winner against Kada Warriors on 18 Oct 2026"). Put up to 3 facts in "facts", one per line, each as "YYYY-MM-DD | fact" when the date is known, otherwise just the fact. Leave "facts" empty if the story says nothing concrete about the player.';
export async function suggestFacts(env, { now = Date.now() } = {}) {
  const db = env.DB;
  await ensureNewsLinkSchema(db);
  if (!aiReady(env)) return { skipped: 'no AI key' };
  const stories = (await publishedStories(env)).filter(a => (a.players || []).length && (!a.publishedAt || now - Date.parse(a.publishedAt) <= RECENT_MS));
  const done = new Set((await db.prepare(`SELECT article_slug || '|' || slug AS k FROM squad_fact_runs`).all()).results.map(r => r.k));
  const folk = new Map((await people(db)).filter(p => p.kind === 'player').map(p => [p.slug, p]));
  let ran = 0, facts = 0;
  for (const a of stories) {
    for (const slug of a.players) {
      if (ran >= AI_PER_RUN) return { ran, facts };
      const p = folk.get(slug);
      if (!p || done.has(`${a.slug}|${slug}`)) continue;
      ran++;
      const r = await callClaude(env, { feature: 'news_facts', system: FACT_SYSTEM, schema: FACT_SCHEMA, maxTokens: 400, relatedId: `news:${a.slug}`,
        prompt: `Player: ${p.name}\nStory published: ${a.publishedAt ? String(a.publishedAt).slice(0, 10) : 'unknown'}\nHeadline: ${a.title}\nSummary: ${a.summary || ''}\nStory: ${a.text}` });
      const list = r.ok ? String(r.data.facts || '').split(/\r?\n/).map(l => l.replace(/^[-•*\d.)\s]+(?=\d{4}-|[A-Za-z])/, '').trim()).filter(Boolean).slice(0, 3).map(l => {
        const m = l.match(/^(\d{4}-\d{2}-\d{2})\s*\|\s*(.+)$/);
        return { text: (m ? m[2] : l).replace(/\s+/g, ' ').trim().slice(0, 200), date: m ? m[1] : null };
      }).filter(f => f.text.length >= 10) : [];
      for (const f of list) {
        const payload = { fact: f.text, date: f.date, article: a.slug, articleTitle: a.title, slug, name: p.name, personKey: p.key,
          display: [['Suggested fact', f.text], ['Date', f.date || '–'], ['From the story', a.title], ['Note', 'Suggested by AI from the story. Approve only if it is correct; it then goes to the media records and the partner feed (never shown on the website).']] };
        await db.prepare(`INSERT INTO squad_requests (profile_id, kind, payload_json, submitted_by, submitted_at, status) VALUES (?, 'fact', ?, 'Claude (from a news story)', ?, 'pending')`).bind(p.profileId, JSON.stringify(payload), nowIso()).run();
        facts++;
      }
      await db.prepare(`INSERT OR REPLACE INTO squad_fact_runs (article_slug, slug, ran_at, facts, error) VALUES (?, ?, ?, ?, ?)`).bind(a.slug, slug, nowIso(), list.length, r.ok ? null : String(r.error || '').slice(0, 300)).run();
      done.add(`${a.slug}|${slug}`);
      if (!r.ok && r.budget) return { ran, facts, stopped: r.error };
    }
  }
  return { ran, facts };
}
/** Squad: Approvals: an approved fact is kept for the media records and the partner feed. */
export async function approveFact(env, admin, req, payload) {
  await ensureNewsLinkSchema(env.DB);
  await env.DB.prepare(`INSERT INTO squad_facts (person_key, slug, text, fact_date, source_slug, source_title, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(payload.personKey || String(req.profile_id), payload.slug || null, String(payload.fact || '').slice(0, 200), payload.date || null, payload.article || null, payload.articleTitle || null, admin.name || admin.email, nowIso()).run();
  return { ok: true };
}
export async function factsFor(db, personKeys) {
  await ensureNewsLinkSchema(db);
  const keys = [...new Set(personKeys.filter(Boolean))];
  if (!keys.length) return new Map();
  const rows = (await db.prepare(`SELECT * FROM squad_facts WHERE person_key IN (SELECT value FROM json_each(?)) ORDER BY COALESCE(fact_date, approved_at)`).bind(JSON.stringify(keys)).all()).results;
  const out = new Map();
  for (const r of rows) out.set(r.person_key, [...(out.get(r.person_key) || []), { text: r.text, date: r.fact_date || '', source: r.source_slug ? `https://lobistarsfc.com/news/${r.source_slug}/` : '' }]);
  return out;
}

/** The every-minute job (runs at most every 10 minutes). */
export async function newsLinkTick(env, { now = Date.now() } = {}) {
  const s = await mcSettings(env.DB);
  if (s.newslink_last && now - Date.parse(s.newslink_last) < EVERY_MS) return { skipped: true };
  await setMcSetting(env.DB, 'newslink_last', new Date(now).toISOString(), 'timer');
  const mentions = await scanMentions(env, { now });
  const facts = await suggestFacts(env, { now }).catch(e => ({ error: String(e?.message || e).slice(0, 200) }));
  return { mentions, facts };
}
export { getProfile };
