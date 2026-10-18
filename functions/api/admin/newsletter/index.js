import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { ensureNewsletterSchema, parseIssue, loadSponsors, recipients, safeUrl, newId, newsletterSettings, saveNewsletterSettings, NL_DEFAULTS } from '../../_lib/newsletter.js';
import { maskEmail } from '../../_lib/fanQuery.js';

const SUBS_PAGE = 50;
/** A subscriber as staff see it (email partly hidden without "can export fan data"). */
const subRow = (admin, r) => ({ id: r.id, name: [r.first_name, r.surname].filter(Boolean).join(' '), email: maskEmail(r.email), since: r.first_seen || null });

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

// GET /api/admin/newsletter -- issues (with click counts), sponsor adverts,
// subscriber numbers and whether the email service is connected.
// GET ?subscribers=1&q=&offset= -- the people who receive the newsletter (50 at a time, search by name or email).
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureNewsletterSchema(db);
  const url = new URL(request.url);
  if (url.searchParams.get('subscribers')) {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 80);
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const all = (await recipients(db)).filter(r => !q || `${r.first_name || ''} ${r.surname || ''} ${r.email}`.toLowerCase().includes(q));
    return json({ total: all.length, offset, pageSize: SUBS_PAGE, people: all.slice(offset, offset + SUBS_PAGE).map(r => subRow(admin, r)) });
  }
  const { results: issues } = await db.prepare(`SELECT id, slug, subject, headline, status, created_at, created_by, updated_at, updated_by, sent_at, sent_by, sent_count, failed_count, scheduled_at, scheduled_by FROM newsletter_issues ORDER BY COALESCE(sent_at, updated_at, created_at) DESC`).all();
  const { results: clicks } = await db.prepare(`SELECT issue_id, kind, ref, COUNT(*) AS n FROM newsletter_clicks GROUP BY issue_id, kind, ref`).all();
  for (const i of issues) i.clicks = clicks.filter(c => c.issue_id === i.id).reduce((s, c) => s + c.n, 0);
  const sponsors = await loadSponsors(db);
  for (const s of sponsors) s.clicks = clicks.filter(c => c.kind === 's' && c.ref === s.id).reduce((t, c) => t + c.n, 0);
  const prefs = await db.prepare(`SELECT COUNT(*) AS total, SUM(pref_weekly) AS weekly, SUM(pref_matchday) AS matchday, SUM(pref_offers) AS offers FROM newsletter_subscribers`).first();
  return json({
    issues, sponsors, settings: await newsletterSettings(db), defaults: NL_DEFAULTS,
    counts: { recipients: (await recipients(db)).length, signups: prefs.total || 0, weekly: prefs.weekly || 0, matchday: prefs.matchday || 0, offers: prefs.offers || 0 },
    emailReady: !!env.RESEND_API_KEY, testMode: !env.RESEND_API_KEY && String(env.FANS_DEV_LINKS) === '1',
  });
}

/** Cleans an issue sent from the editor. */
async function cleanIssue(db, b) {
  const known = new Set((await loadSponsors(db)).map(s => s.id));
  const stories = (Array.isArray(b.stories) ? b.stories : []).slice(0, 12).map(s => ({
    title: str(s?.title, 160), text: str(s?.text, 600), image: safeUrl(s?.image), url: safeUrl(s?.url),
  })).filter(s => s.title);
  return {
    subject: str(b.subject, 150), preheader: str(b.preheader, 200), headline: str(b.headline, 150), intro: str(b.intro, 6000),
    hero_image: safeUrl(b.hero_image), hero_button_text: str(b.hero_button_text, 40), hero_button_url: safeUrl(b.hero_button_url),
    include_match: b.include_match ? 1 : 0, stories: JSON.stringify(stories),
    sponsor_ids: JSON.stringify((Array.isArray(b.sponsor_ids) ? b.sponsor_ids : []).map(String).filter(id => known.has(id)).slice(0, 30)),
    top_sponsor_id: known.has(String(b.top_sponsor_id || '')) ? String(b.top_sponsor_id) : null,
    // Selected people (contact ids) or everyone (null).
    audience: Array.isArray(b.audience) ? JSON.stringify([...new Set(b.audience.map(String).filter(x => /^[\w-]{1,64}$/.test(x)))].slice(0, 10000)) : null,
  };
}

