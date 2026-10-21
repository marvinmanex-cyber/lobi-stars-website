// Changing a content file in the website's GitHub repository (the same thing
// the content editor does). Cloudflare rebuilds the site after each commit
// (about 2 minutes). Needs GITHUB_TOKEN: a fine-grained token with
// "Contents: read and write" on this one repository only (handover A29).
// Only paths on ALLOWED are ever written.
const REPO = env => env.GITHUB_REPO || 'marvinmanex-cyber/lobi-stars-website';
const BRANCH = env => env.GITHUB_BRANCH || 'main';
const ALLOWED = [/^src\/data\/seo\.json$/, /^src\/content\/news\/[a-z0-9-]{3,100}\.md$/];
export const githubReady = env => !!env.GITHUB_TOKEN;
const headers = env => ({ Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'lobistarsfc-admin', 'X-GitHub-Api-Version': '2022-11-28' });
// GITHUB_API_BASE only for the local tests (a stand-in server).
const url = (env, path) => `${env.GITHUB_API_BASE || 'https://api.github.com'}/repos/${REPO(env)}/contents/${path}`;
const allowed = path => ALLOWED.some(r => r.test(path));
const toB64 = s => { const b = new TextEncoder().encode(s); let x = ''; for (let i = 0; i < b.length; i += 0x8000) x += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(x); };
const fromB64 = s => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/\s/g, '')), c => c.charCodeAt(0)));
const COMMITTER = { name: 'Lobi Stars admin (AI Fix)', email: 'noreply@lobistarsfc.com' };

/** { sha, text } or null when the file doesn't exist. */
export async function getFile(env, path) {
  if (!allowed(path)) throw new Error('This file may not be changed by AI Fix.');
  const r = await fetch(`${url(env, path)}?ref=${encodeURIComponent(BRANCH(env))}`, { headers: headers(env), signal: AbortSignal.timeout(20000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'GitHub did not accept the token (GITHUB_TOKEN).' : `GitHub error ${r.status}.`);
  const d = await r.json();
  return { sha: d.sha, text: fromB64(d.content) };
}
/** Creates or updates the file. Returns the commit id. */
export async function putFile(env, path, text, message, sha = undefined) {
  if (!allowed(path)) throw new Error('This file may not be changed by AI Fix.');
  const r = await fetch(url(env, path), { method: 'PUT', headers: { ...headers(env), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ message, content: toB64(text), branch: BRANCH(env), committer: COMMITTER, ...(sha ? { sha } : {}) }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 409 || r.status === 422 ? 'The file changed on GitHub at the same time; please try again.' : `GitHub error ${r.status}${d.message ? `: ${d.message}` : ''}.`);
  return d.commit?.sha || null;
}
export async function deleteFile(env, path, message, sha) {
  if (!allowed(path)) throw new Error('This file may not be changed by AI Fix.');
  const r = await fetch(url(env, path), { method: 'DELETE', headers: { ...headers(env), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ message, sha, branch: BRANCH(env), committer: COMMITTER }) });
  if (!r.ok && r.status !== 404) throw new Error(`GitHub error ${r.status}.`);
  return true;
}

// ── Code proposals (Super Admins): NEVER on the live branch ──
// Page code can be READ (to propose a change) and written only to a separate
// branch named ai-proposal/…, from which a person opens or merges a pull request.
const CODE_FILE = /^src\/(pages|components|layouts)\/[\w\-/[\].]+\.astro$/;
const PROPOSAL_BRANCH = /^ai-proposal\/[a-z0-9-]{3,80}$/;
const api = (env, p) => `${env.GITHUB_API_BASE || 'https://api.github.com'}/repos/${REPO(env)}${p}`;
export const isCodeFile = path => CODE_FILE.test(path) && !path.includes('..');

/** A page's code from the live branch (read-only). { sha, text } or null. */
export async function readCodeFile(env, path) {
  if (!isCodeFile(path)) throw new Error('Only page code (.astro files) can be read for a proposal.');
  const r = await fetch(`${url(env, path)}?ref=${encodeURIComponent(BRANCH(env))}`, { headers: headers(env), signal: AbortSignal.timeout(20000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub error ${r.status}.`);
  const d = await r.json();
  return { sha: d.sha, text: fromB64(d.content) };
}
/** Creates the proposal branch from the live branch and saves the changed file on it. Returns the commit id. */
export async function commitToProposalBranch(env, branch, path, text, message) {
  if (!PROPOSAL_BRANCH.test(branch) || branch === BRANCH(env)) throw new Error('Proposals only go to an ai-proposal/ branch.');
  if (!isCodeFile(path)) throw new Error('Only page code can be proposed.');
  const ref = await fetch(api(env, `/git/ref/heads/${encodeURIComponent(BRANCH(env))}`), { headers: headers(env), signal: AbortSignal.timeout(20000) });
  if (!ref.ok) throw new Error(`GitHub error ${ref.status} (reading the live branch).`);
  const base = (await ref.json()).object?.sha;
  const mk = await fetch(api(env, '/git/refs'), { method: 'POST', headers: { ...headers(env), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000), body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base }) });
  if (!mk.ok && mk.status !== 422) throw new Error(`GitHub error ${mk.status} (creating the branch).`);
  const cur = await fetch(`${url(env, path)}?ref=${encodeURIComponent(branch)}`, { headers: headers(env), signal: AbortSignal.timeout(20000) });
  const curSha = cur.ok ? (await cur.json()).sha : undefined;
  const r = await fetch(url(env, path), { method: 'PUT', headers: { ...headers(env), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ message, content: toB64(text), branch, committer: COMMITTER, ...(curSha ? { sha: curSha } : {}) }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub error ${r.status}${d.message ? `: ${d.message}` : ''} (saving on the branch).`);
  return d.commit?.sha || null;
}
/** Opens a DRAFT pull request (never merged by the website). Needs "Pull requests: write" on the token; otherwise { url: null, note }. */
export async function openDraftPullRequest(env, branch, title, body) {
  if (!PROPOSAL_BRANCH.test(branch)) throw new Error('Proposals only go to an ai-proposal/ branch.');
  const r = await fetch(api(env, '/pulls'), { method: 'POST', headers: { ...headers(env), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ title, body, head: branch, base: BRANCH(env), draft: true }) });
  const d = await r.json().catch(() => ({}));
  if (r.ok) return { url: d.html_url || null };
  return { url: null, note: r.status === 403 || r.status === 404 ? 'The branch is saved. To open the pull request automatically, add "Pull requests: Read and write" to the GitHub token; or open it on GitHub yourself.' : `Pull request not opened (GitHub ${r.status}).` };
}
export const branchUrl = (env, branch) => `https://github.com/${REPO(env)}/tree/${branch}`;
