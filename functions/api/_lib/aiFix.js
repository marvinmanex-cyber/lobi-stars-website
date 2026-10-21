// AI Fix: turns the Analytics recommendations (worked out in code, no AI) into
// fixes. Each recommendation type has a category (auto_fix / input_needed /
// manual_only), a risk and at most one fix action from FIX_ACTIONS: the ONLY
// things AI Fix can do. Claude is called only when a fix is being prepared,
// with the few facts that fix needs (what staff type is cleaned of emails and
// phone numbers first), and the same facts never twice (data_hash).
// Claude's JSON is checked (claude.js) and then applied by our own code.
// Every step is written to ai_fix_log (Fix history); applied fixes are measured
// before and after (ai_fix_results, Fix results).
import { ensureAiSchema, getAiSettings, saveAiSetting, callClaude, submitBatch, pollBatches, extractJson, validateJson, cleanText,
  scrubPersonal, logFix, aiEmail, estimateCost, modelFor, monthSpend, mockFromSchema } from './claude.js';
import { currentInsights } from './analyticsInsights.js';
import { startSync } from './analyticsSync.js';
import { githubReady, getFile, putFile, deleteFile } from './github.js';
import { logAdminAction } from './adminSession.js';
import { metricFor, verdict } from './aiMetrics.js';

const SITE = env => String(env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');
const CLUB = 'You help the staff of Lobi Stars FC, a Nigerian professional football club from Makurdi, Benue State ("Pride of Benue"). Website: lobistarsfc.com. Write in clear British English for Nigerian fans. Never invent facts, scores, quotes, prices or dates: use only what you are given.';
const DAY = 864e5;

// ── Categories (one row per recommendation type; see docs/ai-fix.md) ──
export const REC_TYPES = {
  'setup:gsc': { category: 'manual_only', risk: 'low', fix: null, minutes: 15 },
  'setup:stale': { category: 'auto_fix', risk: 'low', fix: 'rerun_sync', minutes: 1 },
  ctr: { category: 'auto_fix', risk: 'normal', fix: 'seo_title_description', minutes: 5 },
  rank: { category: 'input_needed', risk: 'normal', fix: 'draft_news', minutes: 15 },
  index: { category: 'manual_only', risk: 'low', fix: null, minutes: 10 },
  'trend:gsc-down': { category: 'manual_only', risk: 'low', fix: null, minutes: 20 },
  'ux:mobile': { category: 'manual_only', risk: 'high', fix: null, minutes: 30, code: true },
  eng: { category: 'manual_only', risk: 'high', fix: null, minutes: 30, code: true },
  funnel: { category: 'manual_only', risk: 'high', fix: null, minutes: 30 },
  'grow:newsletter': { category: 'input_needed', risk: 'low', fix: 'draft_newsletter_blurb', minutes: 5 },
  'grow:social': { category: 'input_needed', risk: 'low', fix: 'draft_social_post', minutes: 5 },
  'grow:diaspora': { category: 'input_needed', risk: 'low', fix: 'draft_social_post', minutes: 5 },
};
export const typeOf = id => (REC_TYPES[id] ? id : String(id).split(':')[0]);
export const typeInfo = id => REC_TYPES[typeOf(id)] || { category: 'manual_only', risk: 'normal', fix: null, minutes: 15 };
const PRIO = { high: 300, medium: 200, low: 100 };

export async function sha(s) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...b.slice(0, 12)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 70).replace(/-$/, '');
export const lagosDate = (ms = Date.now()) => new Date(ms + 3600e3).toISOString().slice(0, 10);
const yamlStr = s => JSON.stringify(String(s)); // JSON strings are valid YAML

