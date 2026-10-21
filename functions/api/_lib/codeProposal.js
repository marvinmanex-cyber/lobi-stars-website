// AI Fix › Code proposals (Super Admins only). For recommendations that need a
// change to a page's code (phones, a page visitors leave quickly), Claude reads
// that ONE page's code and proposes small find-and-replace edits. Our code checks
// every edit (each "find" must appear exactly once), then saves the result on a
// separate GitHub branch (ai-proposal/…) and opens a DRAFT pull request when the
// token allows. Nothing ever reaches the live website from here: a developer
// reviews and merges by hand. The proposal can also be downloaded or emailed.
import { callClaude, estimateCost, getAiSettings, modelFor, cleanText, scrubPersonal, logFix } from './claude.js';
import { readCodeFile, commitToProposalBranch, openDraftPullRequest, branchUrl, isCodeFile, githubReady } from './github.js';
import { typeInfo, slugify, sha } from './aiFix.js';
import { sendEmail } from './email.js';
import { EMAIL_RE } from './matchChecklist.js';

const MAX_FILE_CHARS = 24000; // larger pages are too costly to send
const MAX_TOKENS = 2500;
const SYSTEM = 'You are a careful web developer for the Lobi Stars FC website (Astro pages, plain CSS and small inline scripts). You propose the SMALLEST safe change to ONE page file. Never touch payments, sign-in, secrets or anything outside this file. Keep the existing style and wording rules.';
const HINT = 'Reply with ONE JSON object only: {"summary": "what you changed and why, in plain English for a non-developer (max 600 characters)", "edits": [{"find": "exact text copied from the file, appearing exactly once", "replace": "the new text"}]} with at most 6 edits.';

