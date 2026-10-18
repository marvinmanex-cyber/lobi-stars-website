// Admin roles and permissions. Used by the server (page and API middleware,
// so a link typed in directly is refused too) and by the admin sidebar (which
// only shows what the signed-in person can open).
//
// Each role is a list of permissions (PERMISSIONS below). A Super Admin can
// change what a role includes on Staff › Roles (stored in admin_roles; the
// defaults here are used until then). The owner (ADMIN_CODE) is always a Super
// Admin. Downloading contact data needs "fans.export" in the role, or the
// "Can export fan data" switch on the staff account.

export const PERMISSIONS = [
  { group: 'Content', items: [
    ['content.news', 'News articles'],
    ['content.awards', 'Awards and Player of the Month'],
    ['content.cms', 'Content CMS (site pages, shop, partner profiles, settings)'],
  ] },
  { group: 'Matchday', items: [
    ['matchday.view', 'See Live Match Control and the League (read only)'],
    ['matchday.live', 'Run Live Match Control (kick-off, score, squad, streams, Man of the Match)'],
    ['matchday.matches', 'Match ticket and sale settings per match'],
    ['matchday.league', 'Fixtures, results and the table'],
    ['matchday.programmes', 'Matchday Programme'],
    ['matchday.share', 'Share any page and QR codes'],
    ['matchday.predictions', 'Predict & Win entries, winners and prizes'],
    ['matchday.commentary', 'Live Commentary and stream settings'],
    ['matchday.alerts', 'Fan Match Alerts (phone notifications)'],
    ['tickets.scan', 'Gate ticket scanner'],
  ] },
  { group: 'Fans', items: [
    ['fans.view', 'See the fan database and members'],
    ['fans.edit', 'Edit or delete fans, confirm members, merge duplicates'],
    ['fans.export', 'Download fan contact data'],
    ['fans.rewards', 'Rewards: look up members, adjust points, fulfilment'],
    ['fans.rewards.manage', 'Rewards: settings, catalogue, terms and the launch switch'],
    ['fans.newsletter', 'Write, schedule and send the newsletter'],
  ] },
  { group: 'Inbox', items: [
    ['inbox.contact', 'Inbox: contact form messages'],
    ['inbox.partners', 'Inbox: sponsorship and hospitality enquiries'],
    ['inbox.media', 'Inbox: the media@lobistarsfc.com mailbox'],
    ['inbox.settings', 'Inbox alert emails and daily summary'],
  ] },
  { group: 'Partners', items: [
    ['partners.manage', 'Partners, newsletter sponsor adverts and monthly partner reports'],
  ] },
  { group: 'Commerce', items: [
    ['commerce.tickets', 'Match tickets: prices, orders, refunds, discounts'],
    ['commerce.season', 'Season tickets'],
    ['commerce.food', 'Food orders, live board, menu, prices and kitchen alerts'],
    ['commerce.kitchen', 'Kitchen Screen (accept, cooking, ready)'],
    ['commerce.shirts', 'Shirt personalisation orders'],
  ] },
  { group: 'Analytics', items: [
    ['analytics.view', 'Traffic, matchday, commentary, food and partner reports'],
  ] },
  { group: 'Settings', items: [
    ['settings.activity', 'Activity log and export log'],
    ['settings.health', 'Website health'],
    ['settings.sources', 'Manage contact sources'],
  ] },
  { group: 'Staff (Super Admin)', items: [
    ['staff.manage', 'Staff accounts and roles'],
    ['staff.backup', 'Download a data backup'],
  ] },
];
export const ALL_PERMISSIONS = PERMISSIONS.flatMap(g => g.items.map(([id]) => id));
const ALL = new Set(ALL_PERMISSIONS);
const MATCHDAY_ALL = ALL_PERMISSIONS.filter(p => p.startsWith('matchday.')).concat('tickets.scan');

