import { guard, json, SUPER_ONLY } from '../../_lib/checklistApi.js';
import { PHASES, LINK_TARGETS, PLACEHOLDERS, offsetLabel, linkContext, buildTaskLink, fillPlaceholders, routeExists } from '../../_lib/matchChecklist.js';
import { matchSlug } from '../../_lib/matchSlug.js';
import { logAdminAction } from '../../_lib/adminSession.js';

// Match Checklist templates (Super Admins only). Edits never change existing
// checklists: their tasks were copied when they were generated.
// GET                                              -- the active template, its tasks, the pages a task can link to
// POST { action: 'save', task }                   -- add (no id) or update a task
// POST { action: 'delete', id }
// POST { action: 'reorder', ids: [..] }           -- new order (sort_order 10, 20, ...)
// POST { action: 'test_link', task }              -- the link built with the next upcoming match's values
const PRIOS = ['normal', 'critical'], APPLIES = ['home', 'away', 'both'], LINK_TYPES = ['internal', 'external', 'none'];

async function nextMatchContext(env) {
  const e = await env.DB.prepare(`SELECT * FROM events WHERE active = 1 AND event_date > ? ORDER BY event_date LIMIT 1`).bind(new Date().toISOString()).first();
  if (!e) return null;
  const match = { id: e.id, home: e.home_team, away: e.away_team, kickoff: e.event_date, slug: matchSlug(e) };
  return { match, ctx: await linkContext(env, env.DB, match) };
}

/** Validates a task from the form. Returns { value } or { error }. */
function cleanTask(t) {
  const title = String(t?.title || '').trim();
  if (!title || title.length > 200) return { error: 'Each task needs a title (at most 200 characters).' };
  if (!PHASES.includes(t.phase)) return { error: 'Choose before, during or after the match.' };
  const off = Number(t.due_offset_minutes);
  if (!Number.isInteger(off) || Math.abs(off) > 60 * 24 * 60) return { error: 'The due time must be within 60 days of kick-off.' };
  const rem = t.remind_from_offset_minutes === '' || t.remind_from_offset_minutes === null || t.remind_from_offset_minutes === undefined ? null : Number(t.remind_from_offset_minutes);
  if (rem !== null && (!Number.isInteger(rem) || Math.abs(rem) > 60 * 24 * 60)) return { error: 'The reminder start must be within 60 days of kick-off.' };
  const linkType = LINK_TYPES.includes(t.link_type) ? t.link_type : 'none';
  let linkRoute = null, linkUrl = null;
  if (linkType === 'internal') {
    linkRoute = String(t.link_route || '').trim();
    if (!linkRoute.startsWith('/admin') || !routeExists(linkRoute)) return { error: 'Choose one of the listed admin pages for the task link.' };
    const unknown = (linkRoute.match(/\{([a-z_]+)\}/g) || []).map(x => x.slice(1, -1)).filter(k => !PLACEHOLDERS.includes(k));
    if (unknown.length) return { error: `Unknown placeholder: {${unknown.join('}, {')}}` };
  }
  if (linkType === 'external') {
    linkUrl = String(t.link_url || '').trim();
    if (!/^https:\/\/[^\s]+\.[^\s]+$/i.test(linkUrl) || linkUrl.length > 500) return { error: 'An external link must be a full address starting with https://' };
  }
  return { value: {
    title, description: String(t.description || '').trim().slice(0, 1000) || null, phase: t.phase, due_offset_minutes: off, remind_from_offset_minutes: rem,
    default_owner_role_or_unit: String(t.default_owner_role_or_unit || '').trim().slice(0, 60) || null,
    priority: PRIOS.includes(t.priority) ? t.priority : 'normal', applies_to: APPLIES.includes(t.applies_to) ? t.applies_to : 'both',
    link_type: linkType, link_route: linkRoute, link_url: linkUrl, link_label: String(t.link_label || '').trim().slice(0, 40) || null,
  } };
}

