// Admin roles and permissions. Used by the server (page and API middleware,
// so a link typed in directly is refused too) and by the admin sidebar (which
// only shows what the signed-in person can open).
//
// Each role is a list of permissions (PERMISSIONS below, as in the club's
// staff access plan). A Super Admin can change what a role includes on
// Staff › Roles (stored in admin_roles; the defaults here are used until then).
// The owner (ADMIN_CODE) is always a Super Admin. Only roles with fans.export
// (Super Admin and CRM Manager by default) can download fan contact data.

export const PERMISSIONS = [
  { group: 'Content', items: [
    ['content.news.edit', 'Write and edit news articles'],
    ['content.news.publish', 'Publish news articles'],
    ['content.team_news.edit', 'Team news (injuries and availability)'],
    ['content.programme.edit', 'Matchday Programme'],
    ['content.club_pages.edit', 'Club pages (history, honours, squad, staff, stadium, community, awards)'],
    ['content.help.edit', 'Help and FAQ pages'],
    ['content.videos.edit', 'Video library'],
    ['content.gallery.edit', 'Photo gallery'],
    ['media.upload', 'Upload pictures (homepage images, partner logos)'],
  ] },
  { group: 'Matchday', items: [
    ['matchday.fixtures.edit', 'Fixtures, results, the table and match settings'],
    ['matchday.scores', 'Score verification for all conference games: score sources, reports, unmatched team names (Website & Data Officer, Super Admins)'],
    ['matchday.live_control', 'Live Match Control: kick-off, score, full time, timeline'],
    ['matchday.stats.edit', 'Match and player stats'],
    ['matchday.squad.edit', 'Matchday squad and line-ups'],
    ['matchday.motm.manage', 'Man of the Match voting'],
    ['matchday.predict.manage', 'Predict & Win: entries, disqualify, rules'],
    ['matchday.predict.pay_prizes', 'Predict & Win: mark prizes as paid'],
    ['matchday.live_updates', 'Live updates: match preview and report, fan match alerts, sharing to socials'],
    ['matchday.checklist.view', 'Match Checklist: view, notes, files, "in progress" / "submitted", PDF and email (ticking done: Super Admins only)'],
  ] },
  { group: 'Broadcast', items: [
    ['broadcast.watch_live.edit', 'Watch Live stream links'],
    ['broadcast.commentary.manage', 'Live Commentary'],
  ] },
  { group: 'Fans', items: [
    ['fans.inbox.read', 'Inbox: read messages'],
    ['fans.inbox.reply', 'Inbox: reply, notes, assign, close'],
    ['fans.inbox.general', 'Inbox: general fan messages (contact form)'],
    ['fans.inbox.media', 'Inbox: the media@lobistarsfc.com mailbox'],
    ['fans.accounts.view', "See fans' full details (emails, phone numbers)"],
    ['fans.accounts.edit', 'Edit or delete fans, merge duplicates'],
    ['fans.members.manage', 'Members: confirm or remove memberships'],
    ['fans.database.view', 'Fan database and contact sources (details partly hidden)'],
    ['fans.newsletter.manage', 'Newsletter: write and edit'],
    ['fans.newsletter.send', 'Newsletter: send or schedule to subscribers'],
    ['fans.export', 'Download fan contact data'],
  ] },
  { group: 'Rewards', items: [
    ['rewards.settings', 'Rewards settings, terms and the launch switch'],
    ['rewards.catalogue', 'Rewards catalogue'],
    ['rewards.members.view', 'Look up Rewards members'],
    ['rewards.points.adjust', 'Adjust points'],
    ['rewards.fulfilment', 'Fulfilment and vouchers'],
  ] },
  { group: 'Partners', items: [
    ['partners.manage', 'Partners, partner profiles and newsletter sponsor adverts'],
    ['partners.enquiries', 'Sponsorship and hospitality enquiries (Inbox)'],
    ['partners.reports', 'Monthly partner reports and QR campaigns'],
  ] },
  { group: 'Commerce', items: [
    ['commerce.shop.manage', 'Club shop products'],
    ['commerce.hospitality.manage', 'Hospitality packages'],
    ['commerce.personalisation.manage', 'Shirt personalisation orders'],
    ['commerce.tickets.manage', 'Match tickets, season tickets, discounts, refunds'],
    ['commerce.gate_scan', 'Gate ticket scanner'],
    ['commerce.kitchen.manage', 'Food orders, menu, prices and kitchen alerts'],
    ['commerce.kitchen.board', 'Kitchen order board (Kitchen Screen)'],
  ] },
  { group: 'Analytics', items: [
    ['analytics.view_all', 'All reports (traffic, matchday, food, contact sources)'],
    ['analytics.broadcast', 'Commentary / broadcast report'],
    ['analytics.partners', 'Partner reports'],
  ] },
  { group: 'Settings', items: [
    ['settings.site', 'Site settings and contact sources'],
    ['settings.promo_bar', 'Promo bar'],
    ['settings.social_links', 'Social links'],
    ['settings.commentary', 'Commentary and stream settings'],
    ['staff.manage', 'Staff accounts, roles, login security and backups'],
    ['logs.view', 'Activity log and export log'],
    ['approvals.approve', 'Approve or reject sensitive actions'],
    ['website.health', 'Website Health (only the three Super Admins)'],
    ['squad.portal.manage', 'Squad & Staff Data Portal: link, login, on/off, sessions and season (only the three Super Admins)'],
    ['squad.review', 'Squad profile submissions: verify and publish, request changes, left the club, exports (Website & Data Officer, Super Admins)'],
    ['squad.records.full', 'Full club records download including private details (only the three Super Admins)'],
    ['ai.fix', 'AI Fix and AI Settings: Claude prepares fixes, a Super Admin approves (only the three Super Admins)'],
    ['seo.scanner', 'SEO Scanner: Google rankings, site checks and SEO fixes (only the three Super Admins)'],
    ['ai.prepare', 'AI Fix: ask Claude to prepare a fix, see Fix history and results (applying stays with the Super Admins)'],
    ['ai.draft', 'Match Checklist: "Draft with Claude" on writing tasks (saved as Draft only)'],
    ['helpers.create', 'Create matchday helper accounts (gate and kitchen)'],
  ] },
];
export const ALL_PERMISSIONS = PERMISSIONS.flatMap(g => g.items.map(([id]) => id));
const ALL = new Set(ALL_PERMISSIONS);
const starts = (...prefixes) => ALL_PERMISSIONS.filter(p => prefixes.some(x => p.startsWith(x)));

