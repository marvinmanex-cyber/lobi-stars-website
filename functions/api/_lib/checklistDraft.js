// Match Checklist › "Draft with Claude" on writing tasks (match report,
// interviews, team news, preview posts, thank-you post). The match facts come
// from the fixtures and Live Match Control automatically; staff add anything
// else (real quotes only). Claude only drafts: a news text is saved as a DRAFT
// in News (never published), social posts are for copying. The task then moves
// to "submitted for review" for a Super Admin to tick. Emails and phone numbers
// typed in are removed before anything is sent.
import { callClaude, validateJson, scrubPersonal, logFix, ensureAiSchema } from './claude.js';
import { saveNewsDraft, sha, lagosDate } from './aiFix.js';
import { githubReady } from './github.js';
import { lagosDay } from './matchChecklist.js';

const CLUB = 'You help the media team of Lobi Stars FC, a Nigerian professional football club from Makurdi, Benue State ("Pride of Benue"). Write in clear British English for Nigerian fans. Never invent facts, scores, scorers, quotes, injuries or dates: use only the match facts and staff facts given.';
const NEWS_SCHEMA = { title: { type: 'string', min: 15, max: 90 }, summary: { type: 'string', min: 40, max: 200 }, body: { type: 'string', min: 250, max: 5000, multiline: true } };
const SOCIAL_SCHEMA = { whatsapp: { type: 'string', min: 40, max: 600, multiline: true }, facebook: { type: 'string', min: 40, max: 600, multiline: true }, x: { type: 'string', min: 20, max: 280 } };

/** The writing tasks (by seed task title) and what each produces. */
export const WRITING_TASKS = {
  'Match report published': { kind: 'news', contentType: 'Match Report', category: 'First Team', label: 'match report', ask: 'Anything the facts below don\'t show: key moments, how the team played, quotes (only real ones).',
    brief: 'Write a match report (300-500 words): result and scorers first, then the key moments in order, then what is next. Use the timeline and stats given. No quotes unless they are in the staff facts.' },
  'Post-match press conference / interviews': { kind: 'news', contentType: 'Reaction/Interview', category: 'First Team', label: 'reaction / interview post', ask: 'The real quotes, and who said them (coach, captain, player).',
    brief: 'Write a short reaction post (200-400 words) built around the quotes in the staff facts, with one line of context about the result. Quotes must be exactly as given.', needsQuotes: true },
  'Injury report': { kind: 'news', contentType: 'Team News', category: 'Team News', label: 'team news (injuries)', ask: 'Who is injured or doubtful, what the injury is, and when they may be back (only what the medical team has confirmed).',
    brief: 'Write a short team news update (150-350 words) about injuries and availability, only from the staff facts. Calm and factual; no medical guesses.' },
  'Social media countdown and preview posts': { kind: 'social', label: 'preview posts', ask: 'Anything to mention (optional): team news, ticket offers, kick-off reminders.',
    brief: 'Write three short preview posts for the coming match with the kick-off in Nigeria time and the ticket link.' },
  'Thank-you post for fans and sponsors': { kind: 'social', label: 'thank-you posts', ask: 'Anything to mention (optional): attendance, sponsors to thank by name, community moments.',
    brief: 'Write three short thank-you posts after the match: thank the fans (and sponsors if named in the staff facts), mention the result, and point to the next match.' },
};
export const writingTask = title => WRITING_TASKS[String(title || '')] || null;