export async function onRequestGet({ request, env }) {
  const { superAdmin, denied } = await guard(request, env);
  if (denied) return denied;
  if (!superAdmin) return json({ error: SUPER_ONLY }, 403);
  const templates = (await env.DB.prepare(`SELECT * FROM checklist_templates WHERE is_active = 1 ORDER BY id`).all()).results;
  const want = Number(new URL(request.url).searchParams.get('template'));
  const tpl = templates.find(t => t.id === want) || templates.find(t => t.venue_type === 'both') || templates[0] || null;
  const { results: tasks } = tpl ? await env.DB.prepare(`SELECT * FROM checklist_template_tasks WHERE template_id = ? ORDER BY CASE phase WHEN 'before' THEN 0 WHEN 'during' THEN 1 ELSE 2 END, sort_order, id`).bind(tpl.id).all() : { results: [] };
  for (const t of tasks) { t.dueLabel = offsetLabel(t.due_offset_minutes); t.remindLabel = t.remind_from_offset_minutes === null ? null : offsetLabel(t.remind_from_offset_minutes); }
  const next = await nextMatchContext(env);
  return json({ template: tpl, templates, tasks, targets: LINK_TARGETS, placeholders: PLACEHOLDERS, nextMatch: next ? `${next.match.home} vs ${next.match.away}` : null });
}
const VENUE_NAME = { home: 'Home matches', away: 'Away matches', both: 'All matches (shared)' };

