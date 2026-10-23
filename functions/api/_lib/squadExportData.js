// Squad & Staff Data Portal: the data for exports. The files themselves (PDF,
// Word, Excel, CSV, JSON, the Data Package ZIP) are made in the browser, so the
// server only sends the profiles and links to their photos.
// Portal and normal admin exports get Public and Media fields only: private and
// retired fields (and an under-18's full date of birth and middle name) are
// removed HERE, before anything leaves the server. Only "Full club records"
// (Super Admins, re-confirmed with the two-step code) include them.
import { shareable, STATUSES, NEVER_SHARED } from '../../../src/lib/squadFields.js';
import { profilesFor, packageInput } from './squadPublish.js';
import { getTeam, parseJson } from './squadProfiles.js';
import { getPortalSettings } from './squadPortal.js';

export const WHICH = {
  // Live = the approved versions; "submitted" = the working copies, including changes waiting for approval.
  verified: { statuses: ['LIVE', 'ON_LOAN'], type: null, label: 'verified' },
  submitted: { statuses: ['PENDING_APPROVAL', 'CHANGES_REQUESTED', 'LIVE', 'ON_LOAN'], type: null, label: 'submitted', working: true },
  players: { statuses: ['LIVE', 'ON_LOAN'], type: 'player', label: 'verified' },
  staff: { statuses: ['LIVE', 'ON_LOAN'], type: 'staff', label: 'verified' },
};

export async function exportData(env, { which = 'verified', season = 'current', full = false, fileBase = '/api/squad-portal/file' } = {}) {
  const db = env.DB;
  const w = WHICH[which] || WHICH.verified;
  const cur = (await getPortalSettings(db)).season;
  const s = season === 'all' ? 'all' : season === 'current' || !season ? cur : season;
  const statuses = s === 'all' ? [...w.statuses, 'FORMER'] : w.statuses;
  const rows = await profilesFor(db, { season: s, statuses, type: w.type, live: !w.working });
  const profiles = rows.map(r => {
    const p = packageInput(r);
    const data = full ? p.data : shareable(r.type, p.data, { media: true });
    if (!full) for (const k of NEVER_SHARED) delete data[k];
    const files = {};
    if (p.hasPhoto) files.profile = { jpg: `${fileBase}/${r.id}/profile/w1200.jpg`, webp: `${fileBase}/${r.id}/profile/w1200.webp` };
    if (p.hasAction) files.action = { jpg: `${fileBase}/${r.id}/action/w1200.jpg`, webp: `${fileBase}/${r.id}/action/w1200.webp` };
    if (p.hasHero) files.hero = { jpg: `${fileBase}/${r.id}/hero/w1200.jpg`, webp: `${fileBase}/${r.id}/hero/w1200.webp` };
    return { id: r.id, type: r.type, status: r.status, statusLabel: STATUSES[r.status], season: r.season, updatedAt: r.updated_at, updatedBy: r.updated_by,
      verifiedAt: r.verified_at, verifiedBy: r.verified_by, fileBase: p.fileBase, data, hasAction: p.hasAction, hasHero: p.hasHero, hasPhoto: p.hasPhoto, files };
  });
  return { season: s === 'all' ? `All seasons (current ${cur})` : s, seasonKey: s, current: cur, which, filters: { status: w.label, type: w.type || 'all', season: s === 'all' ? 'all' : s }, full, team: await getTeam(db), profiles };
}
export { parseJson };
