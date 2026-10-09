// POST /api/newsletter { email, source? } -- newsletter sign-up, separate
// from club membership. Stored in the newsletter_subscribers table (created
// on first use; also listed in schema.sql).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const source = typeof body.source === 'string' ? body.source.slice(0, 100) : '';

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS newsletter_subscribers (
         email TEXT PRIMARY KEY,
         source TEXT,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`
    ).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO newsletter_subscribers (email, source) VALUES (?, ?)`
    ).bind(email, source).run();
  } catch (err) {
    return Response.json({ error: 'Sign-up is temporarily unavailable. Please try again later.' }, { status: 500 });
  }

  return Response.json({ ok: true });
}
