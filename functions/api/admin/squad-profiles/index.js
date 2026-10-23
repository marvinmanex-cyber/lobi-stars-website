import { requireAdminUser } from '../../_lib/adminEvents.js';
import { can } from '../../_lib/adminRoles.js';
import { listProfiles, counts, seasons, getProfile, profileView, reviewAction, deleteProfile, carryOver, getTeam, saveTeam, logExport, logProfile, ensureProfileSchema,
  nameCheckList, confirmName, saveFields, savePhoto, deletePhoto, shirtTaken, rowName, versionList, restoreVersion } from '../../_lib/squadProfiles.js';
import { legacyList, migrateLegacy } from '../../_lib/squadMigrate.js';
import { PUBLIC_STATUSES } from '../../../../src/lib/squadFields.js';
import { requestRebuild } from '../../_lib/squadPublish.js';
import { draftBio } from '../../_lib/squadBio.js';
import { exportData } from '../../_lib/squadExportData.js';
import { getPortalSettings, exportRecipients } from '../../_lib/squadPortal.js';
import { verifyTotp } from '../../_lib/totp.js';

// Squad › Profile Submissions (Website & Data Officer and Super Admins: squad.review).
// GET  ?season=&filter=&q=                  -- list, counts, seasons, team details, export log
// GET  ?id=                                 -- one profile with everything (photos, recording, private details)
// GET  ?export=1&which=&season=             -- data for an export (Public and Media fields only)
// POST { action: 'approve' (old name 'verify') | 'request_changes' | 'left' | 'restore' | 'discard', id, note }
// GET  ?versions=<id>                       -- the live versions of a profile (Super Admins)
// POST { action: 'restore_version', id, n } -- an earlier version becomes the working copy, waiting for approval (Super Admins)
// GET  ?legacy=1                            -- the old hand-made squad files (the migration list; Super Admins)
// POST { action: 'migrate', keys, switchOff } -- move the chosen ones into the portal (live, "migrated – please review"),
//                                              and/or switch the old files off (Super Admins)
// POST { action: 'remove', id }             -- Super Admins only (any status; logged)
// POST { action: 'carry_over', from, to }   -- Super Admins: live profiles into a new season (still live)
// POST { action: 'team', team }             -- Super Admins: team details in the Data Package
// POST { action: 'publish' }                -- rebuild the website now (Squad pages)
// POST { action: 'export_log', format, which, season, profiles, ok, note }
// POST { action: 'full_records', which, season, code } -- Super Admins (squad.records.full): every field including private ones,
//                                              after the two-step code (if two-step login is on for them); logged
// Super Admins (squad.records.full) also edit profiles (22 Oct 2026):
// GET  ?names=1                             -- the name check: old single names with a proposed surname / first / middle name
// POST { action: 'confirm_name', id, surname, firstName, middleName, websiteName }
// POST { action: 'edit', id, changes }      -- any answer and the club-only fields (name on website, debut, bio, shirt link, hide);
//                                              any status; answers { saved, errors, warnings } (e.g. a shirt number used twice)
// POST multipart { id, kind: profile|action|hero, w400, w1200, jpg, w2000? }  -- a photo (processed in the browser)
// POST { action: 'delete_photo', id, kind }
// POST { action: 'draft_bio', id, extra }   -- "Draft bio with Claude": a preview only (never saved by itself)
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });
const superOnly = admin => can(admin, 'squad.portal.manage');

