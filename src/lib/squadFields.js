// Squad & Staff Data Portal: every profile field in ONE place, used by the
// portal form, the server (saving, validation, the partner API), the club review
// screens and every export. "use" decides where a field may go:
//   public  – shown on the website (and in exports, the partner API, the Data Package)
//   media   – the club media team (exports, the partner API, the Data Package; never the website)
//   private – the club only: NEVER on the website, in the partner API or in any portal export
// for: 'all' | 'player' | 'staff'.  required: needed to submit (drafts can be incomplete).
// adultOnly: published in full only for people aged 18 and over (under 18: the age only).
// admin: filled in by the club on the review page, never on the portal form.
// retired: no longer asked (22 Oct 2026). Old answers are KEPT in the database and
//   shown to the club, but never saved again, published or exported.
import { isCountry, countryName, countryFromText } from './countries.js';
import { tidyName, publicName } from './names.js';

export const POSITIONS = ['Goalkeeper', 'Right back', 'Centre back', 'Left back', 'Defensive midfielder', 'Central midfielder', 'Attacking midfielder', 'Right winger', 'Left winger', 'Striker'];
export const POSITION_GROUPS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
/** The group of a specific position (for old answers that have no group). */
export const groupOf = pos => (pos === 'Goalkeeper' ? 'Goalkeeper' : /back/i.test(pos || '') ? 'Defender' : /midfielder/i.test(pos || '') ? 'Midfielder' : /winger|striker|forward/i.test(pos || '') ? 'Forward' : null);
export const INTL_LEVELS = ['U17', 'U20', 'U23', 'Senior'];
export const STAFF_ROLES = ['Head Coach', 'Assistant Coach', 'Goalkeeper Trainer', 'Fitness Coach', 'Team Manager', 'Team Doctor', 'Physiotherapist', 'Kit Manager', 'Media Officer', 'Other'];
export const STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa',
  'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara', 'FCT (Abuja)', 'Outside Nigeria'];
export const FEET = ['Right', 'Left', 'Both'];
export const STATUSES = { DRAFT: 'Draft', SUBMITTED: 'Submitted', VERIFIED: 'Verified', CHANGES_REQUESTED: 'Changes requested', LEFT_THE_CLUB: 'Left the club' };
export const EDITABLE = ['DRAFT', 'CHANGES_REQUESTED'];
export const NOTE_MAX = 300;

