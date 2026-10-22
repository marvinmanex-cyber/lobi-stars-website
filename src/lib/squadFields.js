// Squad & Staff Data Portal: every profile field in ONE place, used by the
// portal form, the server (saving, validation, the partner API), the club review
// screens and every export. "use" decides where a field may go:
//   public  – shown on the website (and in exports, the partner API, the Data Package)
//   media   – the club media team (exports, the partner API, the Data Package; never the website)
//   private – the club only: NEVER on the website, in the partner API or in any portal export
// for: 'all' | 'player' | 'staff'.  required: needed to submit (drafts can be incomplete).

export const POSITIONS = ['Goalkeeper', 'Right back', 'Centre back', 'Left back', 'Defensive midfielder', 'Central midfielder', 'Attacking midfielder', 'Right winger', 'Left winger', 'Striker'];
export const STAFF_ROLES = ['Head Coach', 'Assistant Coach', 'Goalkeeper Trainer', 'Fitness Coach', 'Team Manager', 'Team Doctor', 'Physiotherapist', 'Kit Manager', 'Media Officer', 'Other'];
export const STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa',
  'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara', 'FCT (Abuja)', 'Outside Nigeria'];
export const FEET = ['Right', 'Left', 'Both'];
export const STATUSES = { DRAFT: 'Draft', SUBMITTED: 'Submitted', VERIFIED: 'Verified', CHANGES_REQUESTED: 'Changes requested', LEFT_THE_CLUB: 'Left the club' };
export const EDITABLE = ['DRAFT', 'CHANGES_REQUESTED'];
export const NOTE_MAX = 300;

