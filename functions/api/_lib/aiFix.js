// AI Fix: turns the Analytics recommendations (worked out in code, no AI) into
// fixes. Each recommendation type has a category (auto_fix / input_needed /
// manual_only), a risk and at most one fix action from FIX_ACTIONS: the ONLY
// things AI Fix can do. Claude is called only when a fix is being prepared,
// with the few facts that fix needs, and the same facts never twice (data_hash).
// Claude's JSON is checked (claude.js) and then applied by our own code.
import { ensureAiSchema, getAiSettings, saveAiSetting, callClaude, submitBatch, pollBatches, extractJson, validateJson } from './claude.js';
import { currentInsights } from './analyticsInsights.js';
import { startSync } from './analyticsSync.js';
import { githubReady, getFile, putFile, deleteFile } from './github.js';
import { logAdminAction } from './adminSession.js';

const SITE = env => String(env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');
const CLUB = 'You help the staff of Lobi Stars FC, a Nigerian professional football club from Makurdi, Benue State ("Pride of Benue"). Website: lobistarsfc.com. Write in clear British English for Nigerian fans. Never invent facts, scores, quotes, prices or dates: use only what you are given.';

// ── Categories (one row per recommendation type; see docs/ai-fix.md) ──
export const REC_TYPES = {
  'setup:gsc': { category: 'manual_only', risk: 'low', fix: null, minutes: 15 },
  'setup:stale': { category: 'auto_fix', risk: 'low', fix: 'rerun_sync', minutes: 1 },
  ctr: { category: 'auto_fix', risk: 'normal', fix: 'seo_title_description', minutes: 5 },
  rank: { category: 'input_needed', risk: 'normal', fix: 'draft_news', minutes: 15 },
  index: { category: 'manual_only', risk: 'low', fix: null, minutes: 10 },
  'trend:gsc-down': { category: 'manual_only', risk: 'low', fix: null, minutes: 20 },
  'ux:mobile': { category: 'manual_only', risk: 'high', fix: null, minutes: 30 },
  eng: { category: 'manual_only', risk: 'high', fix: null, minutes: 30 },
  funnel: { category: 'manual_only', risk: 'high', fix: null, minutes: 30 },
  'grow:newsletter': { category: 'input_needed', risk: 'low', fix: 'draft_newsletter_blurb', minutes: 5 },
  'grow:social': { category: 'input_needed', risk: 'low', fix: 'draft_social_post', minutes: 5 },
  'grow:diaspora': { category: 'input_needed', risk: 'low', fix: 'draft_social_post', minutes: 5 },
};
export const typeOf = id => (REC_TYPES[id] ? id : String(id).split(':')[0]);
export const typeInfo = id => REC_TYPES[typeOf(id)] || { category: 'manual_only', risk: 'normal', fix: null, minutes: 15 };
const PRIO = { high: 300, medium: 200, low: 100 };

async function sha(s) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...b.slice(0, 12)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 70).replace(/-$/, '');
const lagosDate = (ms = Date.now()) => new Date(ms + 3600e3).toISOString().slice(0, 10);
const yamlStr = s => JSON.stringify(String(s)); // JSON strings are valid YAML