export const NAME_HINT = 'Enter your names exactly as they appear on your passport or official ID.';
/** The fields, in form order. type: text | email | tel | date | day | month | number | select | country | multiselect | textarea | richtext | url | checkbox | rows */
export const FIELDS = [
  // 1 · Personal details (everyone)
  { key: 'surname', section: 'personal', label: 'Surname', use: 'public', for: 'all', required: true, type: 'name', max: 60 },
  { key: 'firstName', section: 'personal', label: 'First name', use: 'public', for: 'all', required: true, type: 'name', max: 60 },
  { key: 'middleName', section: 'personal', label: 'Middle name', use: 'public', adultOnly: true, for: 'all', type: 'name', max: 80, optional: true, hint: NAME_HINT },
  { key: 'fullName', section: 'personal', label: 'Full legal name (old question)', use: 'private', for: 'all', type: 'text', max: 120, retired: true },
  { key: 'displayName', section: 'personal', label: 'Display name (old question)', use: 'public', for: 'all', type: 'text', max: 60, retired: true },
  { key: 'nickname', section: 'personal', label: 'Nickname', use: 'public', for: 'all', type: 'text', max: 40, optional: true },
  { key: 'pronunciation', section: 'personal', label: 'Name pronunciation (old question)', use: 'media', for: 'all', type: 'text', max: 80, retired: true },
  { key: 'dob', section: 'personal', label: 'Date of birth', use: 'public', adultOnly: true, for: 'all', required: true, type: 'date', hint: 'The age is worked out automatically. The full date is shown on the website only for people aged 18 and over; for under-18s only the age.' },
  { key: 'birthTown', section: 'personal', label: 'Place of birth: town or city', use: 'public', for: 'all', type: 'text', max: 60, placeholder: 'e.g. Makurdi' },
  { key: 'birthCountry', section: 'personal', label: 'Place of birth: country', use: 'public', for: 'all', type: 'country' },
  { key: 'nationality', section: 'personal', label: 'Nationality', use: 'public', for: 'all', required: true, type: 'country' },
  { key: 'nationality2', section: 'personal', label: 'Second nationality', use: 'public', for: 'all', type: 'country', optional: true },
  { key: 'nationalityOther', section: 'personal', label: 'Nationality (old answer)', use: 'public', for: 'all', type: 'text', max: 40, retired: true },
  { key: 'stateOfOrigin', section: 'personal', label: 'State of origin', use: 'public', for: 'all', type: 'select', options: STATES },
  { key: 'hometown', section: 'personal', label: 'Hometown and LGA', use: 'public', for: 'all', type: 'text', max: 80, placeholder: 'e.g. Gboko, Gboko LGA' },
  { key: 'phone', section: 'personal', label: 'Phone number', use: 'private', for: 'all', required: true, type: 'tel', placeholder: '0803 123 4567' },
  { key: 'email', section: 'personal', label: 'Email address', use: 'private', for: 'all', type: 'email', max: 120 },
  { key: 'emergencyName', section: 'personal', label: 'Emergency contact name and relationship', use: 'private', for: 'all', required: true, type: 'text', max: 100, placeholder: 'e.g. Grace Adakole, mother' },
  { key: 'emergencyPhone', section: 'personal', label: 'Emergency contact phone', use: 'private', for: 'all', required: true, type: 'tel', placeholder: '0803 123 4567' },
  { key: 'socialInstagram', section: 'personal', label: 'Instagram', use: 'public', for: 'all', type: 'handle', max: 40, optional: true, placeholder: '@handle' },
  { key: 'socialX', section: 'personal', label: 'X (Twitter)', use: 'public', for: 'all', type: 'handle', max: 40, optional: true, placeholder: '@handle' },
  { key: 'socialTiktok', section: 'personal', label: 'TikTok', use: 'public', for: 'all', type: 'handle', max: 40, optional: true, placeholder: '@handle', hint: 'Shown on the profile page and used to tag them in club posts.' },
  { key: 'social', section: 'personal', label: 'Instagram or X handle (old question)', use: 'public', for: 'all', type: 'text', max: 40, retired: true },
  // 2 · Playing profile (players)
  { key: 'shirtNumber', section: 'playing', label: 'Shirt number', use: 'public', for: 'player', required: true, type: 'number', min: 1, max: 99, hint: 'A warning appears if the number is already assigned.' },
  { key: 'positionGroup', section: 'playing', label: 'Position', use: 'public', for: 'player', required: true, type: 'select', options: POSITION_GROUPS },
  { key: 'primaryPosition', section: 'playing', label: 'Specific position', use: 'public', for: 'player', type: 'select', options: POSITIONS, optional: true },
  { key: 'secondaryPositions', section: 'playing', label: 'Other position(s)', use: 'public', for: 'player', type: 'multiselect', options: POSITIONS, optional: true },
  { key: 'preferredFoot', section: 'playing', label: 'Preferred foot', use: 'public', for: 'player', required: true, type: 'select', options: FEET },
  { key: 'heightCm', section: 'playing', label: 'Height (cm)', use: 'public', for: 'player', type: 'number', min: 140, max: 220, hint: 'In centimetres, e.g. 178.' },
  { key: 'joined', section: 'playing', label: 'Date joined Lobi Stars', use: 'public', for: 'player', type: 'month' },
  { key: 'nationalTeam', section: 'playing', label: 'National team', use: 'public', for: 'player', type: 'country', optional: true, hint: 'The country they play for internationally, if any.' },
  { key: 'international', section: 'playing', label: 'International experience (old question)', use: 'public', for: 'player', type: 'text', max: 160, retired: true },
  // 2 · Role & qualifications (staff)
  { key: 'role', section: 'role', label: 'Position at the club', use: 'public', for: 'staff', required: true, type: 'select', options: STAFF_ROLES },
  { key: 'roleOther', section: 'role', label: 'Position at the club (other)', use: 'public', for: 'staff', type: 'text', max: 60, showIf: { role: 'Other' } },
  { key: 'joinedStaff', section: 'role', label: 'Date joined Lobi Stars', use: 'public', for: 'staff', type: 'month' },
  { key: 'qualifications', section: 'role', label: 'Coaching licence and qualifications', use: 'public', for: 'staff', type: 'textarea', max: 400, optional: true, placeholder: 'e.g. CAF B Licence, BSc Physiotherapy' },
  { key: 'playingCareer', section: 'role', label: 'Playing career', use: 'public', for: 'staff', type: 'textarea', max: 400, optional: true, placeholder: 'Clubs and years, if they played professionally' },
  // 3 · Career history & honours (repeatable rows)
  { key: 'previousClubs', section: 'career', label: 'Previous clubs', use: 'public', for: 'player', type: 'rows', columns: [{ key: 'club', label: 'Club', max: 80 }, { key: 'country', label: 'Country', type: 'country' }, { key: 'startYear', label: 'From (year)', type: 'year' }, { key: 'endYear', label: 'To (year)', type: 'year' }] },
  { key: 'internationalCareer', section: 'career', label: 'International career', use: 'public', for: 'player', type: 'rows', optional: true, columns: [{ key: 'level', label: 'Level', type: 'select', options: INTL_LEVELS }, { key: 'caps', label: 'Caps', type: 'int', max: 300 }, { key: 'goals', label: 'Goals', type: 'int', max: 300 }, { key: 'tournaments', label: 'Notable tournaments', max: 120, placeholder: 'e.g. U-17 AFCON 2023' }] },
  { key: 'previousRoles', section: 'career', label: 'Previous clubs and positions', use: 'public', for: 'staff', type: 'rows', columns: [{ key: 'club', label: 'Club', max: 80 }, { key: 'position', label: 'Position held', max: 60 }, { key: 'period', label: 'Period', max: 20, placeholder: 'e.g. 2019–2023' }] },
  { key: 'honours', section: 'career', label: { player: 'Honours and individual awards', staff: 'Honours and achievements' }, use: 'public', for: 'all', type: 'rows', columns: [{ key: 'title', label: 'Honour or award', max: 100 }, { key: 'seasonOrYear', label: 'Season or year', max: 20 }, { key: 'clubOrTeam', label: 'Club or team', max: 80 }] },
  // 4 · Profile notes (media)
  { key: 'philosophy', section: 'notes', label: 'Coaching or working philosophy', use: 'media', for: 'staff', type: 'textarea', max: NOTE_MAX },
  { key: 'careerHighlight', section: 'notes', label: 'Career highlight', use: 'media', for: 'all', type: 'textarea', max: NOTE_MAX },
  { key: 'roleModel', section: 'notes', label: 'Football role model', use: 'media', for: 'player', type: 'textarea', max: NOTE_MAX },
  { key: 'interestingFact', section: 'notes', label: { player: 'An interesting fact about the player', staff: 'An interesting fact about the coach' }, use: 'public', for: 'all', type: 'textarea', max: NOTE_MAX, hint: 'Shown in a highlight box on their profile page.' },
  // The club only (review page): name on website, debut, bio, shirt link, show / hide.
  { key: 'websiteName', section: 'admin', label: 'Name on website', use: 'public', for: 'all', type: 'text', max: 60, admin: true, optional: true, hint: 'Only fill this if the player is publicly known by a different name, e.g. a nickname.' },
  { key: 'debutDate', section: 'admin', label: 'Lobi Stars debut', use: 'public', for: 'player', type: 'day', admin: true, optional: true, hint: 'Leave empty if they have not played yet ("Yet to debut").' },
  { key: 'bioHeadline', section: 'admin', label: 'Bio headline', use: 'public', for: 'all', type: 'text', max: 80, admin: true, optional: true, placeholder: 'e.g. Accomplished keeper' },
  { key: 'bio', section: 'admin', label: 'Bio', use: 'public', for: 'all', type: 'richtext', max: 5000, admin: true, optional: true, hint: 'Paragraphs separated by an empty line. A line starting with "## " is a heading.' },
  { key: 'shirtShopUrl', section: 'admin', label: 'Shirt shop link', use: 'public', for: 'all', type: 'url', max: 300, admin: true, optional: true, hint: 'Shows "Buy [Surname]\'s shirt" on the profile. Leave empty for none.' },
  { key: 'hideFromWebsite', section: 'admin', label: 'Hide from the website', use: 'public', for: 'all', type: 'checkbox', admin: true, hint: 'Takes them off the Squad pages without deleting anything.' },
  // 6 · Confirmation
  { key: 'confirmAccurate', short: 'Accuracy confirmation', section: 'confirm', label: 'I confirm that the information provided is accurate and complete, as given by the profile holder.', use: 'private', for: 'all', required: true, type: 'checkbox' },
  { key: 'confirmConsent', short: 'Publication consent', section: 'confirm', label: 'The profile holder consents to details marked Public, and their photos, being published on the Lobi Stars FC website and used in official club media. Private details are used only by the club.', use: 'private', for: 'all', required: true, type: 'checkbox' },
  { key: 'guardianName', section: 'confirm', label: 'Parent or guardian name', use: 'private', for: 'player', type: 'text', max: 100, minorOnly: true, required: true },
  { key: 'guardianPhone', section: 'confirm', label: 'Parent or guardian phone', use: 'private', for: 'player', type: 'tel', minorOnly: true, required: true },
  { key: 'guardianConsent', short: 'Parent or guardian consent', section: 'confirm', label: 'The parent or guardian has given consent for this profile.', use: 'private', for: 'player', type: 'checkbox', minorOnly: true, required: true },
];
export const FIELD = Object.fromEntries(FIELDS.map(f => [f.key, f]));
export const SECTIONS = [
  { id: 'type', label: 'Profile type', for: 'all' },
  { id: 'personal', label: 'Personal details', for: 'all' },
  { id: 'playing', label: 'Playing profile', for: 'player' },
  { id: 'role', label: 'Role & qualifications', for: 'staff' },
  { id: 'career', label: 'Career history & honours', for: 'all' },
  { id: 'notes', label: 'Profile notes', for: 'all' },
  { id: 'photos', label: 'Photos', for: 'all' },
  { id: 'confirm', label: 'Confirmation', for: 'all' },
];
/** The questions for a type: the portal form (default), or with { admin: true } also the club-only fields. Retired fields never. */
export const fieldsFor = (type, { admin = false } = {}) => FIELDS.filter(f => !f.retired && (admin || !f.admin) && (f.for === 'all' || f.for === type));
export const ADMIN_KEYS = FIELDS.filter(f => f.admin).map(f => f.key);
export const RETIRED_KEYS = FIELDS.filter(f => f.retired).map(f => f.key);
/** Name parts of a profile's answers, for the helpers in names.js. */
export const nameOf = data => ({ surname: data?.surname || '', firstName: data?.firstName || '', middleName: data?.middleName || '', websiteName: data?.websiteName || '' });
/** The name to show for a profile: the new name fields, else (before the name check) the old display name. */
export const profileName = data => publicName(nameOf(data)) || String(data?.displayName || '');
export const labelOf = (f, type) => (typeof f.label === 'object' ? f.label[type] || f.label.player : f.label);