export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (!can(admin, 'squad.review')) return json({ error: 'Only the Website & Data Officer and Super Admins can review squad profiles.' }, 403);
  const db = env.DB;
  await ensureProfileSchema(db);
  const u = new URL(request.url);
  if (u.searchParams.get('id')) {
    const p = await getProfile(db, u.searchParams.get('id'));
    return p ? json({ profile: profileView(p) }) : json({ error: 'Profile not found.' }, 404);
  }
  if (u.searchParams.get('versions')) {
    if (!superOnly(admin)) return json({ error: 'Only Super Admins can see earlier versions.' }, 403);
    return json({ versions: await versionList(db, u.searchParams.get('versions')) });
  }
  if (u.searchParams.get('legacy')) {
    if (!superOnly(admin)) return json({ error: 'Only Super Admins can move the old squad files.' }, 403);
    return json(await legacyList(env, u.origin));
  }
  if (u.searchParams.get('export')) {
    // Exports: Super Admins only (23 Oct 2026).
    if (!superOnly(admin)) return json({ error: 'Only Super Admins can export squad data.' }, 403);
    return json(await exportData(env, { which: u.searchParams.get('which') || 'verified', season: u.searchParams.get('season') || 'current' }));
  }
  if (u.searchParams.get('names')) {
    if (!can(admin, 'squad.records.full')) return json({ error: 'Only Super Admins can confirm names.' }, 403);
    return json({ names: await nameCheckList(db) });
  }
  const cur = (await getPortalSettings(db)).season;
  const season = u.searchParams.get('season') || cur;
  const log = (await db.prepare(`SELECT * FROM squad_export_log ORDER BY id DESC LIMIT 30`).all()).results;
  return json({ season, current: cur, seasons: await seasons(db), counts: await counts(db, season), team: await getTeam(db), exportLog: superOnly(admin) ? log : [],
    canApprove: can(admin, 'squad.approve'), canSuper: superOnly(admin), canExport: superOnly(admin), exportTo: superOnly(admin) ? await exportRecipients(db) : [], canFull: can(admin, 'squad.records.full'), canEdit: can(admin, 'squad.records.full'), deployHook: !!env.PAGES_DEPLOY_HOOK,
    pendingNames: (await db.prepare(`SELECT COUNT(*) AS n FROM squad_profiles WHERE name_status IN ('pending', 'check') AND deleted_at IS NULL`).first())?.n || 0,
    profiles: await listProfiles(db, { season, filter: u.searchParams.get('filter') || 'submitted', q: u.searchParams.get('q') || '' }) });
}