/** The page's live title and description (from the published page). */
export async function liveSeo(env, path) {
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

/** A news file in the content editor's format, always status Draft. */
export function newsDraftMarkdown({ title, summary, body, category = 'First Team', contentType = null, matchDate = null }) {
  return ['---', `title: ${yamlStr(title)}`, `summary: ${yamlStr(summary)}`, `category: ${yamlStr(category)}`, 'coverImage: /images/lobi-stars-badge.png', 'imageAlt: "Lobi Stars FC badge"',
    `publishedAt: ${new Date().toISOString()}`, 'isVideo: false', 'videoUrl: ""', 'videoDuration: ""', 'isFeatured: false', 'isBanner: false', 'status: "draft"', 'author: "Lobi Stars FC Media"',
    ...(contentType ? [`contentType: ${yamlStr(contentType)}`] : []), ...(matchDate ? [`matchDate: ${matchDate}`] : []), '---', '', body, ''].join('\n');
}
/** Saves a news draft; returns { path, commit, hash } (hash: to warn on Undo if it was edited since). */
export async function saveNewsDraft(env, proposal, message, extra = {}) {
  const name = `${lagosDate()}-${slugify(proposal.title) || 'ai-draft'}`.slice(0, 100);
  const path = `src/content/news/${name}.md`;
  if (await getFile(env, path)) throw new Error('A news file with this name already exists. Change the headline (Edit) and try again.');
  const md = newsDraftMarkdown({ ...proposal, ...extra });
  const commit = await putFile(env, path, md, message);
  return { path, commit, hash: await sha(md) };
}
/** Undo of a news draft: refuses if published; warns (unless force) if edited since. */
export async function undoNewsDraft(env, applied, force) {
  const f = await getFile(env, applied.path);
  if (!f) return;
  if (!/status:\s*"?draft"?/.test(f.text)) throw new Error('This article has been published since: unpublish or delete it in the content editor instead.');
  if (!force && applied.hash && (await sha(f.text)) !== applied.hash) return { editedSince: true, message: 'Someone has edited this draft since it was saved. Undo anyway? Their changes would be lost.' };
  await deleteFile(env, applied.path, `AI Fix: remove the draft ${applied.path}`, f.sha);
}

// ── The fix actions (whitelist) ──
// gather: facts(), the minimum Claude needs. input: what staff type (input_needed).
// preview: how the proposal is shown. apply(): our own code makes the change and returns
// the backup that undo() needs. verify(): is the change live? factual: contains facts
// staff must check (never auto-applied, "check the facts" banner). longForm: may use
// the advanced model if a Super Admin chooses it. targetEmpty(): auto-apply only when
// the thing being changed is currently empty.
export const FIX_ACTIONS = {
  rerun_sync: {
    label: 'Run the Google figures sync again', claude: false, risk: 'low', preview: 'action',
    targetEmpty: async () => true, // nothing is overwritten
    describe: () => ({ summary: 'Starts the daily Google Search Console and GA4 sync now (the same as Admin › Analytics › Sync now).' }),
    apply: async (env, rec, proposal, admin) => { const r = await startSync(env, { trigger: 'manual', by: `AI Fix (${admin?.name || 'Automatic'})` }); return { started: !r?.error, note: r?.error || 'Sync started' }; },
  },
  seo_title_description: {
    label: 'New Google title and description', claude: true, maxTokens: 300, needsGithub: true, preview: 'seo',
    schema: { title: { type: 'string', min: 20, max: 60 }, description: { type: 'string', min: 70, max: 155 } },
    facts: async (env, rec, ins) => {
      const path = rec.id.slice(4);
      const page = ins.f.gsc.pages.find(p => p.path === path) || {};
      const live = await liveSeo(env, path);
      return { path, currentTitle: live.title, currentDescription: live.description, googleImpressions28d: page.impressions || 0, googleClicks28d: page.clicks || 0,
        averagePosition: Math.round((page.position || 0) * 10) / 10, topSearchPhrasesForTheSite: ins.f.gsc.queries.slice(0, 5).map(q => q.value) };
    },
    before: facts => ({ title: facts.currentTitle, description: facts.currentDescription }),
    targetEmpty: async (env, rec) => { const l = await liveSeo(env, rec.id.slice(4)); return !l.title && !l.description; },
    system: `${CLUB} You write page titles and descriptions for Google search results.`,
    prompt: facts => `Write a better Google title and meta description for this page so more people click it in search results.\nRules: title at most 60 characters, starts with what the fan is looking for, ends with "| Lobi Stars FC" if it fits; description 70-155 characters with a concrete reason to click. No prices or dates unless they appear in the facts.\nFacts: ${JSON.stringify(facts)}`,
    apply: async (env, rec, proposal) => {
      const path = rec.id.slice(4), file = await getFile(env, 'src/data/seo.json');
      let data = {}; try { data = file ? JSON.parse(file.text) : {}; } catch { data = {}; }
      const previous = data[path] || null;
      data[path] = { title: proposal.title, description: proposal.description, by: 'AI Fix', at: new Date().toISOString() };
      const commit = await putFile(env, 'src/data/seo.json', JSON.stringify(data, null, 2) + '\n', `AI Fix: Google title and description for ${path}`, file?.sha);
      return { path, previous, written: { title: proposal.title, description: proposal.description }, commit };
    },
    undo: async (env, rec, applied, force) => {
      const file = await getFile(env, 'src/data/seo.json');
      let data = {}; try { data = file ? JSON.parse(file.text) : {}; } catch { data = {}; }
      const now = data[applied.path];
      if (!force && applied.written && now && (now.title !== applied.written.title || now.description !== applied.written.description)) {
        return { editedSince: true, message: 'The Google title or description of this page was changed again since AI Fix applied it. Undo anyway? The newer change would be replaced by the old wording.' };
      }
      if (applied.previous) data[applied.path] = applied.previous; else delete data[applied.path];
      await putFile(env, 'src/data/seo.json', JSON.stringify(data, null, 2) + '\n', `AI Fix: undo the Google title and description for ${applied.path}`, file?.sha);
    },
    verifyLive: async (env, rec, applied, proposal) => (await liveSeo(env, applied.path)).title === proposal.title,
  },
  draft_news: {
    label: 'Draft a news article (saved as Draft)', claude: true, maxTokens: 1200, needsGithub: true, preview: 'news', factual: true, longForm: true, allowNeeds: true,
    input: { label: 'The facts for the story (who, what, when; quotes only if real)', min: 40, max: 1500 },
    schema: { title: { type: 'string', min: 15, max: 90 }, summary: { type: 'string', min: 40, max: 200 }, body: { type: 'string', min: 300, max: 4000, multiline: true } },
    facts: async (env, rec, ins, input) => {
      const q = ins.f.gsc.queries.find(x => x.value === rec.id.slice(5)) || {};
      return { searchPhrase: rec.id.slice(5), averagePosition: Math.round((q.position || 0) * 10) / 10, staffFacts: input?.text || '', usefulPages: ['/tickets/', '/fixtures/', '/news/', '/membership/'] };
    },
    system: `${CLUB} You draft club news articles for the media team to check before publishing.`,
    prompt: facts => `Write a short club news article (250-450 words) that uses the exact phrase "${facts.searchPhrase}" in the title and first paragraph. Use ONLY the staff facts below. The body is Markdown (paragraphs, at most one subheading, one link to a useful page on the site written as [text](/path/)). No HTML.\nFacts: ${JSON.stringify(facts)}`,
    apply: (env, rec, proposal) => saveNewsDraft(env, proposal, `AI Fix: draft news article "${proposal.title}" (Draft, not published)`)
      .then(r => ({ ...r, note: 'Saved as a Draft in News. Check it, add a photo and publish it in the content editor.' })),
    undo: (env, rec, applied, force) => undoNewsDraft(env, applied, force),
  },
  draft_social_post: {
    label: 'Draft social media posts (to copy)', claude: true, maxTokens: 500, copyOnly: true, preview: 'copy', factual: true, risk: 'low',
    input: { label: 'Anything to mention (optional): a story, an offer, a match', min: 0, max: 600, optional: true },
    schema: { whatsapp: { type: 'string', min: 40, max: 600, multiline: true }, facebook: { type: 'string', min: 40, max: 600, multiline: true }, x: { type: 'string', min: 20, max: 280 } },
    facts: async (env, rec, ins, input) => ({ goal: rec.id === 'grow:diaspora' ? 'Reach Lobi Stars supporters living abroad (give kick-off in Nigeria time and mention Watch Live and live commentary on the website)' : 'Bring more fans from WhatsApp and social media to the website',
      nextMatch: await nextMatch(env), staffNote: input?.text || '', links: { tickets: `${SITE(env)}/tickets/`, fixtures: `${SITE(env)}/fixtures/`, watch: `${SITE(env)}/watch/`, news: `${SITE(env)}/news/` } }),
    system: `${CLUB} You draft short social media and newsletter text for the media team.`,
    prompt: facts => `Write three short posts, each with ONE link from the facts: a WhatsApp Channel post, a Facebook post and an X post (at most 280 characters). Friendly and proud, at most two emoji each, no hashtag spam (at most two).\nFacts: ${JSON.stringify(facts)}`,
  },
  draft_newsletter_blurb: {
    label: 'Draft a newsletter sign-up message (to copy)', claude: true, maxTokens: 250, copyOnly: true, preview: 'copy', factual: true, risk: 'low',
    input: { label: 'What do subscribers get? (e.g. early ticket news, exclusive photos)', min: 10, max: 400 },
    schema: { blurb: { type: 'string', min: 60, max: 300 } },
    facts: async (env, rec, ins, input) => ({ benefits: input?.text || '', signUpLink: `${SITE(env)}/newsletter/` }),
    system: `${CLUB} You draft short social media and newsletter text for the media team.`,
    prompt: facts => `Write one short paragraph (at most 300 characters) to put at the end of news articles, inviting fans to join the club newsletter, with the sign-up link. Use only the benefits given.\nFacts: ${JSON.stringify(facts)}`,
  },
};
/** Fix types that may use the advanced model (long writing); everything else is always cheap. */
export const LONG_FORM_TYPES = Object.entries(FIX_ACTIONS).filter(([, f]) => f.longForm).map(([k]) => k);

/**
 * Auto-apply rule: ONLY when switched on, low risk, in the allowed list, the
 * thing being changed is currently empty, the proposal passed its checks, and it
 * contains no facts for a person to check. Anything else waits for a Super Admin.
 */
export function canAutoApply({ enabled, risk, fixType, allowed, targetEmpty, valid, factual }) {
  return !!(enabled && risk === 'low' && allowed.includes(fixType) && targetEmpty === true && valid === true && !factual);
}

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
const setMetaStmt = (db, id, fields, by = 'Automatic') => {
  const keys = Object.keys(fields);
  return db.prepare(`UPDATE ai_recommendation_meta SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ?, updated_by = ? WHERE rec_id = ?`)
    .bind(...keys.map(k => fields[k]), new Date().toISOString(), by, id);
};
const setMeta = (db, id, fields, by) => setMetaStmt(db, id, fields, by).run();
const parse = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** Everything for the AI Fix page and the Analytics buttons. */
export async function listFixes(env) {
  const ins = await currentInsights(env);
  await syncMeta(env, ins.out.recs);
  const { results } = await env.DB.prepare(`SELECT * FROM ai_recommendation_meta WHERE present = 1 OR status IN ('applied', 'awaiting_approval', 'preparing') ORDER BY present DESC, priority_score DESC`).all();
  const recs = new Map(ins.out.recs.map(r => [r.id, r]));
  return results.map(m => {
    const fx = m.fix_type ? FIX_ACTIONS[m.fix_type] : null, t = typeInfo(m.rec_id);
    return { id: m.rec_id, type: m.rec_type, title: m.title, category: m.category, risk: m.risk, status: m.status, priority: m.priority_score, minutes: m.estimated_minutes, present: !!m.present,
      code: !!t.code,
      fix: fx ? { type: m.fix_type, label: fx.label, claude: fx.claude, copyOnly: !!fx.copyOnly, input: fx.input || null, needsGithub: !!fx.needsGithub, githubReady: githubReady(env),
        undo: !!fx.undo, preview: fx.preview, factual: !!fx.factual, schema: fx.schema || null } : null,
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
/** Staff text: control characters out, emails and phone numbers removed (never sent to Claude). */
export const cleanInput = (fx, input) => {
  if (!fx.input) return { value: null };
  const raw = String(input?.text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, fx.input.max);
  const text = scrubPersonal(raw);
  if (!fx.input.optional && text.length < fx.input.min) return { error: `Please type at least ${fx.input.min} characters: ${fx.input.label}.` };
  return { value: { text, scrubbed: text !== raw } };
};
const NOTE_MAX = 300;

/**
 * Prepares one fix now (normal API, the person waits). input: what staff typed;
 * note: "Try again with a note" (always asks Claude again).
 */
export async function prepareFix(env, id, admin, { input = null, note = '', force = false } = {}) {
  const db = env.DB;
  const { ins, rec } = await findRec(env, id);
  if (!rec) return { error: 'This recommendation is no longer shown on Analytics.' };
  const t = typeInfo(id);
  if (t.category === 'manual_only' || !t.fix) return { error: 'This one can only be done by a person: follow the steps.' };
  const fx = FIX_ACTIONS[t.fix];
  const m = await metaRow(db, id);
  const inp = cleanInput(fx, input ?? parse(m?.input_json));
  if (inp.error) return { error: inp.error };
  if (!fx.claude) {
    const proposal = fx.describe();
    await setMeta(db, id, { status: 'awaiting_approval', proposal_json: JSON.stringify(proposal), error: null }, admin?.name);
    await logFix(db, { recId: id, fixType: t.fix, action: 'prepared', admin, after: proposal });
    return maybeAutoApply(env, id, admin);
  }
  const tryNote = scrubPersonal(String(note || '').trim()).slice(0, NOTE_MAX);
  const facts = await fx.facts(env, rec, ins, inp.value);
  const hash = await sha(JSON.stringify([t.fix, facts]));
  if (!force && !tryNote && m?.data_hash === hash && m.proposal_json && ['awaiting_approval', 'failed', 'undone', 'open', 'awaiting_input'].includes(m.status)) {
    await setMeta(db, id, { status: 'awaiting_approval', error: null }, admin?.name);
    return { ok: true, cached: true };
  }
  await setMeta(db, id, { status: 'preparing', input_json: inp.value ? JSON.stringify(inp.value) : null }, admin?.name);
  const prompt = fx.prompt(facts) + (tryNote ? `\nStaff note for this new try: ${tryNote}` : '');
  const r = await callClaude(env, { feature: 'fix', taskType: t.fix, system: fx.system, prompt, schema: fx.schema, maxTokens: fx.maxTokens, adminId: admin?.id, relatedId: id, allowNeeds: !!fx.allowNeeds });
  if (!r.ok) { await setMeta(db, id, { status: 'failed', error: r.error }, admin?.name); await logFix(db, { recId: id, fixType: t.fix, action: 'failed', admin, detail: r.error }); return { error: r.error }; }
  if (r.needs) {
    // Claude didn't have enough facts: ask the staff instead of inventing.
    await setMeta(db, id, { status: 'awaiting_input', input_json: JSON.stringify({ ...(inp.value || {}), question: r.needs }), error: null }, admin?.name);
    await logFix(db, { recId: id, fixType: t.fix, action: 'needs_input', admin, detail: r.needs });
    return { ok: true, needs: r.needs };
  }
  const proposal = { ...r.data, ...(fx.before ? { before: fx.before(facts) } : {}), ...(tryNote ? { note: tryNote } : {}), ...(r.mock ? { mock: true } : {}) };
  await setMeta(db, id, { status: 'awaiting_approval', proposal_json: JSON.stringify(proposal), data_hash: hash, error: null }, admin?.name);
  await logFix(db, { recId: id, fixType: t.fix, action: tryNote ? 'retried' : 'prepared', admin, detail: tryNote || (inp.value?.scrubbed ? 'emails/phone numbers removed from the input' : null), after: proposal });
  return maybeAutoApply(env, id, admin);
}
async function maybeAutoApply(env, id, admin) {
  const db = env.DB, s = await getAiSettings(db), t = typeInfo(id), fx = FIX_ACTIONS[t.fix];
  const m = await metaRow(db, id);
  const proposal = parse(m?.proposal_json);
  const valid = fx.schema ? !validateJson(fx.schema, proposal).error : !!proposal;
  const targetEmpty = fx.targetEmpty ? await fx.targetEmpty(env, { id }) : false;
  const ok = canAutoApply({ enabled: s.auto_apply_enabled === '1', risk: t.risk, fixType: t.fix, allowed: String(s.auto_apply_types || '').split(/[\s,]+/).filter(Boolean), targetEmpty, valid, factual: !!fx.factual });
  if (ok) return applyFix(env, id, admin, { auto: true });
  return { ok: true };
}

/** Edit: staff change Claude's proposal before applying (checked like Claude's answer). */
export async function editFix(env, id, admin, changes) {
  const db = env.DB, m = await metaRow(db, id);
  if (!m || m.status !== 'awaiting_approval') return { error: 'There is no prepared fix to edit.' };
  const fx = FIX_ACTIONS[m.fix_type];
  if (!fx?.schema) return { error: 'This fix has nothing to edit.' };
  const old = parse(m.proposal_json) || {};
  const merged = { ...old };
  for (const k of Object.keys(fx.schema)) if (typeof changes?.[k] === 'string') merged[k] = changes[k];
  const v = validateJson(fx.schema, merged);
  if (v.error) return { error: `Not saved: ${v.error}.` };
  const proposal = { ...old, ...v.value, edited: true };
  await setMeta(db, id, { proposal_json: JSON.stringify(proposal) }, admin?.name);
  await logFix(db, { recId: id, fixType: m.fix_type, action: 'edited', admin, before: old, after: proposal });
  return { ok: true };
}

/** Applies the prepared fix (Super Admin approved it, or auto-apply). Backup first; figures measured. */
export async function applyFix(env, id, admin, { auto = false } = {}) {
  const db = env.DB, m = await metaRow(db, id);
  if (!m) return { error: 'Not found.' };
  if (m.status !== 'awaiting_approval') return { error: 'There is no prepared fix waiting for approval.' };
  const fx = FIX_ACTIONS[m.fix_type];
  if (!fx) return { error: 'Unknown fix.' };
  const proposal = parse(m.proposal_json);
  if (fx.schema) { const v = validateJson(fx.schema, proposal); if (v.error) return { error: `The prepared fix is not valid (${v.error}).` }; }
  if (fx.needsGithub && !githubReady(env)) return { error: 'Changing website content needs the GitHub token (GITHUB_TOKEN, handover A29). Until then, copy the text and make the change in the content editor.' };
  let applied;
  try {
    applied = fx.copyOnly ? { note: 'Text copied and used by staff' } : await fx.apply(env, { id }, proposal, admin);
  } catch (err) {
    await setMeta(db, id, { status: 'failed', error: String(err.message || err).slice(0, 300) }, admin?.name);
    await logFix(db, { recId: id, fixType: m.fix_type, action: 'failed', admin, detail: String(err.message || err) });
    return { error: String(err.message || err) };
  }
  const at = new Date().toISOString();
  const appliedJson = { ...applied, at, by: admin?.name || 'Automatic', auto };
  // Measure the figure this recommendation is about now (Fix results: again at 14 and 30 days).
  let before = null;
  try { before = metricFor(id, (await currentInsights(env)).f); } catch { before = null; }
  // One batch: status, log line and the results row are saved together.
  await db.batch([
    setMetaStmt(db, id, { status: 'applied', applied_json: JSON.stringify(appliedJson), error: null }, admin?.name),
    db.prepare(`INSERT INTO ai_fix_log (rec_id, fix_type, action, admin_id, admin_name, detail, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, m.fix_type, auto ? 'auto_applied' : 'applied', admin?.id || 'system', admin?.name || 'Automatic', fx.label, JSON.stringify(applied.previous ?? (fx.before ? proposal.before ?? null : null)), JSON.stringify(proposal), at),
    db.prepare(`INSERT INTO ai_fix_results (rec_id, fix_type, title, applied_at, metric, before_json) VALUES (?, ?, ?, ?, ?, ?)`).bind(id, m.fix_type, m.title, at, before?.metric || null, before ? JSON.stringify(before) : null),
  ]);
  await logAdminAction(db, admin || { id: 'system', name: 'Automatic' }, 'ai_fix_applied', `${auto ? 'Auto-applied' : 'Applied'} AI fix "${fx.label}" for ${id}`);
  return { ok: true, applied };
}
/** Undo: restores the backup. If the item was edited since, asks first (force to go ahead). */
export async function undoFix(env, id, admin, { force = false } = {}) {
  const db = env.DB, m = await metaRow(db, id);
  if (!m || !['applied', 'verified', 'failed'].includes(m.status) || !m.applied_json) return { error: 'Nothing to undo.' };
  const fx = FIX_ACTIONS[m.fix_type];
  try {
    const r = fx?.undo ? await fx.undo(env, { id }, parse(m.applied_json) || {}, force) : null;
    if (r?.editedSince) return { error: r.message, editedSince: true };
    await setMeta(db, id, { status: 'undone' }, admin?.name);
    await logFix(db, { recId: id, fixType: m.fix_type, action: 'undone', admin, detail: force ? 'undone although edited since' : null, before: parse(m.proposal_json), after: parse(m.applied_json)?.previous ?? null });
    await logAdminAction(db, admin, 'ai_fix_undone', `Undid AI fix "${fx?.label}" for ${id}`);
    return { ok: true };
  } catch (err) { return { error: String(err.message || err) }; }
}
export async function setStatus(env, id, status, admin) {
  if (!['dismissed', 'open'].includes(status)) return { error: 'Unknown action.' };
  const m = await metaRow(env.DB, id);
  if (!m) return { error: 'Not found.' };
  await setMeta(env.DB, id, { status: status === 'open' ? (m.category === 'input_needed' ? 'awaiting_input' : 'open') : 'dismissed' }, admin?.name);
  await logFix(env.DB, { recId: id, fixType: m.fix_type, action: status === 'open' ? 'reopened' : 'dismissed', admin });
  return { ok: true };
}
/** Bulk review: apply or discard several prepared fixes at once. */
export async function applyMany(env, ids, admin, action) {
  const done = [], failed = [];
  for (const id of (Array.isArray(ids) ? ids : []).slice(0, 100)) {
    const r = action === 'apply' ? await applyFix(env, String(id), admin) : await setStatus(env, String(id), 'dismissed', admin);
    (r.error ? failed : done).push(r.error ? { id, error: r.error } : id);
  }
  return { ok: true, done: done.length, failed };
}

// ── Batches: "Fix all" and the weekly check-up ──
/**
 * What "Fix all" would send, grouped by fix type, with the estimated cost at
 * batch price. Nothing is sent and no AI is used.
 */
export async function planAll(env, { types = null, limit = null } = {}) {
  const db = env.DB, s = await getAiSettings(db);
  const ins = await currentInsights(env);
  await syncMeta(env, ins.out.recs);
  const max = Math.min(100, Math.max(1, limit || Number(s.max_items_per_batch) || 50));
  const items = [], direct = [], cached = [], groups = {};
  const recs = [...ins.out.recs].sort((a, b) => ((PRIO[b.priority] || 0) - (PRIO[a.priority] || 0)) || ((b.score || 0) - (a.score || 0)));
  for (const rec of recs) {
    const t = typeInfo(rec.id), fx = t.fix && FIX_ACTIONS[t.fix];
    if (!fx || t.category !== 'auto_fix' || (types && !types.includes(t.fix))) continue;
    const m = await metaRow(db, rec.id);
    if (['preparing', 'awaiting_approval', 'applied', 'verified', 'dismissed'].includes(m?.status)) continue;
    if (!fx.claude) { direct.push(rec.id); continue; }
    const facts = await fx.facts(env, rec, ins, null);
    const hash = await sha(JSON.stringify([t.fix, facts]));
    if (m?.data_hash === hash && m.proposal_json) { cached.push(rec.id); continue; }
    if (items.length >= max) continue;
    const prompt = fx.prompt(facts), model = modelFor(env, s, 'batch_fix', t.fix);
    const cost = estimateCost(s, model, prompt.length + fx.system.length, fx.maxTokens, true);
    items.push({ customId: `r${items.length}-${hash.slice(0, 8)}`, system: fx.system, prompt, schema: fx.schema, maxTokens: fx.maxTokens, allowNeeds: !!fx.allowNeeds,
      meta: { recId: rec.id, fixType: t.fix, hash, before: fx.before ? fx.before(facts) : null }, cost });
    const g = (groups[t.fix] ||= { type: t.fix, label: fx.label, count: 0, cost: 0 });
    g.count++; g.cost += cost;
  }
  const cost = items.reduce((n, it) => n + it.cost, 0);
  return { items, direct, cached, groups: Object.values(groups).map(g => ({ ...g, cost: Math.round(g.cost * 1e5) / 1e5 })), cost: Math.round(cost * 1e5) / 1e5, count: items.length };
}
/** Sends the plan in one Message Batch (half price; results within 24 hours; email when ready). */
export async function prepareAll(env, admin, feature = 'batch_fix', opts = {}) {
  const db = env.DB;
  const plan = await planAll(env, opts);
  for (const id of plan.direct) await prepareFix(env, id, admin);
  for (const id of plan.cached) await setMeta(db, id, { status: 'awaiting_approval' });
  if (!plan.items.length) return { ok: true, sent: 0, direct: plan.direct.length, cached: plan.cached.length, cost: 0 };
  const r = await submitBatch(env, { feature, items: plan.items, createdBy: admin?.name || 'Automatic' });
  if (!r.ok) return { error: r.error };
  for (const it of plan.items) await setMeta(db, it.meta.recId, { status: 'preparing', error: null }, admin?.name);
  await logFix(db, { action: 'batch_sent', admin, detail: `${plan.items.length} fix(es) sent to Claude in one batch (estimated $${plan.cost.toFixed(4)})` });
  return { ok: true, sent: plan.items.length, direct: plan.direct.length, cached: plan.cached.length, cost: plan.cost, groups: plan.groups };
}
/** Stores each batch answer (checked like any other) as a fix waiting for approval. */
export async function onBatchResult(env, { item, text, ok, error, mock }) {
  const db = env.DB, fx = FIX_ACTIONS[item.fixType];
  if (!fx) return;
  if (!ok) { await setMeta(db, item.recId, { status: 'failed', error: `Claude: ${error}` }); return; }
  const parsed = mock ? mockFromSchema(fx.schema) : extractJson(text);
  if (fx.allowNeeds && parsed && typeof parsed.needs === 'string' && parsed.needs.trim()) {
    await setMeta(db, item.recId, { status: 'awaiting_input', input_json: JSON.stringify({ question: cleanText(parsed.needs).slice(0, 300) }) });
    return;
  }
  const v = validateJson(fx.schema, parsed);
  if (v.error) { await setMeta(db, item.recId, { status: 'failed', error: `Claude's answer could not be used (${v.error}). Press "Prepare fix" to try again.` }); return; }
  await setMeta(db, item.recId, { status: 'awaiting_approval', proposal_json: JSON.stringify({ ...v.value, ...(item.before ? { before: item.before } : {}), ...(mock ? { mock: true } : {}) }), data_hash: item.hash, error: null });
  await logFix(db, { recId: item.recId, fixType: item.fixType, action: 'prepared', detail: 'from the batch' });
}
/** Collects finished batches; emails the Super Admins when fixes are ready to review. */
export async function runBatchPoll(env) {
  let ready = 0;
  const r = await pollBatches(env, async res => { await onBatchResult(env, res); ready++; });
  if (r.finished && ready) {
    await aiEmail(env, { kind: 'batch_ready', subject: `AI Fix: ${ready} fix${ready === 1 ? ' is' : 'es are'} ready to review`,
      html: `<p>Claude has prepared <b>${ready}</b> fix${ready === 1 ? '' : 'es'} for the website. Nothing has changed yet.</p><p>Open <a href="${SITE(env)}/admin/ai/">Admin › AI Fix</a> to check them and press Apply (or tick several and press Apply selected).</p>` });
  }
  return { ...r, ready };
}

// ── Checking applied fixes ──
/**
 * Verify: an applied fix is "verified" when its recommendation no longer shows
 * (the Analytics rule is run again), and "failed" if the change never went live
 * (2 days) or the recommendation still shows after 30 days.
 */
export async function verifyApplied(env, { now = Date.now() } = {}) {
  const db = env.DB;
  const { results } = await db.prepare(`SELECT * FROM ai_recommendation_meta WHERE status = 'applied' LIMIT 30`).all();
  if (!results.length) return { verified: 0, failed: 0 };
  const recs = new Set((await currentInsights(env)).out.recs.map(r => r.id));
  let verified = 0, failed = 0;
  for (const m of results) {
    const fx = FIX_ACTIONS[m.fix_type], applied = parse(m.applied_json) || {}, age = now - Date.parse(applied.at || m.updated_at);
    let next = null, why = null;
    if (fx?.verifyLive && !(await fx.verifyLive(env, { id: m.rec_id }, applied, parse(m.proposal_json) || {}))) {
      if (age > 2 * DAY) { next = 'failed'; why = 'The change is not showing on the live website after 2 days.'; }
    } else if (!recs.has(m.rec_id)) { next = 'verified'; why = 'The Analytics recommendation no longer shows.'; }
    else if (age > 30 * DAY) { next = 'failed'; why = 'The recommendation still shows 30 days after the fix.'; }
    if (!next) continue;
    await setMeta(db, m.rec_id, { status: next, error: next === 'failed' ? why : null });
    await logFix(db, { recId: m.rec_id, fixType: m.fix_type, action: next, detail: why });
    next === 'verified' ? verified++ : failed++;
  }
  return { verified, failed };
}
/** Fix results: measure applied fixes again at 14 and 30 days. */
export async function recheckResults(env, { now = Date.now() } = {}) {
  const db = env.DB;
  const { results } = await db.prepare(`SELECT * FROM ai_fix_results WHERE (after14_at IS NULL AND applied_at <= ?) OR (after30_at IS NULL AND applied_at <= ?) LIMIT 30`)
    .bind(new Date(now - 14 * DAY).toISOString(), new Date(now - 30 * DAY).toISOString()).all();
  if (!results.length) return 0;
  const f = (await currentInsights(env)).f, at = new Date(now).toISOString();
  for (const r of results) {
    const m = metricFor(r.rec_id, f), before = parse(r.before_json);
    if (!r.after14_at) await db.prepare(`UPDATE ai_fix_results SET after14_json = ?, after14_at = ?, verdict = ? WHERE id = ?`).bind(JSON.stringify(m), at, verdict(before, m), r.id).run();
    else await db.prepare(`UPDATE ai_fix_results SET after30_json = ?, after30_at = ?, verdict = ? WHERE id = ?`).bind(JSON.stringify(m), at, verdict(before, m), r.id).run();
  }
  return results.length;
}

// ── Weekly check-up ──
/** The current Lagos week, e.g. "2026-42". */
export const lagosWeek = (ms = Date.now()) => { const d = new Date(ms + 3600e3); return `${d.getUTCFullYear()}-${Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / (7 * DAY))}`; };
/**
 * Weekly (AI Settings: day and time, Lagos), once a week only: check applied fixes,
 * prepare the top 20 automatic fixes in one batch, apply the eligible ones,
 * and email the Super Admins a summary with this month's spend.
 */
export async function weeklyScan(env, { now = Date.now() } = {}) {
  const db = env.DB, s = await getAiSettings(db);
  const lagos = new Date(now + 3600e3), week = lagosWeek(now);
  if (String(lagos.getUTCDay()) !== String(s.weekly_scan_day) || lagos.toISOString().slice(11, 16) < (s.weekly_scan_time || '07:00') || s.last_scan_week === week) return null;
  // Claim the week first, so two timer calls at the same moment can't both run it.
  const claim = await db.prepare(`INSERT INTO ai_settings (key, value, updated_at, updated_by) VALUES ('last_scan_week', ?, ?, 'Automatic')
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE ai_settings.value IS NOT excluded.value`).bind(week, new Date(now).toISOString()).run();
  if (!claim.meta?.changes) return null;
  const checked = await verifyApplied(env, { now });
  const r = s.auto_apply_enabled === '1' ? await prepareAll(env, null, 'weekly_scan', { limit: Math.min(20, Number(s.max_items_per_batch) || 20) }) : { skipped: 'auto-apply off', sent: 0, direct: 0 };
  const { spent } = await monthSpend(db);
  const open = (await db.prepare(`SELECT status, COUNT(*) AS n FROM ai_recommendation_meta WHERE present = 1 GROUP BY status`).all()).results;
  const count = st => open.find(x => x.status === st)?.n || 0;
  await aiEmail(env, { kind: 'weekly_summary', subject: `AI Fix weekly check-up: ${r.sent || 0} sent to Claude, ${count('awaiting_approval')} waiting for you`,
    html: `<p>This week's AI Fix check-up:</p><ul>
      <li>${r.sent || 0} fix${r.sent === 1 ? '' : 'es'} sent to Claude in one batch (half price)${r.cost ? `, estimated $${r.cost.toFixed(4)}` : ''}; ${r.direct || 0} automatic fix${r.direct === 1 ? '' : 'es'} done without AI.</li>
      <li>${count('awaiting_approval')} waiting for your approval; ${count('awaiting_input')} need a few words from you.</li>
      <li>Checked applied fixes: ${checked.verified} verified, ${checked.failed} failed.</li>
      <li>AI spend this month: <b>$${spent.toFixed(2)}</b> of $${Number(s.monthly_budget) || 0}.</li></ul>
      <p><a href="${SITE(env)}/admin/ai/">Open AI Fix</a></p>` });
  return { week, checked, ...r };
}

/**
 * Dry run (scripts/ai-dry-run.mjs): what the weekly check-up would do right now
 * and what it would cost. No AI is used and nothing changes.
 */
export async function dryRun(env) {
  const db = env.DB, s = await getAiSettings(db);
  const plan = await planAll(env, { limit: Math.min(20, Number(s.max_items_per_batch) || 20) });
  const auto = [];
  for (const id of plan.direct) {
    const t = typeInfo(id), fx = FIX_ACTIONS[t.fix];
    const ok = canAutoApply({ enabled: s.auto_apply_enabled === '1', risk: t.risk, fixType: t.fix, allowed: String(s.auto_apply_types || '').split(/[\s,]+/).filter(Boolean),
      targetEmpty: fx.targetEmpty ? await fx.targetEmpty(env, { id }) : false, valid: true, factual: !!fx.factual });
    auto.push({ id, fix: fx.label, autoApply: ok });
  }
  return {
    dryRun: true, wouldSendToClaude: plan.items.map(it => ({ id: it.meta.recId, fix: FIX_ACTIONS[it.meta.fixType].label, estimatedCost: Math.round(it.cost * 1e5) / 1e5 })),
    groups: plan.groups, estimatedCost: plan.cost, withoutAi: auto, alreadyPrepared: plan.cached,
    note: 'Batch price (half the normal price). Nothing was sent and nothing changed.',
  };
}

// ── History and results pages ──
export async function listHistory(env, { action = '', fixType = '', who = '', from = '', to = '', q = '', limit = 200 } = {}) {
  const db = env.DB;
  await ensureAiSchema(db);
  const where = [], args = [];
  if (action) { where.push('action = ?'); args.push(action); }
  if (fixType) { where.push('fix_type = ?'); args.push(fixType); }
  if (who) { where.push('admin_name = ?'); args.push(who); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('created_at >= ?'); args.push(new Date(Date.parse(`${from}T00:00:00+01:00`)).toISOString()); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push('created_at < ?'); args.push(new Date(Date.parse(`${to}T00:00:00+01:00`) + DAY).toISOString()); }
  if (q) { where.push('(LOWER(rec_id) LIKE ? OR LOWER(detail) LIKE ?)'); args.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`); }
  const { results } = await db.prepare(`SELECT * FROM ai_fix_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).bind(...args, Math.min(500, limit)).all();
  const people = (await db.prepare(`SELECT DISTINCT admin_name FROM ai_fix_log ORDER BY admin_name`).all()).results.map(r => r.admin_name);
  return { rows: results.map(r => ({ ...r, before: parse(r.before_json), after: parse(r.after_json), before_json: undefined, after_json: undefined })), people, fixTypes: Object.entries(FIX_ACTIONS).map(([id, f]) => ({ id, label: f.label })) };
}
export async function listResults(env) {
  const db = env.DB;
  await ensureAiSchema(db);
  const { results } = await db.prepare(`SELECT * FROM ai_fix_results ORDER BY id DESC LIMIT 200`).all();
  return results.map(r => ({ id: r.id, recId: r.rec_id, fixType: r.fix_type, label: FIX_ACTIONS[r.fix_type]?.label || r.fix_type, title: r.title, appliedAt: r.applied_at,
    before: parse(r.before_json), after14: parse(r.after14_json), after14At: r.after14_at, after30: parse(r.after30_json), after30At: r.after30_at, verdict: r.verdict }));
}