let ready = false;
async function ensureTable(db) {
  if (ready) return;
  await ensureAiSchema(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS ai_checklist_drafts (task_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, facts_hash TEXT, staff_facts TEXT, question TEXT,
    proposal_json TEXT, saved_json TEXT, updated_at TEXT, updated_by TEXT)`).run();
  ready = true;
}
const parse = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** The match facts known to the website (fixtures + Live Match Control): no personal data. */
export async function matchFacts(env, matchId) {
  const db = env.DB;
  const e = await db.prepare(`SELECT * FROM events WHERE id = ?`).bind(matchId).first();
  if (!e) return null;
  let c = null;
  try { c = await db.prepare(`SELECT status, home_score, away_score, timeline_json, stats_json, report FROM match_centre WHERE event_id = ?`).bind(matchId).first(); } catch { c = null; }
  const tl = parse(c?.timeline_json);
  const site = String(env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');
  return {
    match: `${e.home_team} vs ${e.away_team}`, competition: e.competition || '', venue: e.venue || '',
    kickoffNigeriaTime: `${lagosDay(Date.parse(e.event_date))} ${new Date(Date.parse(e.event_date) + 3600e3).toISOString().slice(11, 16)} WAT`,
    status: c?.status || 'scheduled',
    score: c && c.home_score !== null && c.home_score !== undefined ? `${e.home_team} ${c.home_score}-${c.away_score} ${e.away_team}` : null,
    timeline: Array.isArray(tl) ? tl.slice(0, 40).map(x => ({ minute: x.minute, type: x.type, team: x.team === 'home' ? e.home_team : x.team === 'away' ? e.away_team : x.team, player: x.player || '', detail: x.detail || '' })) : [],
    stats: parse(c?.stats_json) || null,
    links: { tickets: `${site}/tickets/`, fixtures: `${site}/fixtures/`, watch: `${site}/watch/` },
  };
}

/** What the "Draft with Claude" box shows for a task. */
export async function draftInfo(env, task, matchId) {
  const w = writingTask(task.title);
  if (!w) return { available: false };
  await ensureTable(env.DB);
  const row = await env.DB.prepare(`SELECT * FROM ai_checklist_drafts WHERE task_id = ?`).bind(task.id).first();
  return { available: true, kind: w.kind, label: w.label, ask: w.ask, facts: await matchFacts(env, matchId), staffFacts: row?.staff_facts || '', question: row?.question || null,
    proposal: parse(row?.proposal_json), saved: parse(row?.saved_json), githubReady: githubReady(env), schema: w.kind === 'news' ? NEWS_SCHEMA : SOCIAL_SCHEMA };
}

/** Asks Claude for the draft (or a question about what is missing). */
export async function prepareDraft(env, admin, task, matchId, { staffFacts = '', note = '' } = {}) {
  const w = writingTask(task.title);
  if (!w) return { error: 'This task has no "Draft with Claude".' };
  await ensureTable(env.DB);
  const facts = await matchFacts(env, matchId);
  if (!facts) return { error: 'The match for this checklist was not found.' };
  const typed = scrubPersonal(String(staffFacts || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()).slice(0, 2000);
  const extra = scrubPersonal(String(note || '').trim()).slice(0, 300);
  if (w.needsQuotes && typed.length < 20) return { error: `Please type ${w.ask.charAt(0).toLowerCase() + w.ask.slice(1)}` };
  const schema = w.kind === 'news' ? NEWS_SCHEMA : SOCIAL_SCHEMA;
  const prompt = `${w.brief}${w.kind === 'news' ? ' The body is Markdown (paragraphs, at most one subheading). No HTML.' : ' Each post has ONE link from the facts; at most two emoji and two hashtags.'}${extra ? `\nStaff note for this try: ${extra}` : ''}\nMatch facts: ${JSON.stringify(facts)}\nStaff facts: ${typed || '(none)'}`;
  const r = await callClaude(env, { feature: 'checklist_draft', taskType: `checklist_${w.kind}`, system: CLUB, prompt, schema, maxTokens: w.kind === 'news' ? 1500 : 500, adminId: admin?.id, relatedId: `checklist:${task.id}`, allowNeeds: true });
  if (!r.ok) return { error: r.error };
  const now = new Date().toISOString();
  if (r.needs) {
    await env.DB.prepare(`INSERT INTO ai_checklist_drafts (task_id, kind, staff_facts, question, proposal_json, updated_at, updated_by) VALUES (?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT (task_id) DO UPDATE SET staff_facts = excluded.staff_facts, question = excluded.question, proposal_json = NULL, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(task.id, w.kind, typed, r.needs, now, admin?.name || null).run();
    await logFix(env.DB, { recId: `checklist:${task.id}`, fixType: `checklist_${w.kind}`, action: 'needs_input', admin, detail: r.needs });
    return { ok: true, needs: r.needs };
  }
  const proposal = { ...r.data, ...(r.mock ? { mock: true } : {}) };
  await env.DB.prepare(`INSERT INTO ai_checklist_drafts (task_id, kind, facts_hash, staff_facts, question, proposal_json, updated_at, updated_by) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT (task_id) DO UPDATE SET facts_hash = excluded.facts_hash, staff_facts = excluded.staff_facts, question = NULL, proposal_json = excluded.proposal_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(task.id, w.kind, await sha(JSON.stringify([facts, typed])), typed, JSON.stringify(proposal), now, admin?.name || null).run();
  await logFix(env.DB, { recId: `checklist:${task.id}`, fixType: `checklist_${w.kind}`, action: extra ? 'retried' : 'prepared', admin, detail: task.title, after: proposal });
  return { ok: true, proposal };
}

/**
 * Saves the (possibly edited) draft: news as a DRAFT in News (never published),
 * social posts as "used". Returns { saved }.
 */
export async function saveDraft(env, admin, task, matchId, edited) {
  const w = writingTask(task.title);
  if (!w) return { error: 'This task has no "Draft with Claude".' };
  await ensureTable(env.DB);
  const row = await env.DB.prepare(`SELECT * FROM ai_checklist_drafts WHERE task_id = ?`).bind(task.id).first();
  const base = parse(row?.proposal_json);
  if (!base) return { error: 'Write the draft with Claude first.' };
  const schema = w.kind === 'news' ? NEWS_SCHEMA : SOCIAL_SCHEMA;
  const merged = { ...base };
  for (const k of Object.keys(schema)) if (typeof edited?.[k] === 'string') merged[k] = edited[k];
  const v = validateJson(schema, merged);
  if (v.error) return { error: `Not saved: ${v.error}.` };
  let saved;
  if (w.kind === 'news') {
    if (!githubReady(env)) return { error: 'Saving a news draft needs the GitHub connection (GITHUB_TOKEN). Until then, copy the text into News yourself.' };
    const e = await env.DB.prepare(`SELECT event_date FROM events WHERE id = ?`).bind(matchId).first();
    saved = await saveNewsDraft(env, v.value, `Match Checklist: draft ${w.label} "${v.value.title}" (Draft, not published)`,
      { category: w.category, contentType: w.contentType, matchDate: e ? lagosDay(Date.parse(e.event_date)) : lagosDate() });
    saved.note = 'Saved as a Draft in News. Check it, add a photo and publish it in the content editor.';
  } else saved = { note: 'Posts copied and used.' };
  saved.at = new Date().toISOString(); saved.by = admin?.name || null;
  await env.DB.prepare(`UPDATE ai_checklist_drafts SET proposal_json = ?, saved_json = ?, updated_at = ?, updated_by = ? WHERE task_id = ?`)
    .bind(JSON.stringify({ ...v.value, ...(JSON.stringify(v.value) !== JSON.stringify(Object.fromEntries(Object.keys(schema).map(k => [k, base[k]]))) ? { edited: true } : {}) }), JSON.stringify(saved), saved.at, admin?.name || null, task.id).run();
  await logFix(env.DB, { recId: `checklist:${task.id}`, fixType: `checklist_${w.kind}`, action: 'draft_saved', admin, detail: `${task.title}: ${saved.path || saved.note}`, after: v.value });
  return { ok: true, saved };
}