export async function onRequestPost({ request, env, waitUntil }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (!can(admin, 'squad.review')) return json({ error: 'Only the Website & Data Officer and Super Admins can review squad profiles.' }, 403);
  const db = env.DB;
  await ensureProfileSchema(db);
  const rebuild = why => { const j = requestRebuild(env, why).catch(() => null); if (waitUntil) waitUntil(j); };
  const editor = () => can(admin, 'squad.records.full');
  // A photo from the edit panel (multipart).
  if ((request.headers.get('Content-Type') || '').startsWith('multipart/form-data')) {
    if (!editor()) return json({ error: 'Only Super Admins can change profiles.' }, 403);
    const form = await request.formData().catch(() => null);
    if (!form) return json({ error: 'The upload did not arrive. Please try again.' }, 400);
    const id = String(form.get('id') || '');
    const r = await savePhoto(env, admin, id, form, { admin: true });
    if (r.ok && PUBLIC_STATUSES.includes((await getProfile(db, id))?.status)) rebuild('photo changed');
    return r.error ? json(r, r.status || 400) : json(r);
  }
  const b = await request.json().catch(() => ({}));
  let r;
  if (['verify', 'approve', 'request_changes', 'left', 'restore', 'discard'].includes(b.action)) {
    // Approving and everything that changes the website: Super Admins only (Approval Queue, 23 Oct 2026).
    if (!can(admin, 'squad.approve')) return json({ error: 'Only the Super Admins can approve or change what is on the website (Squad › Approvals).' }, 403);
    const before = await getProfile(db, b.id);
    r = await reviewAction(env, admin, b.id, b.action, b.note);
    // The website changes only when a live version changes (approve, left, restore).
    if (r.ok && ['verify', 'approve', 'left', 'restore'].includes(b.action)) rebuild(`${b.action} ${rowName(before)}`);
  } else if (b.action === 'restore_version') {
    if (!superOnly(admin)) return json({ error: 'Only Super Admins can restore an earlier version.' }, 403);
    r = await restoreVersion(env, admin, b.id, b.n);
  } else if (b.action === 'migrate') {
    if (!superOnly(admin)) return json({ error: 'Only Super Admins can move the old squad files.' }, 403);
    r = await migrateLegacy(env, admin, new URL(request.url).origin, { keys: Array.isArray(b.keys) ? b.keys.map(String) : [], switchOff: !!b.switchOff });
    if (r.ok) rebuild('old squad files');
  } else if (b.action === 'draft_bio') {
    if (!editor()) return json({ error: 'Only Super Admins can change profiles.' }, 403);
    r = await draftBio(env, admin, b.id, b.extra);
  } else if (b.action === 'confirm_name' || b.action === 'edit' || b.action === 'delete_photo') {
    if (!editor()) return json({ error: 'Only Super Admins can change profiles.' }, 403);
    const before = await getProfile(db, b.id);
    if (!before) return json({ error: 'Profile not found.' }, 404);
    if (b.action === 'confirm_name') r = await confirmName(env, admin, b);
    else if (b.action === 'delete_photo') r = await deletePhoto(env, admin, b.id, String(b.kind || ''), { admin: true });
    else {
      r = await saveFields(env, admin, b.id, { changes: b.changes || {}, commit: true, allowAnyStatus: true, admin: true });
      if (r.ok) {
        const p = await getProfile(db, b.id), warnings = [];
        if (p.type === 'player' && p.shirt_number) {
          const t = await shirtTaken(db, { season: p.season, number: p.shirt_number, exceptId: p.id });
          if (t) warnings.push(`Shirt number ${p.shirt_number} is also given to ${t.display_name || 'another player'} this season.`);
        }
        r = { ok: true, saved: r.saved, errors: r.errors, warnings, profile: profileView(p) };
      }
    }
    // An edit of a live profile waits for approval: the website does not change yet.
  } else if (b.action === 'remove') {
    if (!superOnly(admin)) return json({ error: 'Only Super Admins can remove a submitted or verified profile.' }, 403);
    const before = await getProfile(db, b.id);
    r = await deleteProfile(env, admin, b.id, { force: true });
    if (r.ok && PUBLIC_STATUSES.includes(before?.status)) rebuild('removed a live profile');
  } else if (b.action === 'carry_over') {
    if (!superOnly(admin)) return json({ error: 'Only Super Admins can start a new season.' }, 403);
    r = await carryOver(env, admin, { from: b.from, to: b.to });
  } else if (b.action === 'team') {
    if (!superOnly(admin)) return json({ error: 'Only Super Admins can change the team details.' }, 403);
    r = { ok: true, team: await saveTeam(db, admin, b.team || {}) };
  } else if (b.action === 'publish') {
    r = await requestRebuild(env, `published by ${admin.name}`);
    if (!r.ok && r.reason) return json({ error: 'The website rebuild hook is not set up (PAGES_DEPLOY_HOOK). The Squad pages update with the next website update.' }, 503);
    r = { ok: true, message: r.skipped ? 'The website was asked to update a moment ago; it takes about 2 minutes.' : 'The website is updating; the Squad pages change in about 2 minutes.' };
  } else if (b.action === 'export_log') {
    if (!superOnly(admin)) return json({ error: 'Only Super Admins can export squad data.' }, 403);
    const format = String(b.format || '').slice(0, 20);
    await logExport(db, { by: admin.name, place: 'admin', format, filters: { which: b.which, season: b.season }, profiles: b.profiles, ok: b.ok !== false, note: b.note ? String(b.note).slice(0, 300) : null });
    if (b.ok !== false) await logProfile(db, admin, 'squad_export', `${admin.name} downloaded ${format === 'zip' ? 'the Media Partner Data Package' : /^records/.test(format) ? 'the full club records (including private details)' : `a ${format.toUpperCase()} export`} of ${Number(b.profiles) || 0} profiles`);
    r = { ok: true };
  } else if (b.action === 'full_records') {
    if (!can(admin, 'squad.records.full')) return json({ error: 'Only Super Admins can download the full club records.' }, 403);
    const u = await db.prepare(`SELECT totp_enabled, totp_secret, totp_last_step FROM admin_users WHERE id = ?`).bind(admin.id).first().catch(() => null);
    if (u?.totp_enabled) {
      const step = await verifyTotp(u.totp_secret, String(b.code || ''), u.totp_last_step || 0).catch(() => null);
      if (!step) return json({ error: 'The two-step code is not right. Enter the 6-digit code from your authenticator app.', needCode: true }, 403);
      await db.prepare(`UPDATE admin_users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?`).bind(step, admin.id, step).run();
    }
    const data = await exportData(env, { which: b.which || 'submitted', season: b.season || 'current', full: true });
    await logProfile(db, admin, 'squad_full_records', `${admin.name} opened the full club records (including private details) for ${data.profiles.length} profiles`);
    return json({ ...data, twoStep: !!u?.totp_enabled });
  } else return json({ error: 'Unknown action' }, 400);
  return r.error ? json(r, r.status || 400) : json(r);
}