// The built-in roles (the club's staff access plan). Lobi Stars has one first team.
export const ROLE_DEFAULTS = {
  // Only the three people in the SUPER_ADMIN_EMAILS server setting (see superAdmins.js).
  super_admin: { label: 'Super Admin', job: 'One of the three website owners', permissions: ALL_PERMISSIONS, locked: true,
    about: 'Everything, including staff accounts, roles, approvals, security settings, Website Health and backups. Only the three people in the Super Admin list.' },
  head_of_media: { label: 'Head of Media', job: 'Head of Media & Communications', about: 'All content, matchday, broadcast, fans and Inbox, Rewards, partners, commerce and reports, plus site settings. Not staff, approvals, logs, fan-data downloads, security settings, Website Health or service keys.',
    permissions: ALL_PERMISSIONS.filter(p => !['staff.manage', 'logs.view', 'approvals.approve', 'fans.export', 'website.health', 'ai.fix', 'matchday.scores', 'squad.portal.manage', 'squad.review', 'squad.records.full', 'seo.scanner'].includes(p)) },
  content_editor: { label: 'Content Editor', job: 'Media Officer / Club Writer', about: 'All website content (news, team news, programme, club pages, help, videos, gallery), uploads, and writing the newsletter (not sending it to subscribers).',
    permissions: [...starts('content.'), 'fans.newsletter.manage', 'media.upload', 'fans.inbox.read', 'fans.inbox.reply', 'fans.inbox.media'] },
  media_editor: { label: 'Media Editor', job: 'Social Media & Video Officer', about: 'Videos, gallery, uploads and live matchday updates (preview, report, fan alerts, sharing to socials).',
    permissions: ['content.videos.edit', 'content.gallery.edit', 'media.upload', 'matchday.live_updates', 'fans.inbox.read', 'fans.inbox.reply', 'fans.inbox.media'] },
  media_contributor: { label: 'Media Contributor', job: 'Graphic Designer & Club Photographer', about: 'Uploads only: gallery, homepage images and partner logos.',
    permissions: ['media.upload', 'content.gallery.edit'] },
  matchday_admin: { label: 'Matchday Admin', job: 'Website & Data Officer', about: 'Everything on matchday except broadcasting: fixtures, Live Match Control, stats, squad, Man of the Match, Predict & Win; site settings, promo bar and social links.',
    permissions: [...starts('matchday.'), 'squad.review', 'settings.site', 'settings.promo_bar', 'settings.social_links'] },
  broadcast_operator: { label: 'Broadcast Operator', job: 'Live Broadcast Coordinator', about: 'Watch Live links, Live Commentary, commentary settings and the broadcast report.',
    permissions: [...starts('broadcast.'), 'settings.commentary', 'analytics.broadcast'] },
  crm_manager: { label: 'CRM Manager', job: 'CRM Officer', about: 'All fan data (including downloads), the whole Inbox, newsletter, Rewards and all reports.',
    permissions: [...starts('fans.', 'rewards.'), 'partners.enquiries', 'analytics.view_all'] },
  fan_support: { label: 'Fan Support', job: 'Fan Relations & Membership Officer', about: 'General fan messages, fan accounts and memberships, Rewards look-up and fulfilment, paying Predict & Win prizes. No downloads.',
    permissions: ['fans.inbox.read', 'fans.inbox.reply', 'fans.inbox.general', 'fans.accounts.view', 'fans.accounts.edit', 'fans.members.manage', 'fans.database.view', 'rewards.members.view', 'rewards.fulfilment', 'matchday.predict.pay_prizes'] },
  commercial_manager: { label: 'Commercial Manager', job: 'Commercial & Partnerships Officer', about: 'Partners, shop, hospitality, shirt personalisation, sponsorship and hospitality enquiries, partner reports.',
    permissions: [...starts('partners.'), 'commerce.shop.manage', 'commerce.hospitality.manage', 'commerce.personalisation.manage', 'fans.inbox.read', 'fans.inbox.reply', 'analytics.partners'] },
  matchday_ops_manager: { label: 'Matchday Operations Manager', job: 'Ticketing & Matchday Operations Officer', about: 'Tickets, the gate scanner, food orders and the kitchen; creates matchday helper accounts.',
    permissions: ['commerce.tickets.manage', 'commerce.gate_scan', 'commerce.kitchen.manage', 'commerce.kitchen.board', 'helpers.create'] },
  // Temporary developer / contractor access: an end date (at most 14 days), no fans' personal data or downloads.
  contractor: { label: 'Contractor', job: 'Developer / contractor (temporary, max 14 days)', contractor: true, about: 'Temporary access for a developer or contractor: content, matchday, broadcast and site settings. No fans, Inbox, Rewards, downloads, staff or logs. Every sign-in is reported to the Super Admins.',
    permissions: [...starts('content.', 'matchday.', 'broadcast.').filter(p => p !== 'matchday.scores'), 'media.upload', 'settings.site', 'settings.promo_bar', 'settings.social_links', 'settings.commentary'] },
  gate_staff: { label: 'Gate Staff', job: 'Matchday helper', helper: true, about: 'Only the gate ticket scanner.', permissions: ['commerce.gate_scan'] },
  kitchen_staff: { label: 'Kitchen Staff', job: 'Matchday helper', helper: true, about: 'Only the Kitchen order board.', permissions: ['commerce.kitchen.board'] },
  // Older role names, kept so existing accounts keep working. Not offered for new accounts.
  staff: { label: 'All areas (old)', legacy: true, about: 'Accounts made before roles existed: everything except staff management, approvals and downloads.',
    permissions: ALL_PERMISSIONS.filter(p => !['staff.manage', 'approvals.approve', 'fans.export', 'ai.fix', 'matchday.scores', 'squad.portal.manage', 'squad.review', 'squad.records.full', 'seo.scanner'].includes(p)) },
  analyst: { label: 'Analyst (read-only, old)', legacy: true, readOnly: true, about: 'Reports only; cannot change anything.',
    permissions: ['analytics.view_all', 'analytics.broadcast', 'analytics.partners'] },
};
// Old ids that now mean a new role.
export const ROLE_ALIASES = { media: 'content_editor', matchday: 'matchday_admin', commercial: 'commercial_manager', fan_relations: 'fan_support', kitchen: 'kitchen_staff' };
export const ASSIGNABLE_ROLES = Object.keys(ROLE_DEFAULTS).filter(id => !ROLE_DEFAULTS[id].legacy);

