import { portalJson } from '../_lib/squadPortal.js';

// /api/squad-portal/export-data -- switched off on 23 Oct 2026: exports of player
// and staff data are no longer offered in the portal. Only Super Admins export,
// from the admin (Matchday › Squad: Profile Submissions), and the file is emailed
// to the chosen admin addresses (functions/api/admin/squad-profiles/export-email.js).
const off = () => portalJson({ error: 'Downloads are not available in the portal. A Super Admin exports the data from the club admin.' }, 403);
export const onRequestGet = off;
export const onRequestPost = off;
