// Player and staff names, built in ONE place. Every page, download, email and
// the media partner feed use these helpers instead of joining names by hand.
//   publicName   "Musa Adeyemi"            (or the "Name on website" if set)  – website, cards, lists
//   officialName "ADEYEMI, Musa Ibrahim"   (surname in capitals)              – official lists, PDFs, records
//   shortName    "Adeyemi"                                                    – shirts, line-ups, tight spaces
// n: { surname, firstName, middleName, websiteName } (a profile's answers, or a website squad entry).

const squash = s => String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();

/** "MUSA" / "musa" → "Musa"; "o'neil-ADE" → "O'Neil-Ade". Mixed case as typed is kept ("McDonald"). */
export function tidyName(s) {
  const v = squash(s);
  if (!v) return '';
  if (v !== v.toUpperCase() && v !== v.toLowerCase()) return v;
  return v.toLowerCase().replace(/(^|[\s'’\-.])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

export const publicName = n => squash(n?.websiteName) || [n?.firstName, n?.surname].map(squash).filter(Boolean).join(' ');
export function officialName(n) {
  const surname = squash(n?.surname).toUpperCase(), rest = [n?.firstName, n?.middleName].map(squash).filter(Boolean).join(' ');
  return surname && rest ? `${surname}, ${rest}` : surname || rest;
}
export const shortName = n => squash(n?.surname) || squash(n?.websiteName).split(' ').pop() || '';
export const hasName = n => !!(squash(n?.surname) && squash(n?.firstName));

/** For a web address: "musa-adeyemi". */
export const nameSlug = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Old single "full name" → a proposal for the Super Admin to confirm (never saved without it).
 * confidence: 'high' for two words, or "SURNAME, First Middle"; otherwise 'needs review'.
 */
export function splitFullName(full) {
  const v = squash(full);
  if (!v) return { surname: '', firstName: '', middleName: '', confidence: 'needs review', reason: 'No name was given.' };
  const comma = /^([^,]+),\s*(.+)$/.exec(v);
  if (comma) {
    const rest = comma[2].split(' ');
    return { surname: tidyName(comma[1]), firstName: tidyName(rest[0]), middleName: tidyName(rest.slice(1).join(' ')), confidence: 'high', reason: 'Written as "Surname, First name".' };
  }
  const w = v.split(' ');
  if (w.length === 1) return { surname: tidyName(w[0]), firstName: '', middleName: '', confidence: 'needs review', reason: 'Only one name was given.' };
  // One word in capitals among others is usually the surname ("Musa ADEYEMI Ibrahim").
  const caps = w.filter(x => x.length > 1 && x === x.toUpperCase() && /\p{L}/u.test(x));
  if (caps.length === 1 && w.length > 1 && w.some(x => x !== x.toUpperCase())) {
    const others = w.filter(x => x !== caps[0]);
    return { surname: tidyName(caps[0]), firstName: tidyName(others[0]), middleName: tidyName(others.slice(1).join(' ')), confidence: w.length === 2 ? 'high' : 'needs review', reason: 'The word in capitals was taken as the surname.' };
  }
  if (w.length === 2) return { surname: tidyName(w[1]), firstName: tidyName(w[0]), middleName: '', confidence: 'high', reason: 'Two names: first name, then surname.' };
  return { surname: tidyName(w[w.length - 1]), firstName: tidyName(w[0]), middleName: tidyName(w.slice(1, -1).join(' ')), confidence: 'needs review', reason: `${w.length} names: the order is not certain (in Nigeria the surname is often written first).` };
}

/**
 * The name migration (23 Oct 2026): the old "Full legal name" + "Display name" →
 * surname / first name / middle name, saved straight away and marked "Please check
 * name order" for the Super Admin. The Nigerian order "Surname First Middle" is
 * used only where the old full name clearly used it:
 *   - written "SURNAME, First Middle", or
 *   - the first word is in capitals and the others are not ("ADEYEMI Musa Ibrahim"), or
 *   - its first word is the display name's last word ("Adeyemi Musa Ibrahim" / "Musa Adeyemi").
 * Otherwise the old display name is read as "First Surname"; any other words of
 * the full name become the middle name. Returns { surname, firstName, middleName, rule }.
 */
export function migrateName(full, display) {
  const fw = squash(full).replace(/,/g, ' , ').split(' ').filter(Boolean), dw = squash(display).split(' ').filter(Boolean);
  const eq = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
  const caps = w => w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w);
  const words = fw.filter(w => w !== ',');
  const out = (surname, firstName, middle, rule) => ({ surname: tidyName(surname), firstName: tidyName(firstName), middleName: tidyName(middle.join(' ')), rule });
  const surnameFirst = (rule) => {
    const rest = words.slice(1);
    const first = rest.find(w => eq(w, dw[0])) || rest[0] || '';
    const i = rest.findIndex(w => eq(w, first));
    return out(words[0], first, rest.filter((_, j) => j !== i), rule);
  };
  if (fw.length > 2 && fw[1] === ',') return surnameFirst('Written "SURNAME, First Middle".');
  if (words.length >= 2 && caps(words[0]) && words.slice(1).some(w => !caps(w))) return surnameFirst('The first word was in capitals, so it was taken as the surname.');
  if (words.length >= 2 && dw.length >= 2 && eq(words[0], dw[dw.length - 1]) && words.slice(1).some(w => eq(w, dw[0]))) return surnameFirst('The full name started with the surname (as in the display name).');
  if (dw.length >= 2) {
    const first = dw[0], surname = dw[dw.length - 1];
    const middle = words.filter(w => !eq(w, first) && !eq(w, surname) && !dw.some(d => eq(d, w)));
    return out(surname, first, middle, 'From the display name, read as "First name Surname".');
  }
  if (words.length >= 2) return out(words[words.length - 1], words[0], words.slice(1, -1), 'From the full name, read as "First name … Surname".');
  return out(words[0] || dw[0] || '', '', [], 'Only one name was given.');
}

/** A website squad entry with only one "name" (made by hand in the Content CMS): best-effort parts. */
export function partsFromName(name) {
  const w = squash(name).split(' ').filter(Boolean);
  if (w.length < 2) return { firstName: w[0] || '', surname: '', middleName: '' };
  return { firstName: w[0], surname: w[w.length - 1], middleName: w.slice(1, -1).join(' ') };
}