// ── Role changes saved by a Super Admin (admin_roles), cached for 30 seconds per server ──
let saved = {};
let loadedAt = 0;
export async function ensureRolesSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS admin_roles (
    id TEXT PRIMARY KEY, permissions TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT
  )`).run();
}
/** Loads the saved role changes (call before the checks below; cheap when cached). */
export async function loadRoles(db, { force = false } = {}) {
  if (!db || (!force && Date.now() - loadedAt < 30000)) return;
  try {
    await ensureRolesSchema(db);
    const { results } = await db.prepare(`SELECT id, permissions FROM admin_roles`).all();
    const next = {};
    for (const r of results) { try { next[r.id] = JSON.parse(r.permissions).filter(p => ALL.has(p)); } catch { /* ignore a bad row */ } }
    saved = next;
    loadedAt = Date.now();
  } catch (err) { console.error('[roles] load', err); }
}
/** Saves a role's permissions (Super Admin only; the Super Admin role cannot be changed). null = back to the default. */
export async function saveRole(db, id, permissions, by) {
  await ensureRolesSchema(db);
  if (permissions === null) await db.prepare(`DELETE FROM admin_roles WHERE id = ?`).bind(id).run();
  else await db.prepare(`INSERT INTO admin_roles (id, permissions, updated_at, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET permissions = excluded.permissions, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(id, JSON.stringify(permissions), new Date().toISOString(), by || null).run();
  await loadRoles(db, { force: true });
}
// Given to every staff role except the matchday helpers (gate, kitchen), also
// when a Super Admin has customised the role: all admins see the Match Checklist.
const EVERY_STAFF_ROLE = ['matchday.checklist.view'];
/** The permissions of a role id right now (saved change or default). */
export function rolePermissions(id) {
  const def = ROLE_DEFAULTS[id];
  if (!def) return [];
  if (def.locked) return ALL_PERMISSIONS;
  const base = saved[id] || def.permissions;
  if (def.helper) return base;
  // AI help follows the reports and writing a role already has.
  const derived = [];
  if (base.includes('analytics.view_all')) derived.push('ai.prepare', 'ai.draft');
  if (base.some(p => p === 'content.news.edit' || p === 'content.team_news.edit')) derived.push('ai.draft');
  return [...new Set([...base, ...EVERY_STAFF_ROLE, ...derived])];
}
export const roleChanged = id => !!saved[id] && !ROLE_DEFAULTS[id]?.locked;