// The built-in roles. Lobi Stars has one first team; there are no other teams' roles.
export const ROLE_DEFAULTS = {
  super_admin: { label: 'Super Admin', permissions: ALL_PERMISSIONS, locked: true,
    about: 'Everything, including staff accounts, roles and backups.' },
  content_editor: { label: 'Content Editor', about: 'News, awards and the CMS; sees the Match Centre; writes the newsletter.',
    permissions: ['content.news', 'content.awards', 'content.cms', 'matchday.view', 'matchday.share', 'fans.newsletter'] },
  media_editor: { label: 'Media Editor', about: 'Content, matchday programme, results, sharing, the newsletter and the media@ mailbox.',
    permissions: ['content.news', 'content.awards', 'content.cms', 'matchday.view', 'matchday.programmes', 'matchday.share', 'matchday.league', 'fans.newsletter', 'inbox.media'] },
  media_contributor: { label: 'Media Contributor', about: 'Writes news and reads the media@ mailbox; sees the Match Centre.',
    permissions: ['content.news', 'matchday.view', 'inbox.media'] },
  matchday_admin: { label: 'Matchday Admin', about: 'Everything on matchday: matches, live control, league, programme, Predict & Win, commentary, alerts, scanner.',
    permissions: [...MATCHDAY_ALL, 'content.cms'] },
  broadcast_operator: { label: 'Broadcast Operator', about: 'Live Commentary, stream settings and Fan Match Alerts.',
    permissions: ['matchday.view', 'matchday.commentary', 'matchday.alerts'] },
  crm_manager: { label: 'CRM Manager', about: 'Fan database (with download), members, Rewards, newsletter and the whole Inbox.',
    permissions: ['fans.view', 'fans.edit', 'fans.export', 'fans.rewards', 'fans.rewards.manage', 'fans.newsletter', 'inbox.contact', 'inbox.partners', 'inbox.media', 'inbox.settings', 'analytics.view'] },
  fan_support: { label: 'Fan Support', about: 'Answers contact form messages, looks up fans and Rewards members.',
    permissions: ['fans.view', 'fans.rewards', 'inbox.contact'] },
  commercial_manager: { label: 'Commercial Manager', about: 'Tickets, season tickets, food, shirts, partners and sponsorship / hospitality enquiries.',
    permissions: ['commerce.tickets', 'commerce.season', 'commerce.food', 'commerce.kitchen', 'commerce.shirts', 'tickets.scan', 'partners.manage', 'inbox.partners', 'inbox.settings', 'content.cms', 'analytics.view'] },
  matchday_ops_manager: { label: 'Matchday Operations Manager', about: 'Runs the gates and the food on matchday: scanner, food orders and the Kitchen Screen.',
    permissions: ['matchday.view', 'tickets.scan', 'commerce.food', 'commerce.kitchen'] },
  gate_staff: { label: 'Gate Staff', about: 'Only the gate ticket scanner.', permissions: ['tickets.scan'] },
  kitchen_staff: { label: 'Kitchen Staff', about: 'Only the Kitchen Screen.', permissions: ['commerce.kitchen'] },
  // Older role names, kept so existing accounts keep working. Not offered for new accounts.
  staff: { label: 'All areas (old)', legacy: true, about: 'Accounts made before roles existed: everything except staff and backups.',
    permissions: ALL_PERMISSIONS.filter(p => !p.startsWith('staff.')) },
  analyst: { label: 'Analyst (read-only, old)', legacy: true, readOnly: true, about: 'Reports only; cannot change anything.',
    permissions: ['analytics.view'] },
};
// Old ids that now mean a new role.
export const ROLE_ALIASES = { media: 'media_editor', matchday: 'matchday_admin', commercial: 'commercial_manager', fan_relations: 'fan_support', kitchen: 'kitchen_staff' };
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
/** The permissions of a role id right now (saved change or default). */
export function rolePermissions(id) {
  const def = ROLE_DEFAULTS[id];
  if (!def) return [];
  if (def.locked) return ALL_PERMISSIONS;
  return saved[id] || def.permissions;
}
export const roleChanged = id => !!saved[id] && !ROLE_DEFAULTS[id]?.locked;

/** The owner (admin code) is a Super Admin. Old role names map to the new ones. Unknown roles get nothing. */
export const roleOf = admin => {
  if (admin?.role === 'owner') return 'super_admin';
  const r = ROLE_ALIASES[admin?.role] || admin?.role;
  return ROLE_DEFAULTS[r] ? r : 'none';
};
export const roleLabel = admin => (admin?.role === 'owner' ? 'Super Admin (owner)' : ROLE_DEFAULTS[roleOf(admin)]?.label || 'No access');
export const permissionsOf = admin => {
  const set = new Set(rolePermissions(roleOf(admin)));
  // The old Media role also answered the media@ mailbox.
  if (admin?.role === 'media') set.add('inbox.media');
  if (admin?.canExport) set.add('fans.export');
  return [...set];
};
/** Does this admin have the permission? 'a|b' = any of them. */
export const can = (admin, perm) => {
  if (!perm) return true;
  const mine = new Set(permissionsOf(admin));
  return perm.split('|').some(p => mine.has(p));
};