/** The fields, in form order. type: text | email | tel | date | month | number | select | multiselect | textarea | checkbox | rows */
export const FIELDS = [
  // 1 · Personal details (everyone)
  { key: 'fullName', section: 'personal', label: 'Full legal name', use: 'private', for: 'all', required: true, type: 'text', max: 120, hint: 'As it appears on official documents.' },
  { key: 'displayName', section: 'personal', label: 'Display name', use: 'public', for: 'all', required: true, type: 'text', max: 60, placeholder: { player: 'Name printed on the shirt', staff: 'e.g. Coach Terver' } },
  { key: 'nickname', section: 'personal', label: 'Nickname', use: 'public', for: 'all', type: 'text', max: 40, optional: true },
  { key: 'pronunciation', section: 'personal', label: 'Name pronunciation', use: 'media', for: 'all', required: true, type: 'text', max: 80, placeholder: 'e.g. Ter-VER Ior-LI-am' },
  { key: 'dob', section: 'personal', label: 'Date of birth', use: 'private', publicAs: 'age', for: 'all', required: true, type: 'date', hint: 'Only the age is published.' },
  { key: 'nationality', section: 'personal', label: 'Nationality', use: 'public', for: 'all', required: true, type: 'select', options: ['Nigerian', 'Other'] },
  { key: 'nationalityOther', section: 'personal', label: 'Nationality (other)', use: 'public', for: 'all', type: 'text', max: 40, showIf: { nationality: 'Other' } },
  { key: 'stateOfOrigin', section: 'personal', label: 'State of origin', use: 'public', for: 'all', type: 'select', options: STATES },
  { key: 'hometown', section: 'personal', label: 'Hometown and LGA', use: 'public', for: 'all', type: 'text', max: 80, placeholder: 'e.g. Gboko, Gboko LGA' },
  { key: 'phone', section: 'personal', label: 'Phone number', use: 'private', for: 'all', required: true, type: 'tel', placeholder: '0803 123 4567' },
  { key: 'email', section: 'personal', label: 'Email address', use: 'private', for: 'all', type: 'email', max: 120 },
  { key: 'emergencyName', section: 'personal', label: 'Emergency contact name and relationship', use: 'private', for: 'all', required: true, type: 'text', max: 100, placeholder: 'e.g. Grace Adakole, mother' },
  { key: 'emergencyPhone', section: 'personal', label: 'Emergency contact phone', use: 'private', for: 'all', required: true, type: 'tel', placeholder: '0803 123 4567' },
  { key: 'social', section: 'personal', label: 'Instagram or X handle', use: 'public', for: 'all', type: 'text', max: 40, optional: true, placeholder: '@handle', hint: 'Used to tag them in club posts.' },
  // 2 · Playing profile (players)
  { key: 'shirtNumber', section: 'playing', label: 'Shirt number', use: 'public', for: 'player', required: true, type: 'number', min: 1, max: 99, hint: 'A warning appears if the number is already assigned.' },
  { key: 'primaryPosition', section: 'playing', label: 'Primary position', use: 'public', for: 'player', required: true, type: 'select', options: POSITIONS },
  { key: 'secondaryPositions', section: 'playing', label: 'Secondary position(s)', use: 'public', for: 'player', type: 'multiselect', options: POSITIONS, optional: true },
  { key: 'preferredFoot', section: 'playing', label: 'Preferred foot', use: 'public', for: 'player', required: true, type: 'select', options: FEET },
  { key: 'heightCm', section: 'playing', label: 'Height (cm)', use: 'public', for: 'player', type: 'number', min: 140, max: 220 },
  { key: 'joined', section: 'playing', label: 'Date joined Lobi Stars', use: 'public', for: 'player', type: 'month' },
  { key: 'international', section: 'playing', label: 'International or national team experience', use: 'public', for: 'player', type: 'text', max: 160, optional: true, placeholder: 'e.g. Flying Eagles, Golden Eaglets, Super Eagles' },
  // 2 · Role & qualifications (staff)
  { key: 'role', section: 'role', label: 'Position at the club', use: 'public', for: 'staff', required: true, type: 'select', options: STAFF_ROLES },
  { key: 'roleOther', section: 'role', label: 'Position at the club (other)', use: 'public', for: 'staff', type: 'text', max: 60, showIf: { role: 'Other' } },
  { key: 'joinedStaff', section: 'role', label: 'Date joined Lobi Stars', use: 'public', for: 'staff', type: 'month' },
  { key: 'qualifications', section: 'role', label: 'Coaching licences and professional qualifications', use: 'public', for: 'staff', type: 'textarea', max: 400, placeholder: 'e.g. CAF B Licence, BSc Physiotherapy' },
  { key: 'playingCareer', section: 'role', label: 'Playing career', use: 'public', for: 'staff', type: 'textarea', max: 400, optional: true, placeholder: 'Clubs and years, if they played professionally' },
  // 3 · Career history & honours (repeatable rows)
  { key: 'previousClubs', section: 'career', label: 'Previous clubs', use: 'public', for: 'player', type: 'rows', columns: [{ key: 'club', label: 'Club', max: 80 }, { key: 'startYear', label: 'Start year', type: 'year' }, { key: 'endYear', label: 'End year', type: 'year' }] },
  { key: 'previousRoles', section: 'career', label: 'Previous clubs and positions', use: 'public', for: 'staff', type: 'rows', columns: [{ key: 'club', label: 'Club', max: 80 }, { key: 'position', label: 'Position held', max: 60 }, { key: 'period', label: 'Period', max: 20, placeholder: 'e.g. 2019–2023' }] },
  { key: 'honours', section: 'career', label: { player: 'Honours and individual awards', staff: 'Honours and achievements' }, use: 'public', for: 'all', type: 'rows', columns: [{ key: 'title', label: 'Honour or award', max: 100 }, { key: 'seasonOrYear', label: 'Season or year', max: 20 }, { key: 'clubOrTeam', label: 'Club or team', max: 80 }] },
  // 4 · Profile notes (media)
  { key: 'philosophy', section: 'notes', label: 'Coaching or working philosophy', use: 'media', for: 'staff', type: 'textarea', max: NOTE_MAX },
  { key: 'careerHighlight', section: 'notes', label: 'Career highlight', use: 'media', for: 'all', type: 'textarea', max: NOTE_MAX },
  { key: 'roleModel', section: 'notes', label: 'Football role model', use: 'media', for: 'player', type: 'textarea', max: NOTE_MAX },
  { key: 'interestingFact', section: 'notes', label: 'An interesting fact about them', use: 'media', for: 'all', type: 'textarea', max: NOTE_MAX },
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
export const fieldsFor = type => FIELDS.filter(f => f.for === 'all' || f.for === type);
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
  const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
  if (empty) return { value: f.type === 'rows' || f.type === 'multiselect' ? [] : f.type === 'checkbox' ? false : null };
  const txt = (s, max) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max || 200);
  switch (f.type) {
    case 'checkbox': return { value: v === true || v === 'true' || v === 1 };
    case 'number': { const n = Number(v); if (!Number.isInteger(n) || n < f.min || n > f.max) return { error: `${f.label}: a whole number from ${f.min} to ${f.max}.` }; return { value: n }; }
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && ageOn(v) !== null ? { value: String(v) } : { error: 'Enter a valid date.' };
    case 'month': return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v)) ? { value: String(v) } : { error: 'Enter the month and year.' };
    case 'select': return f.options.includes(String(v)) ? { value: String(v) } : { error: `Choose one of the options for ${f.label}.` };
    case 'multiselect': return { value: [...new Set([].concat(v).map(String).filter(x => f.options.includes(x)))] };
    case 'tel': { const p = normPhone(v); return p ? { value: p } : { error: 'Enter a Nigerian mobile number, e.g. 0803 123 4567.' }; }
    case 'email': { const e = txt(v, 120).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? { value: e } : { error: 'Enter a valid email address.' }; }
    case 'rows': {
      if (!Array.isArray(v)) return { error: 'Rows expected.' };
      const rows = v.slice(0, 30).map(r => Object.fromEntries(f.columns.map(c => {
        const x = r?.[c.key];
        if (c.type === 'year') { const n = Number(x); return [c.key, Number.isInteger(n) && n >= 1950 && n <= 2100 ? n : null]; }
        return [c.key, x == null ? '' : txt(x, c.max)];
      }))).filter(r => Object.values(r).some(x => x !== '' && x !== null));
      return { value: rows };
    }
    case 'textarea': return { value: txt(v, f.max) };
    default: {
      let s = txt(v, f.max);
      if (key === 'social' && s && !s.startsWith('@') && !/^https?:/i.test(s)) s = `@${s.replace(/^@+/, '')}`;
      return { value: s };
    }
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

/** The public and media part of a profile (never anything private). */
export function shareable(type, data, { media = true } = {}) {
  const out = {};
  for (const f of fieldsFor(type)) {
    if (f.use === 'private') continue;
    if (f.use === 'media' && !media) continue;
    if (f.showIf && !Object.entries(f.showIf).every(([k, v]) => data?.[k] === v)) continue;
    out[f.key] = data?.[f.key] ?? (f.type === 'rows' || f.type === 'multiselect' ? [] : null);
  }
  out.age = ageOn(data?.dob);
  return out;
}
export const PRIVATE_KEYS = FIELDS.filter(f => f.use === 'private').map(f => f.key);