/** The owner (admin code) is a Super Admin. Old role names map to the new ones. Unknown roles get nothing. */
export const roleOf = admin => {
  if (admin?.role === 'owner') return 'super_admin';
  const r = ROLE_ALIASES[admin?.role] || admin?.role;
  return ROLE_DEFAULTS[r] ? r : 'none';
};
export const roleLabel = admin => (admin?.role === 'owner' ? 'Super Admin (emergency admin code)' : ROLE_DEFAULTS[roleOf(admin)]?.label || 'No access');
export const permissionsOf = admin => [...new Set(rolePermissions(roleOf(admin)))];
/** Does this admin have the permission? 'a|b' = any of them. */
export const can = (admin, perm) => {
  if (!perm) return true;
  const mine = new Set(permissionsOf(admin));
  return perm.split('|').some(p => mine.has(p));
};

/** Inbox sources this admin may see: null = all of them, otherwise a list (possibly empty).
 *  Fan Support: general messages; Commercial: sponsorship and hospitality; Media: media@; CRM and Super Admin: all. */
const INBOX_PERMS = { contact_form: 'fans.inbox.general', sponsorship: 'partners.enquiries', hospitality: 'partners.enquiries', media_email: 'fans.inbox.media' };
export const inboxSources = admin => {
  if (!can(admin, 'fans.inbox.read')) return [];
  const list = Object.keys(INBOX_PERMS).filter(s => can(admin, INBOX_PERMS[s]));
  return list.length === Object.keys(INBOX_PERMS).length ? null : list;
};
export const inboxPermFor = source => INBOX_PERMS[source] || 'fans.inbox.general';
export const canSeeInboxSource = (admin, source) => can(admin, 'fans.inbox.read') && can(admin, inboxPermFor(source));