// POST /api/admin/newsletter
//   { action: 'get_issue', id }
//   { action: 'save_issue', issue: {...} }           add (no id) or change a draft
//   { action: 'duplicate_issue', id } / { action: 'delete_issue', id }
//   { action: 'save_sponsor', sponsor: {...} }       add (no id) or change an advert
//   { action: 'delete_sponsor', id } / { action: 'order_sponsors', ids: [...] }
//   { action: 'import_partners', partners: [{ name, logo, link, headline }] }
//   { action: 'save_settings', settings: { title, matchLabel, ..., facebook, x, ... } }  template wording and footer
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureNewsletterSchema(db);
  const b = await request.json().catch(() => ({}));
  const now = new Date().toISOString();

  if (b.action === 'get_issue') {
    const issue = parseIssue(await db.prepare(`SELECT * FROM newsletter_issues WHERE id = ?`).bind(String(b.id || '')).first());
    if (!issue) return json({ error: 'Newsletter not found.' }, 404);
    delete issue.html_snapshot;
    // For "Selected people": who they are, and how many can receive it (agreed to club emails, not unsubscribed).
    if (Array.isArray(issue.audience)) {
      const ok = await recipients(db, null, 100000, issue.audience);
      issue.audience_people = ok.slice(0, 500).map(r => subRow(admin, r));
      issue.audience_count = ok.length;
    }
    return json({ issue });
  }
  if (b.action === 'save_issue') {
    const i = await cleanIssue(db, b.issue || {});
    if (!i.subject) return json({ error: 'Please write an email subject.' }, 400);
    const id = b.issue?.id ? String(b.issue.id) : null;
    if (id) {
      const cur = await db.prepare(`SELECT status FROM newsletter_issues WHERE id = ?`).bind(id).first();
      if (!cur) return json({ error: 'Newsletter not found.' }, 404);
      if (cur.status !== 'draft' && cur.status !== 'scheduled') return json({ error: 'This newsletter has already been sent, so it can no longer be changed. Use Duplicate to make a new one from it.' }, 409);
      await db.prepare(`UPDATE newsletter_issues SET subject = ?, preheader = ?, headline = ?, intro = ?, hero_image = ?, hero_button_text = ?, hero_button_url = ?, include_match = ?, stories = ?, sponsor_ids = ?, top_sponsor_id = ?, audience = ?, updated_at = ?, updated_by = ? WHERE id = ? AND status IN ('draft', 'scheduled')`)
        .bind(i.subject, i.preheader, i.headline, i.intro, i.hero_image, i.hero_button_text, i.hero_button_url, i.include_match, i.stories, i.sponsor_ids, i.top_sponsor_id, i.audience, now, admin.name, id).run();
      return json({ ok: true, id });
    }
    const nid = newId('NL');
    await db.prepare(`INSERT INTO newsletter_issues (id, subject, preheader, headline, intro, hero_image, hero_button_text, hero_button_url, include_match, stories, sponsor_ids, top_sponsor_id, audience, status, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`)
      .bind(nid, i.subject, i.preheader, i.headline, i.intro, i.hero_image, i.hero_button_text, i.hero_button_url, i.include_match, i.stories, i.sponsor_ids, i.top_sponsor_id, i.audience, now, admin.name, now, admin.name).run();
    await logAdminAction(db, admin, 'newsletter_create', i.subject);
    return json({ ok: true, id: nid });
  }
  if (b.action === 'duplicate_issue') {
    const src = await db.prepare(`SELECT * FROM newsletter_issues WHERE id = ?`).bind(String(b.id || '')).first();
    if (!src) return json({ error: 'Newsletter not found.' }, 404);
    const nid = newId('NL');
    await db.prepare(`INSERT INTO newsletter_issues (id, subject, preheader, headline, intro, hero_image, hero_button_text, hero_button_url, include_match, stories, sponsor_ids, top_sponsor_id, audience, status, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`)
      .bind(nid, `${src.subject} (copy)`.slice(0, 150), src.preheader, src.headline, src.intro, src.hero_image, src.hero_button_text, src.hero_button_url, src.include_match, src.stories, src.sponsor_ids, src.top_sponsor_id, src.audience || null, now, admin.name, now, admin.name).run();
    return json({ ok: true, id: nid });
  }
  if (b.action === 'delete_issue') {
    const row = await db.prepare(`SELECT subject, status FROM newsletter_issues WHERE id = ?`).bind(String(b.id || '')).first();
    if (!row) return json({ error: 'Newsletter not found.' }, 404);
    if (row.status === 'sending') return json({ error: 'This newsletter is being sent. Finish sending first.' }, 409);
    await db.batch([
      db.prepare(`DELETE FROM newsletter_issues WHERE id = ?`).bind(String(b.id)),
      db.prepare(`DELETE FROM newsletter_deliveries WHERE issue_id = ?`).bind(String(b.id)),
      db.prepare(`DELETE FROM newsletter_clicks WHERE issue_id = ?`).bind(String(b.id)),
    ]);
    await logAdminAction(db, admin, 'newsletter_delete', `${row.subject} (${row.status})`);
    return json({ ok: true });
  }

  if (b.action === 'save_sponsor') {
    const s = b.sponsor || {};
    const v = {
      name: str(s.name, 80), logo: safeUrl(s.logo), link: safeUrl(s.link), headline: str(s.headline, 60), text: str(s.text, 300),
      button_text: str(s.button_text, 30) || 'Visit website', active: s.active === false ? 0 : 1,
      address: str(s.address, 160), phone: str(s.phone, 40), email: str(s.email, 120), offer: str(s.offer, 120),
      banner_image: safeUrl(s.banner_image), featured: s.featured ? 1 : 0,
    };
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) return json({ error: 'Please check the sponsor email address.' }, 400);
    if (!v.name) return json({ error: 'Please type the sponsor name.' }, 400);
    if (s.link && !v.link) return json({ error: 'The website address must start with https://' }, 400);
    if (s.id) {
      const r = await db.prepare(`UPDATE newsletter_sponsors SET name = ?, logo = ?, link = ?, headline = ?, text = ?, button_text = ?, active = ?, address = ?, phone = ?, email = ?, offer = ?, banner_image = ?, featured = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
        .bind(v.name, v.logo, v.link, v.headline, v.text, v.button_text, v.active, v.address, v.phone, v.email, v.offer, v.banner_image, v.featured, now, admin.name, String(s.id)).run();
      if (!r.meta?.changes) return json({ error: 'Sponsor not found.' }, 404);
      await logAdminAction(db, admin, 'newsletter_sponsor_edit', v.name);
      return json({ ok: true, id: String(s.id) });
    }
    const id = newId('SP');
    const sort = ((await db.prepare(`SELECT MAX(sort) AS m FROM newsletter_sponsors`).first())?.m ?? -1) + 1;
    await db.prepare(`INSERT INTO newsletter_sponsors (id, name, logo, link, headline, text, button_text, active, address, phone, email, offer, banner_image, featured, sort, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, v.name, v.logo, v.link, v.headline, v.text, v.button_text, v.active, v.address, v.phone, v.email, v.offer, v.banner_image, v.featured, sort, now, now, admin.name).run();
    await logAdminAction(db, admin, 'newsletter_sponsor_add', v.name);
    return json({ ok: true, id });
  }
  if (b.action === 'delete_sponsor') {
    const row = await db.prepare(`SELECT name FROM newsletter_sponsors WHERE id = ?`).bind(String(b.id || '')).first();
    if (!row) return json({ error: 'Sponsor not found.' }, 404);
    await db.prepare(`DELETE FROM newsletter_sponsors WHERE id = ?`).bind(String(b.id)).run();
    await logAdminAction(db, admin, 'newsletter_sponsor_delete', row.name);
    return json({ ok: true });
  }
  if (b.action === 'order_sponsors') {
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(String);
    if (ids.length) await db.batch(ids.map((id, i) => db.prepare(`UPDATE newsletter_sponsors SET sort = ? WHERE id = ?`).bind(i, id)));
    return json({ ok: true });
  }
  if (b.action === 'import_partners') {
    const have = new Set((await loadSponsors(db)).map(s => s.name.toLowerCase()));
    let sort = ((await db.prepare(`SELECT MAX(sort) AS m FROM newsletter_sponsors`).first())?.m ?? -1) + 1;
    const add = [];
    for (const p of (Array.isArray(b.partners) ? b.partners : []).slice(0, 40)) {
      const name = str(p?.name, 80);
      if (!name || have.has(name.toLowerCase())) continue;
      have.add(name.toLowerCase());
      add.push(db.prepare(`INSERT INTO newsletter_sponsors (id, name, logo, link, headline, text, button_text, active, sort, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, '', 'Visit website', 1, ?, ?, ?, ?)`)
        .bind(newId('SP'), name, safeUrl(p.logo), safeUrl(p.link), str(p.headline, 60), sort++, now, now, admin.name));
    }
    if (add.length) await db.batch(add);
    await logAdminAction(db, admin, 'newsletter_sponsor_import', `${add.length} club partner(s)`);
    return json({ ok: true, added: add.length });
  }
  if (b.action === 'save_settings') {
    try {
      const settings = await saveNewsletterSettings(db, b.settings || {}, admin.name);
      await logAdminAction(db, admin, 'newsletter_settings', 'template wording / footer');
      return json({ ok: true, settings });
    } catch (err) { return json({ error: err.message }, 400); }
  }
  return json({ error: 'Unknown action' }, 400);
}
