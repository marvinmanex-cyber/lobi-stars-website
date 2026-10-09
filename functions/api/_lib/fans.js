// Fan accounts reuse the existing members table (and its session cookie).
// This file adds what fan accounts need on top: email verification, unique
// +234 phone numbers, one-time email links, rate limiting, the Turnstile
// human check and branded emails.
import { sendEmail } from './email.js';
import { PRIZE_AMOUNT, CLAIM_INSTRUCTIONS, formatNaira } from './predictSettings.js';

const SITE = 'https://lobistarsfc.com';
let schemaReady = false;

/** Adds the fan-account columns/tables once per worker instance. Safe to run repeatedly. */
export async function ensureFanSchema(db) {
  if (schemaReady) return;
  const { results } = await db.prepare(`PRAGMA table_info(members)`).all();
  const cols = new Set(results.map(r => r.name));
  const add = [
    // Existing members (created before email confirmation existed) count as verified.
    ['email_verified', 'INTEGER NOT NULL DEFAULT 1'],
    ['email_verified_at', 'TEXT'],
    ['phone_e164', 'TEXT'],
    ['marketing_opt_in', 'INTEGER NOT NULL DEFAULT 0'],
    ['age_confirmed_at', 'TEXT'],
    ['is_staff', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [name, type] of add) {
    if (!cols.has(name)) await db.prepare(`ALTER TABLE members ADD COLUMN ${name} ${type}`).run();
  }
  await db.batch([
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_members_phone_e164 ON members(phone_e164) WHERE phone_e164 IS NOT NULL`),
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id),
      purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL
    )`),
  ]);
  schemaReady = true;
}

// ── Validation ──

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Nigerian mobile numbers -> "+234XXXXXXXXXX", or null if not valid. */
export function normalizeNigerianPhone(input) {
  const digits = String(input || '').replace(/[\s\-().]/g, '');
  let m = digits.match(/^0((?:70|80|81|90|91)\d{8})$/);
  if (m) return `+234${m[1]}`;
  m = digits.match(/^\+?234((?:70|80|81|90|91)\d{8})$/);
  if (m) return `+234${m[1]}`;
  return null;
}

/** "+2348031234521" -> "0803****21" (for public display). */
export function maskPhone(e164) {
  const local = String(e164 || '').replace(/^\+234/, '0');
  return local.length >= 8 ? `${local.slice(0, 4)}****${local.slice(-2)}` : '';
}

/** Only allow redirects back to a path on this site. */
export function safeNext(next) {
  return typeof next === 'string' && /^\/(?!\/)[^\s]*$/.test(next) && !next.startsWith('/api/') ? next : '/';
}

// ── Rate limiting (fixed window, stored in D1) ──

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

/** Returns true if the action is allowed, false if the limit was hit. */
export async function rateLimit(db, key, limit, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - (now % windowSeconds);
  const row = await db.prepare(`SELECT window_start, count FROM rate_limits WHERE key = ?`).bind(key).first();
  if (!row || row.window_start !== start) {
    await db.prepare(`INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1`).bind(key, start).run();
    return true;
  }
  if (row.count >= limit) return false;
  await db.prepare(`UPDATE rate_limits SET count = count + 1 WHERE key = ?`).bind(key).run();
  return true;
}

export const tooMany = () =>
  Response.json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, { status: 429 });

// ── Human check (Cloudflare Turnstile) ──

/** Skipped (allowed) until TURNSTILE_SECRET_KEY is set. */
export async function checkTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  if (ip && ip !== 'unknown') form.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const data = await res.json();
    return !!data.success;
  } catch {
    return false;
  }
}