/** The page's live title and description (from the published page). */
async function liveSeo(env, path) {
  try {
    const html = await (await fetch(SITE(env) + path, { signal: AbortSignal.timeout(10000) })).text();
    const t = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
    const d = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [])[1] || '';
    const un = s => s.replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    return { title: un(t), description: un(d) };
  } catch { return { title: '', description: '' }; }
}
async function nextMatch(env) {
  try {
    const e = await env.DB.prepare(`SELECT home_team, away_team, competition, event_date, venue FROM events WHERE active = 1 AND event_date > ? ORDER BY event_date LIMIT 1`).bind(new Date().toISOString()).first();
    if (!e) return null;
    return { match: `${e.home_team} vs ${e.away_team}`, competition: e.competition || '', kickoffLagos: new Date(Date.parse(e.event_date) + 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' (Nigeria time, WAT)', venue: e.venue || '' };
  } catch { return null; }
}

// ── The fix actions (whitelist) ──
// facts(): the minimum Claude needs. input: what staff must type (input_needed).
// apply(): our own code makes the change; returns what Undo needs. copyOnly: nothing on the website changes.
export const FIX_ACTIONS = {
  rerun_sync: {
    label: 'Run the Google figures sync again', claude: false, risk: 'low',
    describe: () => ({ summary: 'Starts the daily Google Search Console and GA4 sync now (the same as Admin › Analytics › Sync now).' }),
    apply: async (env, rec, proposal, admin) => { const r = await startSync(env, { trigger: 'manual', by: `AI Fix (${admin?.name || 'Automatic'})` }); return { started: !r?.error, note: r?.error || 'Sync started' }; },
  },
  seo_title_description: {
    label: 'New Google title and description', claude: true, maxTokens: 300, needsGithub: true,
    schema: { title: { type: 'string', min: 20, max: 60 }, description: { type: 'string', min: 70, max: 155 } },
    facts: async (env, rec, ins) => {
      const path = rec.id.slice(4);
      const page = ins.f.gsc.pages.find(p => p.path === path) || {};
      const live = await liveSeo(env, path);
      return { path, currentTitle: live.title, currentDescription: live.description, googleImpressions28d: page.impressions || 0, googleClicks28d: page.clicks || 0,
        averagePosition: Math.round((page.position || 0) * 10) / 10, topSearchPhrasesForTheSite: ins.f.gsc.queries.slice(0, 5).map(q => q.value) };
    },
    system: CLAUDE_SEO(),
    prompt: facts => `Write a better Google title and meta description for this page so more people click it in search results.\nRules: title at most 60 characters, starts with what the fan is looking for, ends with "| Lobi Stars FC" if it fits; description 70-155 characters with a concrete reason to click. No prices or dates unless they appear in the facts.\nFacts: ${JSON.stringify(facts)}`,
    apply: async (env, rec, proposal) => {
      const path = rec.id.slice(4), file = await getFile(env, 'src/data/seo.json');
      let data = {}; try { data = file ? JSON.parse(file.text) : {}; } catch { data = {}; }
      const previous = data[path] || null;
      data[path] = { title: proposal.title, description: proposal.description, by: 'AI Fix', at: new Date().toISOString() };
      const commit = await putFile(env, 'src/data/seo.json', JSON.stringify(data, null, 2) + '\n', `AI Fix: Google title and description for ${path}`, file?.sha);
      return { path, previous, commit };
    },
    undo: async (env, rec, applied) => {
      const file = await getFile(env, 'src/data/seo.json');
      let data = {}; try { data = file ? JSON.parse(file.text) : {}; } catch { data = {}; }
      if (applied.previous) data[applied.path] = applied.previous; else delete data[applied.path];
      await putFile(env, 'src/data/seo.json', JSON.stringify(data, null, 2) + '\n', `AI Fix: undo the Google title and description for ${applied.path}`, file?.sha);
    },
    verify: async (env, rec, applied, proposal) => (await liveSeo(env, applied.path)).title === proposal.title,
  },
  draft_news: {
    label: 'Draft a news article (saved as Draft)', claude: true, maxTokens: 1200, needsGithub: true,
    input: { label: 'The facts for the story (who, what, when; quotes only if real)', min: 40, max: 1500 },
    schema: { title: { type: 'string', min: 15, max: 90 }, summary: { type: 'string', min: 40, max: 200 }, body: { type: 'string', min: 300, max: 4000, multiline: true } },
    facts: async (env, rec, ins, input) => {
      const q = ins.f.gsc.queries.find(x => x.value === rec.id.slice(5)) || {};
      return { searchPhrase: rec.id.slice(5), averagePosition: Math.round((q.position || 0) * 10) / 10, staffFacts: input?.text || '', usefulPages: ['/tickets/', '/fixtures/', '/news/', '/membership/'] };
    },
    system: CLAUDE_NEWS(),
    prompt: facts => `Write a short club news article (250-450 words) that uses the exact phrase "${facts.searchPhrase}" in the title and first paragraph. Use ONLY the staff facts below; if they are thin, keep it short. The body is Markdown (paragraphs, at most one subheading, one link to a useful page on the site written as [text](/path/)). No HTML.\nFacts: ${JSON.stringify(facts)}`,
    apply: async (env, rec, proposal) => {
      const name = `${lagosDate()}-${slugify(proposal.title) || 'ai-draft'}`.slice(0, 100);
      const path = `src/content/news/${name}.md`;
      if (await getFile(env, path)) throw new Error('A news file with this name already exists.');
      const md = ['---', `title: ${yamlStr(proposal.title)}`, `summary: ${yamlStr(proposal.summary)}`, 'category: "First Team"', 'coverImage: /images/lobi-stars-badge.png', 'imageAlt: "Lobi Stars FC badge"',
        `publishedAt: ${new Date().toISOString()}`, 'isVideo: false', 'videoUrl: ""', 'videoDuration: ""', 'isFeatured: false', 'isBanner: false', 'status: "draft"', 'author: "Lobi Stars FC Media"', '---', '', proposal.body, ''].join('\n');
      const commit = await putFile(env, path, md, `AI Fix: draft news article "${proposal.title}" (Draft, not published)`);
      return { path, commit, note: 'Saved as a Draft in News. Check it, add a photo and publish it in the content editor.' };
    },
    undo: async (env, rec, applied) => {
      const f = await getFile(env, applied.path);
      if (!f) return;
      if (!/status:\s*"?draft"?/.test(f.text)) throw new Error('This article has been published since: unpublish or delete it in the content editor instead.');
      await deleteFile(env, applied.path, `AI Fix: remove the draft ${applied.path}`, f.sha);
    },
  },
  draft_social_post: {
    label: 'Draft social media posts (to copy)', claude: true, maxTokens: 500, copyOnly: true,
    input: { label: 'Anything to mention (optional): a story, an offer, a match', min: 0, max: 600, optional: true },
    schema: { whatsapp: { type: 'string', min: 40, max: 600, multiline: true }, facebook: { type: 'string', min: 40, max: 600, multiline: true }, x: { type: 'string', min: 20, max: 280 } },
    facts: async (env, rec, ins, input) => ({ goal: rec.id === 'grow:diaspora' ? 'Reach Lobi Stars supporters living abroad (give kick-off in Nigeria time and mention Watch Live and live commentary on the website)' : 'Bring more fans from WhatsApp and social media to the website',
      nextMatch: await nextMatch(env), staffNote: input?.text || '', links: { tickets: `${SITE(env)}/tickets/`, fixtures: `${SITE(env)}/fixtures/`, watch: `${SITE(env)}/watch/`, news: `${SITE(env)}/news/` } }),
    system: CLAUDE_SOCIAL(),
    prompt: facts => `Write three short posts, each with ONE link from the facts: a WhatsApp Channel post, a Facebook post and an X post (at most 280 characters). Friendly and proud, at most two emoji each, no hashtag spam (at most two).\nFacts: ${JSON.stringify(facts)}`,
  },
  draft_newsletter_blurb: {
    label: 'Draft a newsletter sign-up message (to copy)', claude: true, maxTokens: 250, copyOnly: true,
    input: { label: 'What do subscribers get? (e.g. early ticket news, exclusive photos)', min: 10, max: 400 },
    schema: { blurb: { type: 'string', min: 60, max: 300 } },
    facts: async (env, rec, ins, input) => ({ benefits: input?.text || '', signUpLink: `${SITE(env)}/newsletter/` }),
    system: CLAUDE_SOCIAL(),
    prompt: facts => `Write one short paragraph (at most 300 characters) to put at the end of news articles, inviting fans to join the club newsletter, with the sign-up link. Use only the benefits given.\nFacts: ${JSON.stringify(facts)}`,
  },
};
function CLAUDE_SEO() { return `${CLUB} You write page titles and descriptions for Google search results.`; }
function CLAUDE_NEWS() { return `${CLUB} You draft club news articles for the media team to check before publishing.`; }
function CLAUDE_SOCIAL() { return `${CLUB} You draft short social media and newsletter text for the media team.`; }

// ── Recommendation rows ──
/** Brings ai_recommendation_meta in line with the recommendations shown now. */
export async function syncMeta(env, recs) {
  const db = env.DB;
  await ensureAiSchema(db);
  const now = new Date().toISOString();
  const stmts = recs.map(r => {
    const t = typeInfo(r.id);
    return db.prepare(`INSERT INTO ai_recommendation_meta (rec_id, rec_type, title, category, risk, fix_type, priority_score, estimated_minutes, status, present, last_checked_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT (rec_id) DO UPDATE SET title = excluded.title, category = excluded.category, risk = excluded.risk, fix_type = excluded.fix_type, priority_score = excluded.priority_score,
        estimated_minutes = excluded.estimated_minutes, present = 1, last_checked_at = excluded.last_checked_at,
        status = CASE WHEN ai_recommendation_meta.status IN ('dismissed', 'undone', 'verified') AND ai_recommendation_meta.present = 0 THEN 'open' ELSE ai_recommendation_meta.status END`)
      .bind(r.id, typeOf(r.id), r.title, t.category, t.risk, t.fix, (PRIO[r.priority] || 100) + Math.min(99, Math.round(Math.log10((r.score || 0) + 1) * 30)), t.minutes,
        t.category === 'input_needed' ? 'awaiting_input' : 'open', now, now);
  });
  const ids = recs.map(r => r.id);
  stmts.push(db.prepare(`UPDATE ai_recommendation_meta SET present = 0 WHERE rec_id NOT IN (${ids.map(() => '?').join(',') || "''"})`).bind(...ids));
  for (let i = 0; i < stmts.length; i += 40) await db.batch(stmts.slice(i, i + 40));
}
const metaRow = (db, id) => db.prepare(`SELECT * FROM ai_recommendation_meta WHERE rec_id = ?`).bind(id).first();
const setMeta = (db, id, fields, by = 'Automatic') => {
  const keys = Object.keys(fields);
  return db.prepare(`UPDATE ai_recommendation_meta SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ?, updated_by = ? WHERE rec_id = ?`)
    .bind(...keys.map(k => fields[k]), new Date().toISOString(), by, id).run();
};
const parse = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** Everything for the AI Fix page. */
export async function listFixes(env) {
  const ins = await currentInsights(env);
  await syncMeta(env, ins.out.recs);
  const { results } = await env.DB.prepare(`SELECT * FROM ai_recommendation_meta WHERE present = 1 OR status IN ('applied', 'awaiting_approval', 'preparing') ORDER BY present DESC, priority_score DESC`).all();
  const recs = new Map(ins.out.recs.map(r => [r.id, r]));
  return results.map(m => {
    const fx = m.fix_type ? FIX_ACTIONS[m.fix_type] : null;
    return { id: m.rec_id, type: m.rec_type, title: m.title, category: m.category, risk: m.risk, status: m.status, priority: m.priority_score, minutes: m.estimated_minutes, present: !!m.present,
      fix: fx ? { type: m.fix_type, label: fx.label, claude: fx.claude, copyOnly: !!fx.copyOnly, input: fx.input || null, needsGithub: !!fx.needsGithub, githubReady: githubReady(env), undo: !!fx.undo } : null,
      finding: recs.get(m.rec_id)?.finding || '', steps: recs.get(m.rec_id)?.steps || [], link: recs.get(m.rec_id)?.link || null,
      input: parse(m.input_json), proposal: parse(m.proposal_json), applied: parse(m.applied_json), error: m.error, updatedAt: m.updated_at, updatedBy: m.updated_by };
  });
}

async function findRec(env, id) {
  const ins = await currentInsights(env);
  await syncMeta(env, ins.out.recs);
  const rec = ins.out.recs.find(r => r.id === id);
  return { ins, rec };
}
const cleanInput = (fx, input) => {
  if (!fx.input) return { value: null };
  const text = String(input?.text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, fx.input.max);
  if (!fx.input.optional && text.length < fx.input.min) return { error: `Please type at least ${fx.input.min} characters: ${fx.input.label}.` };
  return { value: { text } };
};

/** Prepares one fix now (normal API, the person waits). */
export async function prepareFix(env, id, admin, { input = null } = {}) {
  const db = env.DB;
  const { ins, rec } = await findRec(env, id);
  if (!rec) return { error: 'This recommendation is no longer shown on Analytics.' };
  const t = typeInfo(id);
  if (t.category === 'manual_only' || !t.fix) return { error: 'This one can only be done by a person: follow the steps.' };
  const fx = FIX_ACTIONS[t.fix];
  const inp = cleanInput(fx, input);
  if (inp.error) return { error: inp.error };
  const m = await metaRow(db, id);
  if (!fx.claude) {
    const proposal = fx.describe();
    await setMeta(db, id, { status: 'awaiting_approval', proposal_json: JSON.stringify(proposal), error: null }, admin?.name);
    return maybeAutoApply(env, id, admin);
  }
  const facts = await fx.facts(env, rec, ins, inp.value);
  const hash = await sha(JSON.stringify([t.fix, facts]));
  if (m?.data_hash === hash && m.proposal_json && ['awaiting_approval', 'failed', 'undone', 'open', 'awaiting_input'].includes(m.status)) {
    await setMeta(db, id, { status: 'awaiting_approval', error: null }, admin?.name);
    return { ok: true, cached: true };
  }
  await setMeta(db, id, { status: 'preparing', input_json: inp.value ? JSON.stringify(inp.value) : null }, admin?.name);
  const r = await callClaude(env, { feature: 'fix', system: fx.system, prompt: fx.prompt(facts), schema: fx.schema, maxTokens: fx.maxTokens, adminId: admin?.id, relatedId: id });
  if (!r.ok) { await setMeta(db, id, { status: 'failed', error: r.error }, admin?.name); return { error: r.error }; }
  const proposal = { ...r.data, before: fx.facts && t.fix === 'seo_title_description' ? { title: facts.currentTitle, description: facts.currentDescription } : undefined };
  await setMeta(db, id, { status: 'awaiting_approval', proposal_json: JSON.stringify(proposal), data_hash: hash, error: null }, admin?.name);
  return maybeAutoApply(env, id, admin);
}
async function maybeAutoApply(env, id, admin) {
  const s = await getAiSettings(env.DB), t = typeInfo(id);
  const types = String(s.auto_apply_types || '').split(/[\s,]+/).filter(Boolean);
  if (s.auto_apply_enabled === '1' && t.risk === 'low' && types.includes(t.fix)) return applyFix(env, id, admin, { auto: true });
  return { ok: true };
}

/** Applies the prepared fix (Super Admin approved it, or auto-apply). */
export async function applyFix(env, id, admin, { auto = false } = {}) {
  const db = env.DB, m = await metaRow(db, id);
  if (!m) return { error: 'Not found.' };
  if (m.status !== 'awaiting_approval') return { error: 'There is no prepared fix waiting for approval.' };
  const fx = FIX_ACTIONS[m.fix_type];
  if (!fx) return { error: 'Unknown fix.' };
  const proposal = parse(m.proposal_json);
  if (fx.schema) { const v = validateJson(fx.schema, proposal); if (v.error) return { error: `The prepared fix is not valid (${v.error}).` }; }
  if (fx.needsGithub && !githubReady(env)) return { error: 'Changing website content needs the GitHub token (GITHUB_TOKEN, handover A29). Until then, copy the text and make the change in the content editor.' };
  try {
    const applied = fx.copyOnly ? { note: 'Text copied and used by staff' } : await fx.apply(env, { id }, proposal, admin);
    await setMeta(db, id, { status: 'applied', applied_json: JSON.stringify({ ...applied, at: new Date().toISOString(), by: admin?.name || 'Automatic', auto }), error: null }, admin?.name);
    await logAdminAction(db, admin || { id: 'system', name: 'Automatic' }, 'ai_fix_applied', `${auto ? 'Auto-applied' : 'Applied'} AI fix "${fx.label}" for ${id}`);
    return { ok: true, applied };
  } catch (err) {
    await setMeta(db, id, { status: 'failed', error: String(err.message || err).slice(0, 300) }, admin?.name);
    return { error: String(err.message || err) };
  }
}
export async function undoFix(env, id, admin) {
  const db = env.DB, m = await metaRow(db, id);
  if (!m || !['applied', 'verified'].includes(m.status)) return { error: 'Nothing to undo.' };
  const fx = FIX_ACTIONS[m.fix_type];
  try {
    if (fx?.undo) await fx.undo(env, { id }, parse(m.applied_json) || {});
    await setMeta(db, id, { status: 'undone' }, admin?.name);
    await logAdminAction(db, admin, 'ai_fix_undone', `Undid AI fix "${fx?.label}" for ${id}`);
    return { ok: true };
  } catch (err) { return { error: String(err.message || err) }; }
}
export async function setStatus(env, id, status, admin) {
  if (!['dismissed', 'open'].includes(status)) return { error: 'Unknown action.' };
  const m = await metaRow(env.DB, id);
  if (!m) return { error: 'Not found.' };
  await setMeta(env.DB, id, { status: status === 'open' ? (m.category === 'input_needed' ? 'awaiting_input' : 'open') : 'dismissed' }, admin?.name);
  return { ok: true };
}

// ── Batches: "Prepare all" and the weekly scan ──
/** Prepares every fix that needs no typing, in one Message Batch (half price; ready within 24 hours). */
export async function prepareAll(env, admin, feature = 'batch_fix') {
  const db = env.DB, s = await getAiSettings(db);
  const ins = await currentInsights(env);
  await syncMeta(env, ins.out.recs);
  const max = Math.min(100, Math.max(1, Number(s.max_items_per_batch) || 50));
  const items = [], direct = [];
  for (const rec of ins.out.recs) {
    const t = typeInfo(rec.id), fx = t.fix && FIX_ACTIONS[t.fix];
    if (!fx || t.category !== 'auto_fix') continue;
    const m = await metaRow(db, rec.id);
    if (['preparing', 'awaiting_approval', 'applied', 'verified', 'dismissed'].includes(m?.status)) continue;
    if (!fx.claude) { direct.push(rec.id); continue; }
    const facts = await fx.facts(env, rec, ins, null);
    const hash = await sha(JSON.stringify([t.fix, facts]));
    if (m?.data_hash === hash && m.proposal_json) { await setMeta(db, rec.id, { status: 'awaiting_approval' }); continue; }
    items.push({ customId: `r${items.length}-${hash.slice(0, 8)}`, system: fx.system, prompt: fx.prompt(facts), schema: fx.schema, maxTokens: fx.maxTokens,
      meta: { recId: rec.id, fixType: t.fix, hash, before: t.fix === 'seo_title_description' ? { title: facts.currentTitle, description: facts.currentDescription } : null } });
    if (items.length >= max) break;
  }
  for (const id of direct) await prepareFix(env, id, admin);
  if (!items.length) return { ok: true, sent: 0, direct: direct.length };
  const r = await submitBatch(env, { feature, items, createdBy: admin?.name || 'Automatic' });
  if (!r.ok) return { error: r.error };
  for (const it of items) await setMeta(db, it.meta.recId, { status: 'preparing', error: null }, admin?.name);
  return { ok: true, sent: items.length, direct: direct.length };
}
/** Stores each batch answer (checked like any other) as a fix waiting for approval. */
export async function onBatchResult(env, { item, text, ok, error }) {
  const db = env.DB, fx = FIX_ACTIONS[item.fixType];
  if (!fx) return;
  if (!ok) { await setMeta(db, item.recId, { status: 'failed', error: `Claude: ${error}` }); return; }
  const v = validateJson(fx.schema, extractJson(text));
  if (v.error) { await setMeta(db, item.recId, { status: 'failed', error: `Claude's answer could not be used (${v.error}). Press "Prepare fix" to try again.` }); return; }
  await setMeta(db, item.recId, { status: 'awaiting_approval', proposal_json: JSON.stringify({ ...v.value, before: item.before || undefined }), data_hash: item.hash, error: null });
}

/** Weekly (AI Settings: day and time, Lagos): refresh, check applied fixes, run auto-fixes, batch the rest. */
export async function weeklyScan(env) {
  const db = env.DB, s = await getAiSettings(db);
  const lagos = new Date(Date.now() + 3600e3), week = `${lagos.getUTCFullYear()}-${Math.floor((lagos - Date.UTC(lagos.getUTCFullYear(), 0, 1)) / 6048e5)}`;
  if (String(lagos.getUTCDay()) !== String(s.weekly_scan_day) || lagos.toISOString().slice(11, 16) < (s.weekly_scan_time || '07:00') || s.last_scan_week === week) return null;
  await saveAiSetting(db, 'last_scan_week', week);
  const verified = await verifyApplied(env);
  const r = s.auto_apply_enabled === '1' ? await prepareAll(env, null, 'weekly_scan') : { skipped: 'auto-apply off' };
  return { week, verified, ...r };
}
/** Applied fixes whose change is now live become "verified". */
export async function verifyApplied(env) {
  const db = env.DB;
  const { results } = await db.prepare(`SELECT * FROM ai_recommendation_meta WHERE status = 'applied' LIMIT 20`).all();
  let n = 0;
  for (const m of results) {
    const fx = FIX_ACTIONS[m.fix_type];
    if (!fx?.verify) continue;
    if (await fx.verify(env, { id: m.rec_id }, parse(m.applied_json) || {}, parse(m.proposal_json) || {})) { await setMeta(db, m.rec_id, { status: 'verified' }); n++; }
  }
  return n;
}
export const runBatchPoll = env => pollBatches(env, res => onBatchResult(env, res));
