// Admin roles and what each can open. Used by the server (page and API
// middleware, so a link typed in directly is refused too) and by the admin
// sidebar (which only shows what the signed-in person can open).
//
// Areas:  overview, matchday, content, fans, commerce, partners, analytics,
//         settings, staff (manage staff users and roles), cms (content CMS).
// Downloading contact data also needs the separate "can export fan data"
// permission on the staff account.

export const ROLES = {
  super_admin: { label: 'Super Admin', areas: ['overview', 'matchday', 'content', 'fans', 'commerce', 'partners', 'analytics', 'settings', 'staff', 'cms'] },
  // Accounts created before roles existed: everything except managing staff (as before).
  staff: { label: 'All areas', areas: ['overview', 'matchday', 'content', 'fans', 'commerce', 'partners', 'analytics', 'settings', 'cms'] },
  media: { label: 'Media', areas: ['overview', 'content', 'matchday-content', 'cms'] },
  matchday: { label: 'Matchday Operator', areas: ['overview', 'matchday', 'matchday-content', 'cms'] },
  commercial: { label: 'Commercial', areas: ['overview', 'commerce', 'partners', 'inbox', 'cms'] },
  fan_relations: { label: 'Fan Relations', areas: ['overview', 'fans', 'inbox'] },
  analyst: { label: 'Analyst (read-only)', areas: ['overview', 'analytics'] },
};
export const ASSIGNABLE_ROLES = ['super_admin', 'media', 'matchday', 'commercial', 'fan_relations', 'analyst', 'staff'];

/** The owner (admin code) is a Super Admin. Unknown roles get nothing beyond the dashboard. */
export const roleOf = admin => (admin?.role === 'owner' ? 'super_admin' : ROLES[admin?.role] ? admin.role : 'none');
export const roleLabel = admin => (admin?.role === 'owner' ? 'Super Admin (owner)' : ROLES[roleOf(admin)]?.label || 'No access');
export const areasOf = admin => {
  const set = new Set(ROLES[roleOf(admin)]?.areas || ['overview']);
  // Full matchday access includes the matchday content screens; full fans access includes the inbox.
  if (set.has('matchday')) set.add('matchday-content');
  if (set.has('fans')) set.add('inbox');
  return [...set];
};
export const canAccess = (admin, area) => !area || areasOf(admin).includes(area);

// Which area each admin page or API belongs to (first match wins; null = any signed-in staff).
const RULES = [
  // Pages
  [/^\/admin\/(dashboard|login)(\/|$)/, null],
  [/^\/admin\/(matches|predictions|commentary)(\/|$)/, 'matchday'],
  [/^\/admin\/match-centre(\/|$)/, 'matchday-content'],
  [/^\/admin\/(news|awards)(\/|$)/, 'content'],
  [/^\/admin\/(fans|members)(\/|$)/, 'fans'],
  [/^\/admin\/shirt-orders(\/|$)/, 'commerce'],
  [/^\/admin\/partners(\/|$)/, 'partners'],
  [/^\/admin\/analytics(\/|$)/, 'analytics'],
  [/^\/admin\/activity(\/|$)/, 'settings'],
  [/^\/admin\/staff(\/|$)/, 'staff'],
  [/^\/admin\/?(index\.html|config\.yml)?$/, 'cms'],
  // APIs
  [/^\/api\/admin\/(login|logout|me|dashboard|search|notifications)(\/|$)/, null],
  [/^\/api\/admin\/match-centre(\/|$)/, 'matchday-content'],
  [/^\/api\/admin\/events(\/|$)/, 'matchday-content'],
  [/^\/api\/admin\/(predictions|motm|commentary)(\/|$)/, 'matchday'],
  [/^\/api\/admin\/awards(\/|$)/, 'content'],
  [/^\/api\/admin\/(fans|members)(\/|$)/, 'fans'],
  [/^\/api\/admin\/shirt-orders(\/|$)/, 'commerce'],
  [/^\/api\/admin\/partner-report(\/|$)/, 'partners|analytics'],
  [/^\/api\/admin\/(analytics|broadcast-report)(\/|$)/, 'analytics'],
  [/^\/api\/admin\/export-log(\/|$)/, 'fans|settings'],
  [/^\/api\/admin\/activity(\/|$)/, 'settings'],
  [/^\/api\/admin\/staff(\/|$)/, 'staff'],
];

/** The area for a path; undefined = not listed (treated as Super Admin only). */
export function areaForPath(pathname) {
  for (const [re, area] of RULES) if (re.test(pathname)) return area;
  return undefined;
}

/** May this admin open this path? Write requests from read-only roles are refused. */
export function allowedPath(admin, pathname, method = 'GET') {
  let area = areaForPath(pathname);
  // Media can see matches and the Match Centre (checklist, team news) but only
  // matchday operators change matches, scores, squads and streams.
  if (method !== 'GET' && /^\/api\/admin\/(events|match-centre)(\/|$)/.test(pathname)) area = 'matchday';
  if (area === null) return true;
  if (area === undefined) return roleOf(admin) === 'super_admin';
  const ok = area.split('|').some(a => canAccess(admin, a));
  if (!ok) return false;
  // Analysts only read (and download reports).
  if (roleOf(admin) === 'analyst' && method !== 'GET' && !/^\/api\/admin\/(login|logout)/.test(pathname)) return false;
  return true;
}