// ── The content CMS (/admin/): each person sees only the sections they may edit ──
// The CMS saves to GitHub with the person's own GitHub access, so who can
// sign in to the CMS at all is set in GitHub (handover list); this decides
// which sections the CMS shows them.
const CMS_COLLECTIONS = {
  news: 'content.news.edit|content.news.publish|content.team_news.edit',
  players: 'content.club_pages.edit|matchday.squad.edit',
  gallery: 'content.gallery.edit',
  staff: 'content.club_pages.edit',
  heroSlides: 'media.upload|content.club_pages.edit',
  partners: 'partners.manage|media.upload',
};
const CMS_SETTINGS = {
  roleEmails: 'settings.site', promo: 'settings.promo_bar', hospitality: 'commerce.hospitality.manage', membership: 'fans.members.manage', predictLeague: 'matchday.predict.manage',
  site: 'settings.site|settings.social_links', shop: 'commerce.shop.manage|commerce.personalisation.manage', videos: 'content.videos.edit',
  history: 'content.club_pages.edit', honours: 'content.club_pages.edit', values: 'content.club_pages.edit', community: 'content.club_pages.edit',
  transparency: 'content.club_pages.edit', stadium: 'content.club_pages.edit', fanClubs: 'content.club_pages.edit|fans.members.manage', partnership: 'partners.manage',
};
function CMS_ANY() {
  return [...new Set([...Object.values(CMS_COLLECTIONS), ...Object.values(CMS_SETTINGS)].join('|').split('|'))].join('|');
}
/** The CMS config (config.yml text) with only the sections this admin may edit. */
export function cmsConfigFor(admin, yaml, { predictNeedsApproval = false } = {}) {
  if (roleOf(admin) === 'super_admin') return yaml;
  const anyFile = Object.values(CMS_SETTINGS).some(p => can(admin, p));
  const out = [];
  let inCollections = false, dropTop = false, dropFile = false;
  for (const line of String(yaml).split('\n')) {
    if (!inCollections) { out.push(line); if (/^collections:/.test(line)) inCollections = true; continue; }
    if (/^\S/.test(line)) { inCollections = false; out.push(line); continue; } // the next top-level setting
    const top = line.match(/^ {2}- name: "?([A-Za-z0-9_]+)"?/);
    if (top) {
      dropFile = false;
      dropTop = top[1] === 'settings' ? !anyFile : !(top[1] in CMS_COLLECTIONS && can(admin, CMS_COLLECTIONS[top[1]]));
    }
    if (dropTop) continue;
    const file = line.match(/^ {6}- name: "?([A-Za-z0-9_]+)"?/);
    if (file) dropFile = !(file[1] in CMS_SETTINGS && can(admin, file[1] === 'predictLeague' && predictNeedsApproval ? 'approvals.approve' : CMS_SETTINGS[file[1]]));
    if (dropFile) continue;
    out.push(line);
  }
  return out.join('\n');
}

// Areas: coarse names used by the dashboard cards, notifications and search.
// Each area is open when the person has any of its permissions.
const AREAS = {
  overview: null,
  matchday: 'matchday.live_control|matchday.fixtures.edit|matchday.predict.manage|matchday.predict.pay_prizes|matchday.motm.manage|broadcast.commentary.manage|settings.commentary',
  'matchday-content': 'matchday.fixtures.edit|matchday.live_control|matchday.squad.edit|matchday.stats.edit|matchday.live_updates|broadcast.watch_live.edit|content.programme.edit',
  content: 'content.news.edit|content.news.publish|content.team_news.edit|content.club_pages.edit',
  cms: CMS_ANY(),
  fans: 'fans.database.view|fans.accounts.view',
  inbox: 'fans.inbox.read',
  newsletter: 'fans.newsletter.manage',
  commerce: 'commerce.tickets.manage|commerce.kitchen.manage|commerce.personalisation.manage|commerce.shop.manage|commerce.hospitality.manage',
  kitchen: 'commerce.kitchen.board|commerce.kitchen.manage',
  partners: 'partners.manage|partners.reports',
  analytics: 'analytics.view_all',
  settings: 'logs.view|settings.site',
  staff: 'staff.manage',
};
export const areasOf = admin => Object.keys(AREAS).filter(a => can(admin, AREAS[a]));
export const canAccess = (admin, area) => !area || (area in AREAS ? can(admin, AREAS[area]) : false);