/** Age in whole years on a date (Africa/Lagos). */
export function ageOn(dob, at = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || ''));
  if (!m) return null;
  const d = new Date(at.getTime() + 3600e3);
  let age = d.getUTCFullYear() - Number(m[1]);
  if (d.getUTCMonth() + 1 < Number(m[2]) || (d.getUTCMonth() + 1 === Number(m[2]) && d.getUTCDate() < Number(m[3]))) age--;
  return age >= 0 && age < 120 ? age : null;
}
export const isMinor = (type, data) => type === 'player' && (ageOn(data?.dob) ?? 99) < 18;
/** Full date of birth and middle name are published only from 18 (unknown age: treated as under 18). */
export const isAdult = data => (ageOn(data?.dob) ?? 0) >= 18;

/** "0803 123 4567" / "+234803…" → "+2348031234567" (or null). */
export function normPhone(v) {
  const d = String(v || '').replace(/[^\d+]/g, '');
  const n = d.startsWith('+234') ? d.slice(4) : d.startsWith('234') ? d.slice(3) : d.startsWith('0') ? d.slice(1) : d;
  return /^[789][01]\d{8}$/.test(n) ? `+234${n}` : null;
}

/** Cleans one value for a field. Returns { value } or { error }. Empty → null. */
export function cleanValue(key, v) {
  const f = FIELD[key];
  if (!f) return { error: 'Unknown field.' };
  if (f.retired) return { error: 'This question is no longer used.' };
  const label = typeof f.label === 'object' ? f.label.player : f.label;
  const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
  if (empty) return { value: f.type === 'rows' || f.type === 'multiselect' ? [] : f.type === 'checkbox' ? false : null };
  const txt = (s, max) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max || 200);
  const isDay = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s)); if (!m) return false; const d = new Date(`${s}T00:00:00Z`); return d.getUTCMonth() + 1 === Number(m[2]) && Number(m[1]) >= 1950 && Number(m[1]) <= 2100; };
  switch (f.type) {
    case 'checkbox': return { value: v === true || v === 'true' || v === 1 };
    case 'number': { const n = Number(v); if (!Number.isInteger(n) || n < f.min || n > f.max) return { error: `${label}: a whole number from ${f.min} to ${f.max}.` }; return { value: n }; }
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && ageOn(v) !== null ? { value: String(v) } : { error: 'Enter a valid date.' };
    case 'day': return isDay(v) ? { value: String(v) } : { error: 'Enter a valid date.' };
    case 'month': return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v)) ? { value: String(v) } : { error: 'Enter the month and year.' };
    case 'select': return f.options.includes(String(v)) ? { value: String(v) } : { error: `Choose one of the options for ${label}.` };
    case 'country': return isCountry(v) ? { value: String(v).toUpperCase() } : { error: `Choose a country from the list for ${label}.` };
    case 'multiselect': return { value: [...new Set([].concat(v).map(String).filter(x => f.options.includes(x)))] };
    case 'tel': { const p = normPhone(v); return p ? { value: p } : { error: 'Enter a Nigerian mobile number, e.g. 0803 123 4567.' }; }
    case 'email': { const e = txt(v, 120).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? { value: e } : { error: 'Enter a valid email address.' }; }
    case 'name': {
      const s = tidyName(txt(v, f.max));
      if (!/^[\p{L}][\p{L}\p{M}'’ .\-]*$/u.test(s)) return { error: `${label}: letters only (hyphens and apostrophes are fine).` };
      return { value: s };
    }
    case 'handle': {
      const s = txt(v, f.max).replace(/^https?:\/\/(www\.)?(instagram\.com|x\.com|twitter\.com|tiktok\.com)\/@?/i, '').replace(/[/?#].*$/, '').replace(/^@+/, '');
      return /^[A-Za-z0-9._]{1,30}$/.test(s) ? { value: `@${s}` } : { error: `${label}: the handle only, e.g. @lobistarsfc.` };
    }
    case 'url': {
      const s = txt(v, f.max);
      try { const u = new URL(s); if (u.protocol !== 'https:') throw new Error('https'); return { value: u.href }; } catch { return { error: `${label}: a full web address starting with https://` }; }
    }
    case 'rows': {
      if (!Array.isArray(v)) return { error: 'Rows expected.' };
      const rows = v.slice(0, 30).map(r => Object.fromEntries(f.columns.map(c => {
        const x = r?.[c.key];
        if (c.type === 'year') { const n = Number(x); return [c.key, Number.isInteger(n) && n >= 1950 && n <= 2100 ? n : null]; }
        if (c.type === 'int') { const n = Number(x); return [c.key, x !== '' && x != null && Number.isInteger(n) && n >= 0 && n <= (c.max || 999) ? n : null]; }
        if (c.type === 'country') return [c.key, isCountry(x) ? String(x).toUpperCase() : ''];
        if (c.type === 'select') return [c.key, c.options.includes(String(x ?? '')) ? String(x) : ''];
        return [c.key, x == null ? '' : txt(x, c.max)];
      }))).filter(r => Object.values(r).some(x => x !== '' && x !== null));
      return { value: rows };
    }
    case 'textarea': case 'richtext': return { value: txt(v, f.max).replace(/\n{3,}/g, '\n\n') };
    default: return { value: txt(v, f.max) };
  }
}

/** Fields that apply to this profile now (type, "show if", under-18 only). */
export function activeFields(type, data) {
  const minor = isMinor(type, data);
  return fieldsFor(type).filter(f => (!f.showIf || Object.entries(f.showIf).every(([k, v]) => data?.[k] === v)) && (!f.minorOnly || minor));
}

/** What is missing to submit: [{ key, label, section }] (photos are checked by the caller). */
export function missingForSubmit(type, data) {
  return activeFields(type, data).filter(f => f.required).filter(f => {
    const v = data?.[f.key];
    return f.type === 'checkbox' ? v !== true : v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
  }).map(f => ({ key: f.key, label: f.short || labelOf(f, type), section: f.section }));
}

/**
 * The public and media part of a profile (never anything private or retired). The
 * full date of birth and middle name only from 18; the age is always worked out.
 */
export function shareable(type, data, { media = true } = {}) {
  const out = {}, adult = isAdult(data);
  for (const f of fieldsFor(type, { admin: true })) {
    if (f.use === 'private') continue;
    if (f.use === 'media' && !media) continue;
    if (f.adultOnly && !adult) continue;
    if (f.showIf && !Object.entries(f.showIf).every(([k, v]) => data?.[k] === v)) continue;
    out[f.key] = data?.[f.key] ?? (f.type === 'rows' || f.type === 'multiselect' ? [] : null);
  }
  out.age = ageOn(data?.dob);
  if (type === 'player' && !out.positionGroup) out.positionGroup = groupOf(data?.primaryPosition);
  return out;
}
export const PRIVATE_KEYS = FIELDS.filter(f => f.use === 'private').map(f => f.key);
/** Never in any portal download or the partner feed: private details, retired questions, and the full date of birth / middle name of under-18s (checked per person). */
export const NEVER_SHARED = [...new Set([...PRIVATE_KEYS, ...RETIRED_KEYS])];
/** Erased when someone left the club long enough ago (the Privacy Policy). */
export const RETENTION_KEYS = [...new Set([...PRIVATE_KEYS, 'dob'])];

/**
 * One-time tidy-up of answers saved before 22 Oct 2026 (nothing is deleted):
 * "Nigerian" → NG, the single social handle → Instagram, the position group from
 * the specific position. Names are NOT touched here (a Super Admin confirms them).
 */
export function upgradeData(type, data) {
  const d = { ...(data || {}) };
  let changed = false;
  const set = (k, v) => { if (v != null && v !== '' && (d[k] == null || d[k] === '')) { d[k] = v; changed = true; } };
  if (d.nationality && !isCountry(d.nationality)) {
    const code = countryFromText(d.nationality === 'Other' ? d.nationalityOther : d.nationality);
    if (code) { d.nationality = code; changed = true; } else { d.nationalityOther = d.nationalityOther || d.nationality; d.nationality = null; changed = true; }
  }
  if (d.social && !d.socialInstagram && !d.socialX) { const h = cleanValue('socialInstagram', d.social); if (h.value) set('socialInstagram', h.value); }
  if (type === 'player') set('positionGroup', groupOf(d.primaryPosition));
  return changed ? d : null;
}
export { countryName };