// Areas: the older, coarser names still used by the dashboard, notifications and
// search. Each area is open when the person has any of its permissions.
const AREAS = {
  overview: null,
  matchday: 'matchday.live|matchday.matches|matchday.predictions|matchday.commentary|matchday.alerts',
  'matchday-content': 'matchday.view|matchday.live|matchday.league|matchday.programmes|matchday.share',
  content: 'content.news|content.awards',
  cms: 'content.cms',
  fans: 'fans.view',
  inbox: 'inbox.contact|inbox.partners|inbox.media',
  newsletter: 'fans.newsletter',
  commerce: 'commerce.tickets|commerce.season|commerce.food|commerce.shirts',
  kitchen: 'commerce.kitchen',
  partners: 'partners.manage',
  analytics: 'analytics.view',
  settings: 'settings.activity|settings.health|settings.sources',
  staff: 'staff.manage',
};
export const areasOf = admin => Object.keys(AREAS).filter(a => can(admin, AREAS[a]));
export const canAccess = (admin, area) => !area || (area in AREAS ? can(admin, AREAS[area]) : false);

/** Inbox sources this admin may see: null = all of them, otherwise a list (possibly empty). */
const INBOX_PERMS = { contact_form: 'inbox.contact', sponsorship: 'inbox.partners', hospitality: 'inbox.partners', media_email: 'inbox.media' };
export const inboxSources = admin => {
  const list = Object.keys(INBOX_PERMS).filter(s => can(admin, INBOX_PERMS[s]));
  return list.length === Object.keys(INBOX_PERMS).length ? null : list;
};
export const inboxPermFor = source => INBOX_PERMS[source] || 'inbox.contact';