export async function onRequestPost({ request, env }) {
  const { admin, superAdmin, denied } = await guard(request, env, { write: true });
  if (denied) return denied;
  if (!superAdmin) return json({ error: SUPER_ONLY }, 403);
  const db = env.DB;
  const b = await request.json().catch(() => ({}));
  const templates = (await db.prepare(`SELECT * FROM checklist_templates WHERE is_active = 1 ORDER BY id`).all()).results;
  const tpl = templates.find(t => t.id === Number(b.templateId)) || templates.find(t => t.venue_type === 'both') || templates[0];
  if (!tpl) return json({ error: 'No active template.' }, 409);
  const now = new Date().toISOString();

  // Separate home / away template: a copy of the shared one, used for those matches from now on.
  if (b.action === 'create_variant') {
    const venue = b.venue === 'home' ? 'home' : b.venue === 'away' ? 'away' : null;
    if (!venue) return json({ error: 'Choose home or away.' }, 400);
    if (templates.some(t => t.venue_type === venue)) return json({ error: `There is already a template for ${venue} matches.` }, 409);
    const base = templates.find(t => t.venue_type === 'both') || tpl;
    const made = await db.prepare(`INSERT INTO checklist_templates (name, venue_type, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?) RETURNING id`).bind(VENUE_NAME[venue], venue, now, now).first();
    const { results: src } = await db.prepare(`SELECT * FROM checklist_template_tasks WHERE template_id = ? AND applies_to IN ('both', ?)`).bind(base.id, venue).all();
    const cols = ['title', 'description', 'phase', 'due_offset_minutes', 'remind_from_offset_minutes', 'default_owner_role_or_unit', 'priority', 'applies_to', 'sort_order', 'link_type', 'link_route', 'link_params', 'link_url', 'link_label'];
    for (let i = 0; i < src.length; i += 40) {
      await db.batch(src.slice(i, i + 40).map(t => db.prepare(`INSERT INTO checklist_template_tasks (template_id, ${cols.join(', ')}, created_at, updated_at) VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?)`)
        .bind(made.id, ...cols.map(c => t[c] ?? null), now, now)));
    }
    await logAdminAction(db, admin, 'checklist_template', `Made a separate template for ${venue} matches (${src.length} tasks copied)`);
    return json({ ok: true, id: made.id, copied: src.length });
  }
  if (b.action === 'delete_template') {
    if (tpl.venue_type === 'both') return json({ error: 'The shared template can\'t be removed.' }, 400);
    await db.prepare(`UPDATE checklist_templates SET is_active = 0, updated_at = ? WHERE id = ?`).bind(now, tpl.id).run();
    await logAdminAction(db, admin, 'checklist_template', `Removed the ${tpl.venue_type} template (those matches use the shared one again)`);
    return json({ ok: true });
  }

  if (b.action === 'test_link') {
    const v = cleanTask({ title: 'x', phase: 'before', due_offset_minutes: 0, ...b.task });
    if (v.error) return json({ error: v.error }, 400);
    if (v.value.link_type === 'none') return json({ error: 'This task has no link.' }, 400);
    const next = await nextMatchContext(env);
    if (!next) return json({ error: 'There is no upcoming match to test with.' }, 409);
    const link = buildTaskLink({ id: 0, ...v.value }, next.ctx);
    if (!link || link.broken) return json({ error: `This link can't be built for ${next.match.home} vs ${next.match.away}${link?.missing?.length ? `: no ${link.missing.join(', ')}` : ''}.` }, 400);
    return json({ ok: true, url: link.url.replace(/([?&])from=checklist&task=0/, '$1from=checklist'), match: `${next.match.home} vs ${next.match.away}`, filled: fillPlaceholders(v.value.link_route || v.value.link_url, next.ctx).url });
  }
  if (b.action === 'save') {
    const v = cleanTask(b.task);
    if (v.error) return json({ error: v.error }, 400);
    const t = v.value;
    if (b.task.id) {
      const r = await db.prepare(`UPDATE checklist_template_tasks SET title = ?, description = ?, phase = ?, due_offset_minutes = ?, remind_from_offset_minutes = ?, default_owner_role_or_unit = ?,
        priority = ?, applies_to = ?, link_type = ?, link_route = ?, link_url = ?, link_label = ?, updated_at = ? WHERE id = ? AND template_id = ?`)
        .bind(t.title, t.description, t.phase, t.due_offset_minutes, t.remind_from_offset_minutes, t.default_owner_role_or_unit, t.priority, t.applies_to, t.link_type, t.link_route, t.link_url, t.link_label, now, Number(b.task.id), tpl.id).run();
      if (!r.meta?.changes) return json({ error: 'Task not found' }, 404);
    } else {
      const max = await db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM checklist_template_tasks WHERE template_id = ?`).bind(tpl.id).first();
      await db.prepare(`INSERT INTO checklist_template_tasks (template_id, title, description, phase, due_offset_minutes, remind_from_offset_minutes, default_owner_role_or_unit, priority, applies_to, sort_order, link_type, link_route, link_url, link_label, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(tpl.id, t.title, t.description, t.phase, t.due_offset_minutes, t.remind_from_offset_minutes, t.default_owner_role_or_unit, t.priority, t.applies_to, max.m + 10, t.link_type, t.link_route, t.link_url, t.link_label, now, now).run();
    }
    await logAdminAction(db, admin, 'checklist_template', `${b.task.id ? 'Changed' : 'Added'} template task "${t.title}"`);
    return json({ ok: true });
  }
  if (b.action === 'delete') {
    const t = await db.prepare(`SELECT title FROM checklist_template_tasks WHERE id = ? AND template_id = ?`).bind(Number(b.id), tpl.id).first();
    if (!t) return json({ error: 'Task not found' }, 404);
    await db.prepare(`DELETE FROM checklist_template_tasks WHERE id = ? AND template_id = ?`).bind(Number(b.id), tpl.id).run();
    await logAdminAction(db, admin, 'checklist_template', `Removed template task "${t.title}" (existing checklists keep it)`);
    return json({ ok: true });
  }
  if (b.action === 'reorder') {
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 300);
    if (!ids.length) return json({ error: 'Nothing to reorder.' }, 400);
    await db.batch(ids.map((id, i) => db.prepare(`UPDATE checklist_template_tasks SET sort_order = ?, updated_at = ? WHERE id = ? AND template_id = ?`).bind((i + 1) * 10, now, id, tpl.id)));
    return json({ ok: true });
  }
  return json({ error: 'Unknown action' }, 400);
}