let ready = false;
async function ensureTable(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS ai_code_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, rec_id TEXT, path TEXT NOT NULL, request TEXT, summary TEXT, edits_json TEXT,
    new_text TEXT, file_sha TEXT, branch TEXT, commit_id TEXT, pr_url TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'proposed', created_by TEXT, created_at TEXT NOT NULL)`).run();
  ready = true;
}

/** The page file a recommendation is about: "/tickets/" → src/pages/tickets/index.astro (or tickets.astro). */
export function pageFileCandidates(pagePath) {
  const p = String(pagePath || '/').split(/[?#]/)[0].replace(/\/+$/, '');
  if (!p) return ['src/pages/index.astro'];
  return [`src/pages${p}/index.astro`, `src/pages${p}.astro`].filter(isCodeFile);
}
async function findPageFile(env, pagePath) {
  for (const path of pageFileCandidates(pagePath)) { const f = await readCodeFile(env, path); if (f) return { path, ...f }; }
  return null;
}

/** Checks Claude's edits against the file: each "find" must appear exactly once. Returns { text } or { error }. */
export function applyEdits(original, edits) {
  if (!Array.isArray(edits) || !edits.length) return { error: 'no edits' };
  if (edits.length > 6) return { error: 'too many edits' };
  let text = original;
  for (const [i, e] of edits.entries()) {
    const find = String(e?.find ?? ''), replace = String(e?.replace ?? '');
    if (!find || find.length > 3000 || replace.length > 5000) return { error: `edit ${i + 1}: missing or too long` };
    const n = text.split(find).length - 1;
    if (n !== 1) return { error: `edit ${i + 1}: the text to change appears ${n} times (must be exactly once)` };
    if (/<script[^>]*src=["']https?:/i.test(replace)) return { error: `edit ${i + 1}: adds an outside script` };
    text = text.replace(find, () => replace);
  }
  if (text === original) return { error: 'no change' };
  return { text };
}

/** Which page and what to ask, for a recommendation (eng:<page>) or a page chosen by the Super Admin (ux:mobile). */
function target(recId, page) {
  const t = typeInfo(recId);
  if (!t.code) return { error: 'Code proposals are only for recommendations about a page\'s layout (phones, pages visitors leave quickly).' };
  const pagePath = recId.startsWith('eng:') ? recId.slice(4) : String(page || '').trim();
  if (!pagePath.startsWith('/')) return { error: 'Choose the page, e.g. /tickets/' };
  const goal = recId.startsWith('eng:') ? `Visitors leave ${pagePath} quickly. Make the first screen answer what the visitor came for and add a clear next step (button or link), without removing content.`
    : `Phone visitors leave sooner than computer visitors. Improve ${pagePath} on small screens (tap targets at least 44px, nothing cut off, no sideways scrolling, readable text).`;
  return { pagePath, goal };
}

/** Estimated cost before asking (shown on the button). */
export async function estimateProposal(env, recId, page) {
  const tg = target(recId, page);
  if (tg.error) return tg;
  if (!githubReady(env)) return { error: 'Code proposals need the GitHub connection (GITHUB_TOKEN).' };
  const f = await findPageFile(env, tg.pagePath);
  if (!f) return { error: `No page file found for ${tg.pagePath}.` };
  if (f.text.length > MAX_FILE_CHARS) return { error: `${f.path} is too large to send cheaply (${f.text.length} characters).` };
  const s = await getAiSettings(env.DB);
  return { ok: true, path: f.path, chars: f.text.length, cost: estimateCost(s, modelFor(env, s, 'code_proposal'), f.text.length + SYSTEM.length + 400, MAX_TOKENS) };
}

/** Asks Claude for the change, checks it, saves it on a proposal branch, opens a draft PR if allowed. */
export async function createProposal(env, admin, { recId, page = '', note = '' }) {
  const db = env.DB;
  await ensureTable(db);
  const tg = target(recId, page);
  if (tg.error) return tg;
  if (!githubReady(env)) return { error: 'Code proposals need the GitHub connection (GITHUB_TOKEN).' };
  const f = await findPageFile(env, tg.pagePath);
  if (!f) return { error: `No page file found for ${tg.pagePath}.` };
  if (f.text.length > MAX_FILE_CHARS) return { error: `${f.path} is too large to send cheaply (${f.text.length} characters).` };
  const extra = scrubPersonal(String(note || '').trim()).slice(0, 400);
  const prompt = `Goal: ${tg.goal}${extra ? `\nSuper Admin's note: ${extra}` : ''}\n${HINT}\nFile ${f.path}:\n<<<FILE\n${f.text}\nFILE>>>`;
  const r = await callClaude(env, { feature: 'code_proposal', system: SYSTEM, prompt, maxTokens: MAX_TOKENS, adminId: admin?.id, relatedId: recId });
  if (!r.ok) return { error: r.error };
  let parsed = null;
  if (r.mock) parsed = { summary: 'Mock proposal (CLAUDE_MOCK is on: no AI was used).', edits: [{ find: f.text.slice(0, Math.min(40, f.text.length)), replace: f.text.slice(0, Math.min(40, f.text.length)) + '\n<!-- AI proposal (mock) -->' }] };
  else { const a = r.text.indexOf('{'), b = r.text.lastIndexOf('}'); try { parsed = JSON.parse(r.text.slice(a, b + 1)); } catch { parsed = null; } }
  if (!parsed) return { error: 'Claude\'s answer could not be used (not valid JSON). Nothing was saved.' };
  const checked = applyEdits(f.text, parsed.edits);
  if (checked.error) return { error: `Claude's change could not be used (${checked.error}). Nothing was saved; try again with a note.` };
  const summary = cleanText(parsed.summary || '').slice(0, 600) || 'Proposed change';
  const at = new Date().toISOString();
  const branch = `ai-proposal/${slugify(tg.pagePath.replace(/\//g, ' ') || 'home')}-${(await sha(at + f.path)).slice(0, 6)}`.toLowerCase().slice(0, 92);
  let commitId = null, prUrl = null, prNote = '';
  try {
    commitId = await commitToProposalBranch(env, branch, f.path, checked.text, `AI proposal (not live): ${summary.slice(0, 60)}`);
    const pr = await openDraftPullRequest(env, branch, `AI proposal: ${tg.pagePath}`, `**Proposed by AI Fix (Claude), not live.** Review before merging.\n\n${summary}\n\nRequested by ${admin?.name || 'a Super Admin'} for: ${recId}`);
    prUrl = pr.url; prNote = pr.note || '';
  } catch (err) { prNote = `Saved here only (branch not created: ${err.message}).`; }
  const res = await db.prepare(`INSERT INTO ai_code_proposals (rec_id, path, request, summary, edits_json, new_text, file_sha, branch, commit_id, pr_url, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(recId, f.path, extra || null, summary, JSON.stringify(parsed.edits), checked.text, f.sha, commitId ? branch : null, commitId, prUrl, prNote || null, admin?.name || null, at).first();
  await logFix(db, { recId, fixType: 'code_proposal', action: 'code_proposed', admin, detail: `${f.path}: ${summary.slice(0, 200)}${prUrl ? ` (pull request ${prUrl})` : commitId ? ` (branch ${branch})` : ''}` });
  return { ok: true, id: res.id, path: f.path, summary, branch: commitId ? branch : null, branchUrl: commitId ? branchUrl(env, branch) : null, prUrl, note: prNote, mock: !!r.mock };
}

export async function listProposals(env) {
  await ensureTable(env.DB);
  const { results } = await env.DB.prepare(`SELECT id, rec_id, path, summary, branch, pr_url, note, status, created_by, created_at FROM ai_code_proposals ORDER BY id DESC LIMIT 50`).all();
  return results.map(r => ({ ...r, branchUrl: r.branch ? branchUrl(env, r.branch) : null }));
}
/** The proposal as a text file a developer can read (edits + the whole new file). */
export async function proposalFile(env, id) {
  await ensureTable(env.DB);
  const p = await env.DB.prepare(`SELECT * FROM ai_code_proposals WHERE id = ?`).bind(Number(id)).first();
  if (!p) return null;
  const edits = JSON.parse(p.edits_json || '[]');
  const text = [`AI PROPOSAL, NOT LIVE. Review before using. Lobi Stars FC website.`, `File: ${p.path}`, `For: ${p.rec_id}`, `Requested by: ${p.created_by || '?'} on ${p.created_at}`,
    p.branch ? `GitHub branch: ${p.branch}` : '', p.pr_url ? `Pull request: ${p.pr_url}` : '', '', `What and why:`, p.summary, '',
    ...edits.flatMap((e, i) => [`--- Edit ${i + 1}: replace ---`, e.find, `--- with ---`, e.replace, '']), `=== The whole file after the change ===`, p.new_text].filter(x => x !== null).join('\n');
  return { filename: `ai-proposal-${p.id}-${p.path.split('/').pop().replace('.astro', '')}.txt`, text };
}
/** Emails the proposal to a developer (attachment). */
export async function emailProposal(env, admin, id, to) {
  const addr = String(to || '').trim().toLowerCase();
  if (!EMAIL_RE.test(addr)) return { error: 'Enter a valid email address.' };
  if (!env.RESEND_API_KEY) return { error: 'Email is not set up (RESEND_API_KEY). Use Download instead.' };
  const f = await proposalFile(env, id);
  if (!f) return { error: 'Proposal not found.' };
  const bytes = new TextEncoder().encode(f.text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const b64 = btoa(bin);
  await sendEmail(env, { to: [addr], subject: 'Lobi Stars FC: AI code proposal to review (not live)', attachments: [{ filename: f.filename, content: b64 }],
    html: `<p>Hello,</p><p>${admin?.name || 'A Super Admin'} asked AI Fix (Claude) to propose a change to the Lobi Stars FC website. <b>It is not live.</b> Please review the attached file and, if it is good, apply it yourself.</p>` });
  await logFix(env.DB, { recId: null, fixType: 'code_proposal', action: 'code_emailed', admin, detail: `Proposal ${id} emailed to ${addr}` });
  return { ok: true };
}