// What each admin page or API needs (first match wins). [path, read, write]:
// any one of the listed permissions; write (POST, PUT, DELETE…) defaults to read;
// null = any signed-in staff. A path not listed is Super Admin only.
const EVENTS_READ = 'matchday.view|matchday.live|matchday.matches|matchday.league|matchday.programmes|matchday.share|matchday.predictions|matchday.commentary|matchday.alerts|commerce.tickets';
const RULES = [
  // Pages
  [/^\/admin\/(dashboard|login|account)(\/|$)/, null],
  [/^\/admin\/fan-alerts(\/|$)/, 'matchday.alerts'],
  [/^\/admin\/matches(\/|$)/, 'matchday.matches|matchday.live'],
  [/^\/admin\/predictions(\/|$)/, 'matchday.predictions'],
  [/^\/admin\/commentary(\/|$)/, 'matchday.commentary'],
  [/^\/admin\/match-centre(\/|$)/, 'matchday.view|matchday.live'],
  [/^\/admin\/(programmes|programme-preview)(\/|$)/, 'matchday.programmes'],
  [/^\/admin\/share(\/|$)/, 'matchday.share'],
  [/^\/admin\/league(\/|$)/, 'matchday.view|matchday.league'],
  [/^\/admin\/news(\/|$)/, 'content.news'],
  [/^\/admin\/awards(\/|$)/, 'content.awards'],
  [/^\/admin\/inbox(\/|$)/, 'inbox.contact|inbox.partners|inbox.media'],
  [/^\/admin\/newsletter(\/|$)/, 'fans.newsletter|partners.manage'],
  [/^\/admin\/contact-sources(\/|$)/, 'fans.view|analytics.view|settings.sources'],
  [/^\/admin\/(fans|members)(\/|$)/, 'fans.view'],
  [/^\/admin\/rewards(\/|$)/, 'fans.rewards|fans.rewards.manage'],
  [/^\/admin\/kitchen(\/|$)/, 'commerce.kitchen'],
  [/^\/admin\/food-orders\/analytics(\/|$)/, 'commerce.food|analytics.view'],
  [/^\/admin\/tickets\/scan(\/|$)/, 'tickets.scan'],
  [/^\/admin\/tickets(\/|$)/, 'commerce.tickets'],
  [/^\/admin\/shirt-orders(\/|$)/, 'commerce.shirts'],
  [/^\/admin\/food-orders(\/|$)/, 'commerce.food'],
  [/^\/admin\/season-tickets(\/|$)/, 'commerce.season'],
  [/^\/admin\/partners(\/|$)/, 'partners.manage'],
  [/^\/admin\/analytics(\/|$)/, 'analytics.view'],
  [/^\/admin\/activity(\/|$)/, 'settings.activity'],
  [/^\/admin\/health(\/|$)/, 'settings.health'],
  [/^\/admin\/(staff|security)(\/|$)/, 'staff.manage'],
  [/^\/admin\/backup(\/|$)/, 'staff.backup'],
  [/^\/admin\/?(index\.html|config\.yml)?$/, 'content.cms'],
  // APIs
  [/^\/api\/admin\/(login|logout|me|dashboard|search|notifications|account)(\/|$)/, null],
  // Any open admin page helps finish sending a match alert to fans.
  [/^\/api\/admin\/fan-alerts\/run(\/|$)/, null],
  [/^\/api\/admin\/fan-alerts(\/|$)/, 'matchday.alerts'],
  [/^\/api\/admin\/match-centre(\/|$)/, 'matchday.view|matchday.live', 'matchday.live'],
  [/^\/api\/admin\/programmes(\/|$)/, 'matchday.programmes'],
  [/^\/api\/admin\/qr(\/|$)/, 'matchday.share|matchday.programmes'],
  [/^\/api\/admin\/share(\/|$)/, 'matchday.share|matchday.programmes'],
  [/^\/api\/admin\/league(\/|$)/, 'matchday.view|matchday.league', 'matchday.league'],
  [/^\/api\/admin\/tickets(\/|$)/, 'commerce.tickets'],
  [/^\/api\/admin\/rewards\/(member|fulfilment|run)(\/|$)/, 'fans.rewards|fans.rewards.manage'],
  [/^\/api\/admin\/rewards(\/|$)/, 'fans.rewards|fans.rewards.manage', 'fans.rewards.manage'],
  [/^\/api\/admin\/events(\/|$)/, EVENTS_READ, 'matchday.matches|matchday.live'],
  [/^\/api\/admin\/predictions(\/|$)/, 'matchday.predictions'],
  [/^\/api\/admin\/motm(\/|$)/, 'matchday.live|matchday.predictions'],
  [/^\/api\/admin\/commentary(\/|$)/, 'matchday.commentary'],
  [/^\/api\/admin\/awards(\/|$)/, 'content.awards'],
  [/^\/api\/admin\/inbox\/settings(\/|$)/, 'inbox.settings'],
  [/^\/api\/admin\/inbox(\/|$)/, 'inbox.contact|inbox.partners|inbox.media'],
  [/^\/api\/admin\/newsletter(\/|$)/, 'fans.newsletter|partners.manage'],
  [/^\/api\/admin\/fans\/export(\/|$)/, 'fans.view|analytics.view'],
  [/^\/api\/admin\/contact-source-defs(\/|$)/, 'fans.view|analytics.view|settings.sources', 'settings.sources'],
  [/^\/api\/admin\/contact-sources(\/|$)/, 'fans.view|analytics.view|settings.sources'],
  [/^\/api\/admin\/(fans|members)(\/|$)/, 'fans.view', 'fans.edit'],
  [/^\/api\/admin\/kitchen\/settings(\/|$)/, 'commerce.kitchen|commerce.food', 'commerce.food'],
  [/^\/api\/admin\/kitchen(\/|$)/, 'commerce.kitchen|commerce.food'],
  [/^\/api\/admin\/food-analytics(\/|$)/, 'commerce.food|analytics.view'],
  [/^\/api\/admin\/shirt-orders(\/|$)/, 'commerce.shirts'],
  [/^\/api\/admin\/(food-orders|food-menu|food-photo|food-alerts)(\/|$)/, 'commerce.food'],
  [/^\/api\/admin\/season-tickets(\/|$)/, 'commerce.season'],
  [/^\/api\/admin\/partner-report(\/|$)/, 'partners.manage|analytics.view'],
  [/^\/api\/admin\/partner-reports(\/|$)/, 'partners.manage'],
  [/^\/api\/admin\/(analytics|broadcast-report)(\/|$)/, 'analytics.view'],
  [/^\/api\/admin\/export-log(\/|$)/, 'fans.export|settings.activity'],
  [/^\/api\/admin\/activity(\/|$)/, 'settings.activity'],
  [/^\/api\/admin\/health(\/|$)/, 'settings.health'],
  [/^\/api\/admin\/(staff|roles|security)(\/|$)/, 'staff.manage'],
  [/^\/api\/admin\/backup(\/|$)/, 'staff.backup'],
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
