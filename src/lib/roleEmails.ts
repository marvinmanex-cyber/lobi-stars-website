// The club's public role email addresses (Content CMS: Site Settings › Role
// email addresses). An address whose mailbox isn't ready yet falls back to the
// general info@ address, so fans never write to an address that bounces.
import data from '../data/role-emails.json';

type RoleEmail = { key: string; label: string; address: string; ready: boolean };
const ROLES: RoleEmail[] = (data as { roles: RoleEmail[] }).roles || [];
const INFO = ROLES.find(r => r.key === 'info')?.address || 'info@lobistarsfc.com';

/** The address to show for a team: media, news, social, design, web, broadcast, fans, info, partnerships, tickets. */
export function roleEmail(key: string): string {
  const r = ROLES.find(x => x.key === key);
  return r && r.ready && r.address ? r.address : INFO;
}
/** Every team whose own address is ready (for the contact page). */
export const readyRoleEmails = (): RoleEmail[] => ROLES.filter(r => r.ready && r.address && r.key !== 'info');