// What each admin page or API needs (first match wins). [path, read, write]:
// any one of the listed permissions; write (POST, PUT, DELETE…) defaults to read;
// null = any signed-in staff. A path not listed is Super Admin only.
const MATCH_ANY = 'matchday.fixtures.edit|matchday.live_control|matchday.stats.edit|matchday.squad.edit|matchday.motm.manage|matchday.predict.manage|matchday.live_updates|broadcast.watch_live.edit|broadcast.commentary.manage|settings.commentary|content.programme.edit|commerce.tickets.manage';
const CENTRE_WRITE = 'matchday.live_control|matchday.squad.edit|matchday.stats.edit|matchday.live_updates|broadcast.watch_live.edit';
const REWARDS_ANY = 'rewards.settings|rewards.catalogue|rewards.members.view|rewards.points.adjust|rewards.fulfilment';
const RULES = [
  // Pages
  [/^\/admin\/(dashboard|login|account|invite|reset)(\/|$)/, null],
  [/^\/admin\/fan-alerts(\/|$)/, 'matchday.live_updates'],
  [/^\/admin\/matches(\/|$)/, 'matchday.fixtures.edit|commerce.tickets.manage|broadcast.commentary.manage|matchday.live_control'],
  [/^\/admin\/predictions(\/|$)/, 'matchday.predict.manage|matchday.predict.pay_prizes'],
  [/^\/admin\/commentary(\/|$)/, 'broadcast.commentary.manage|settings.commentary'],
  [/^\/admin\/match-centre(\/|$)/, `${CENTRE_WRITE}|matchday.fixtures.edit|matchday.motm.manage`],
  // Match Checklist: every staff role; Super-Admin-only actions are checked in the API itself.
  [/^\/admin\/match-checklist(\/|$)/, 'matchday.checklist.view'],
  [/^\/admin\/(programmes|programme-preview)(\/|$)/, 'content.programme.edit'],
  [/^\/admin\/share(\/|$)/, 'matchday.live_updates|content.programme.edit|media.upload'],
  [/^\/admin\/squad-portal(\/|$)/, 'squad.portal.manage'],
  [/^\/admin\/squad-profiles(\/|$)/, 'squad.review'],
  [/^\/admin\/scores(\/|$)/, 'matchday.scores'],
  [/^\/admin\/league(\/|$)/, 'matchday.fixtures.edit|matchday.live_control'],
  [/^\/admin\/news(\/|$)/, 'content.news.edit|content.news.publish|content.team_news.edit'],
  [/^\/admin\/awards(\/|$)/, 'content.club_pages.edit'],
  [/^\/admin\/inbox(\/|$)/, 'fans.inbox.read'],
  [/^\/admin\/newsletter(\/|$)/, 'fans.newsletter.manage|partners.manage'],
  [/^\/admin\/contact-sources(\/|$)/, 'fans.database.view|analytics.view_all|settings.site'],
  [/^\/admin\/members(\/|$)/, 'fans.members.manage|fans.accounts.view'],
  [/^\/admin\/fans(\/|$)/, 'fans.database.view|fans.accounts.view'],
  [/^\/admin\/rewards\/analytics(\/|$)/, 'analytics.view_all|rewards.settings'],
  [/^\/admin\/rewards(\/|$)/, REWARDS_ANY],
  [/^\/admin\/kitchen(\/|$)/, 'commerce.kitchen.board|commerce.kitchen.manage'],
  [/^\/admin\/food-orders\/analytics(\/|$)/, 'commerce.kitchen.manage|analytics.view_all'],
  [/^\/admin\/tickets\/scan(\/|$)/, 'commerce.gate_scan'],
  [/^\/admin\/tickets(\/|$)/, 'commerce.tickets.manage'],
  [/^\/admin\/shirt-orders(\/|$)/, 'commerce.personalisation.manage'],
  [/^\/admin\/food-orders(\/|$)/, 'commerce.kitchen.manage'],
  [/^\/admin\/season-tickets(\/|$)/, 'commerce.tickets.manage'],
  [/^\/admin\/partners(\/|$)/, 'partners.manage|partners.reports'],
  [/^\/admin\/analytics(\/|$)/, 'analytics.view_all|analytics.broadcast|analytics.partners'],
  [/^\/admin\/activity(\/|$)/, 'logs.view'],
  [/^\/admin\/health(\/|$)/, 'website.health'],
  [/^\/admin\/seo(\/|$)/, 'seo.scanner'],
  [/^\/admin\/ai\/settings(\/|$)/, 'ai.fix'],
  [/^\/admin\/ai(\/|$)/, 'ai.prepare|ai.fix'],
  [/^\/admin\/(staff|security|backup)(\/|$)/, 'staff.manage'],
  [/^\/admin\/approvals(\/|$)/, 'approvals.approve'],
  [/^\/admin\/helpers(\/|$)/, 'helpers.create'],
  [/^\/admin\/news-approvals\.json$/, 'approvals.approve|content.news.edit|content.news.publish'],
  [/^\/admin\/?(index\.html|config\.yml)?$/, CMS_ANY()],
  // APIs
  [/^\/api\/admin\/(login|logout|me|dashboard|search|notifications|account|invite|reset|export-ticket)(\/|$)/, null],
  // Any open admin page helps finish sending a match alert to fans.
  [/^\/api\/admin\/fan-alerts\/run(\/|$)/, null],
  [/^\/api\/admin\/fan-alerts(\/|$)/, 'matchday.live_updates'],
  [/^\/api\/admin\/match-centre(\/|$)/, `${CENTRE_WRITE}|matchday.fixtures.edit|matchday.motm.manage`, CENTRE_WRITE],
  [/^\/api\/admin\/match-checklist(\/|$)/, 'matchday.checklist.view'],
  [/^\/api\/admin\/programmes(\/|$)/, 'content.programme.edit'],
  [/^\/api\/admin\/qr(\/|$)/, 'content.programme.edit|partners.reports|partners.manage'],
  [/^\/api\/admin\/share(\/|$)/, 'matchday.live_updates|content.programme.edit|media.upload'],
  [/^\/api\/admin\/squad-portal(\/|$)/, 'squad.portal.manage'],
  [/^\/api\/admin\/squad-profiles(\/|$)/, 'squad.review'],
  [/^\/api\/admin\/scores(\/|$)/, 'matchday.scores'],
  [/^\/api\/admin\/league(\/|$)/, MATCH_ANY, 'matchday.fixtures.edit|matchday.live_control'],
  [/^\/api\/admin\/tickets(\/|$)/, 'commerce.tickets.manage'],
  [/^\/api\/admin\/rewards\/analytics(\/|$)/, 'analytics.view_all|rewards.settings'],
  [/^\/api\/admin\/rewards\/member(\/|$)/, REWARDS_ANY, 'rewards.points.adjust'],
  [/^\/api\/admin\/rewards\/fulfilment(\/|$)/, REWARDS_ANY, 'rewards.fulfilment'],
  [/^\/api\/admin\/rewards\/catalogue(\/|$)/, REWARDS_ANY, 'rewards.catalogue'],
  [/^\/api\/admin\/rewards(\/|$)/, REWARDS_ANY, 'rewards.settings'],
  [/^\/api\/admin\/events(\/|$)/, MATCH_ANY, 'matchday.fixtures.edit|commerce.tickets.manage|broadcast.commentary.manage|matchday.live_control'],
  [/^\/api\/admin\/predictions(\/|$)/, 'matchday.predict.manage|matchday.predict.pay_prizes'],
  [/^\/api\/admin\/motm(\/|$)/, 'matchday.motm.manage'],
  [/^\/api\/admin\/commentary(\/|$)/, 'broadcast.commentary.manage|settings.commentary'],
  [/^\/api\/admin\/awards(\/|$)/, 'content.club_pages.edit'],
  [/^\/api\/admin\/inbox\/settings(\/|$)/, 'fans.inbox.reply'],
  [/^\/api\/admin\/inbox(\/|$)/, 'fans.inbox.read', 'fans.inbox.reply'],
  [/^\/api\/admin\/newsletter(\/|$)/, 'fans.newsletter.manage|partners.manage'],
  [/^\/api\/admin\/fans\/export(\/|$)/, 'fans.export'],
  [/^\/api\/admin\/contact-source-defs(\/|$)/, 'fans.database.view|analytics.view_all|settings.site', 'settings.site'],
  [/^\/api\/admin\/contact-sources(\/|$)/, 'fans.database.view|analytics.view_all|settings.site'],
  [/^\/api\/admin\/members(\/|$)/, 'fans.members.manage|fans.accounts.view', 'fans.members.manage'],
  [/^\/api\/admin\/fans\/backfill(\/|$)/, 'staff.manage'],
  [/^\/api\/admin\/fans\/[^/]+(\/|$)/, 'fans.accounts.view|fans.database.view', 'fans.accounts.edit'],
  [/^\/api\/admin\/fans(\/|$)/, 'fans.database.view|fans.accounts.view', 'fans.accounts.edit'],
  [/^\/api\/admin\/kitchen\/settings(\/|$)/, 'commerce.kitchen.board|commerce.kitchen.manage', 'commerce.kitchen.manage'],
  [/^\/api\/admin\/kitchen(\/|$)/, 'commerce.kitchen.board|commerce.kitchen.manage'],
  [/^\/api\/admin\/food-analytics(\/|$)/, 'commerce.kitchen.manage|analytics.view_all'],
  [/^\/api\/admin\/shirt-orders(\/|$)/, 'commerce.personalisation.manage'],
  [/^\/api\/admin\/(food-orders|food-menu|food-photo|food-alerts)(\/|$)/, 'commerce.kitchen.manage'],
  [/^\/api\/admin\/season-tickets(\/|$)/, 'commerce.tickets.manage'],
  [/^\/api\/admin\/partner-report(\/|$)/, 'analytics.partners|partners.reports|analytics.view_all'],
  [/^\/api\/admin\/partner-reports(\/|$)/, 'partners.reports'],
  [/^\/api\/admin\/broadcast-report(\/|$)/, 'analytics.broadcast|analytics.view_all'],
  [/^\/api\/admin\/analytics-sync(\/|$)/, 'analytics.view_all'],
  [/^\/api\/admin\/analytics-google(\/|$)/, 'analytics.view_all'],
  [/^\/api\/admin\/analytics-recommendations(\/|$)/, 'analytics.view_all'],
  [/^\/api\/admin\/analytics(\/|$)/, 'analytics.view_all'],
  [/^\/api\/admin\/export-log(\/|$)/, 'logs.view|fans.export'],
  [/^\/api\/admin\/activity(\/|$)/, 'logs.view'],
  [/^\/api\/admin\/health(\/|$)/, 'website.health'],
  [/^\/api\/admin\/seo(\/|$)/, 'seo.scanner'],
  [/^\/api\/admin\/ai\/(settings|code)(\/|$)/, 'ai.fix'],
  [/^\/api\/admin\/ai(\/|$)/, 'ai.prepare|ai.fix'],
  [/^\/api\/admin\/(staff|roles|security|backup|access-review|role-emails)(\/|$)/, 'staff.manage'],
  [/^\/api\/admin\/approvals(\/|$)/, 'approvals.approve'],
  [/^\/api\/admin\/helpers(\/|$)/, 'helpers.create'],
];

/** The permission(s) a path needs; null = any signed-in staff; undefined = not listed (Super Admin only). */
export function permissionForPath(pathname, method = 'GET') {
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  for (const [re, read, w] of RULES) if (re.test(pathname)) return write && w !== undefined ? w : read;
  return undefined;
}

/** May this admin open this path? Write requests from read-only roles are refused. */
export function allowedPath(admin, pathname, method = 'GET') {
  const perm = permissionForPath(pathname, method);
  if (perm === null) return true;
  if (perm === undefined) return roleOf(admin) === 'super_admin';
  if (!can(admin, perm)) return false;
  // Read-only roles (the old Analyst) only read and download reports.
  if (ROLE_DEFAULTS[roleOf(admin)]?.readOnly && !['GET', 'HEAD'].includes(method) && !/^\/api\/admin\/(login|logout|me|account|fan-alerts\/run)/.test(pathname)) return false;
  return true;
}