// ── One-time email tokens (stored hashed) ──

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createToken(db, memberId, purpose, ttlMs) {
  const raw = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
  // Only one live token of each kind per account.
  await db.prepare(`DELETE FROM auth_tokens WHERE member_id = ? AND purpose = ? AND used_at IS NULL`).bind(memberId, purpose).run();
  await db.prepare(`INSERT INTO auth_tokens (token_hash, member_id, purpose, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(await sha256Hex(raw), memberId, purpose, Date.now() + ttlMs).run();
  return raw;
}

/** Marks the token used and returns its member id, or null if invalid/expired/used. */
export async function consumeToken(db, raw, purpose) {
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  const hash = await sha256Hex(raw);
  const row = await db.prepare(`SELECT member_id, expires_at, used_at FROM auth_tokens WHERE token_hash = ? AND purpose = ?`)
    .bind(hash, purpose).first();
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  await db.prepare(`UPDATE auth_tokens SET used_at = ? WHERE token_hash = ?`).bind(Date.now(), hash).run();
  return row.member_id;
}

// ── Emails ──

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#F1F3F5;font-family:Arial,Helvetica,sans-serif;color:#15181D;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F3F5;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td style="background:#E31E24;background:linear-gradient(120deg,#4D0B0D,#E31E24);padding:22px;text-align:center;">
<img src="${SITE}/images/icon-192.png" width="64" height="64" alt="Lobi Stars FC" style="border-radius:50%;background:#fff;"/>
<div style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:2px;margin-top:8px;">LOBI STARS FC</div>
<div style="color:#FFC72C;font-size:11px;letter-spacing:3px;">THE PRIDE OF BENUE</div></td></tr>
<tr><td style="padding:28px 26px;">
<h1 style="margin:0 0 14px;font-size:22px;color:#15181D;">${title}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 26px;background:#F7F8FA;color:#5B6472;font-size:12px;text-align:center;">
Lobi Stars Football Club &middot; McCarthy Stadium, Makurdi &middot; <a href="${SITE}" style="color:#C11A1F;">lobistarsfc.com</a><br/>
If you didn't request this email, you can safely ignore it.</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href, label) =>
  `<p style="margin:24px 0;text-align:center;"><a href="${href}" style="background:#E31E24;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:6px;font-weight:bold;letter-spacing:1px;display:inline-block;">${label}</a></p>
<p style="font-size:12px;color:#5B6472;word-break:break-all;">If the button doesn't work, copy this link into your browser:<br/>${href}</p>`;

const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Sends a fan email. Without RESEND_API_KEY (local development) the link is
 * logged instead, and returned when FANS_DEV_LINKS=1 so automated tests can
 * follow it. Neither applies in production, where the key is set.
 */
async function sendFanEmail(env, to, subject, html, devLink) {
  if (!env.RESEND_API_KEY) {
    console.log(`[fans] Email not sent (RESEND_API_KEY not set). ${subject} -> ${to}: ${devLink}`);
    return String(env.FANS_DEV_LINKS) === '1' ? devLink : null;
  }
  await sendEmail({ ...env, RESEND_FROM: env.FAN_EMAIL_FROM || env.RESEND_FROM }, { to, subject, html });
  return null;
}

export async function sendVerificationEmail(env, origin, member, rawToken, next) {
  const link = `${origin}/api/fans/verify?token=${rawToken}${next && next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}`;
  const html = layout('Confirm your email address', `
<p style="font-size:15px;line-height:1.6;">Hi ${esc(member.first_name)},</p>
<p style="font-size:15px;line-height:1.6;">Welcome to the Lobi Stars family! Please confirm your email address to activate your fan account.</p>
${button(link, 'CONFIRM MY EMAIL')}
<p style="font-size:13px;color:#5B6472;">This link can be used once and expires in 24 hours.</p>`);
  return sendFanEmail(env, member.email, 'Confirm your Lobi Stars FC account', html, link);
}

export async function sendResetEmail(env, origin, member, rawToken) {
  const link = `${origin}/fans/reset/?token=${rawToken}`;
  const html = layout('Reset your password', `
<p style="font-size:15px;line-height:1.6;">Hi ${esc(member.first_name)},</p>
<p style="font-size:15px;line-height:1.6;">We received a request to reset the password for your Lobi Stars FC account.</p>
${button(link, 'CHOOSE A NEW PASSWORD')}
<p style="font-size:13px;color:#5B6472;">This link can be used once and expires in 1 hour.</p>`);
  return sendFanEmail(env, member.email, 'Reset your Lobi Stars FC password', html, link);
}

export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

/** Congratulations email to the Predict & Win winner (no bank details are ever requested). */
export async function sendPrizeWinnerEmail(env, member, match, prediction) {
  const html = layout('You won Predict &amp; Win!', `
<p style="font-size:15px;line-height:1.6;">Hi ${esc(member.first_name)},</p>
<p style="font-size:15px;line-height:1.6;">Congratulations! You were the first fan to predict the exact score of
<strong>${esc(match.home_team)} ${match.home_score} – ${match.away_score} ${esc(match.away_team)}</strong>
(your prediction: ${prediction.home_goals} – ${prediction.away_goals}). You have won <strong>${formatNaira(PRIZE_AMOUNT)}</strong>.</p>
<p style="font-size:15px;line-height:1.6;">${esc(CLAIM_INSTRUCTIONS)}</p>
<p style="font-size:13px;color:#5B6472;">Please keep your phone on: we will call the number on your fan account.</p>`);
  return sendFanEmail(env, member.email, `You won ${formatNaira(PRIZE_AMOUNT)} with Lobi Stars Predict & Win`, html, `${SITE}/contact`);
}
