// Countries for nationality, national team and place of birth: stored as ISO
// codes ("NG"), shown as "🇳🇬-style flag + name". Flags are local SVG files
// (public/flags/, flag-icons 7.5.0, MIT): no outside service.
import { COUNTRIES } from './countries.data.js';

export { COUNTRIES };
const BY_CODE = new Map(COUNTRIES.map(([c, n]) => [c, n]));
// Shorter everyday names where the ISO list is formal.
const SHORT = { GB: 'United Kingdom', US: 'United States', 'GB-ENG': 'England', 'GB-SCT': 'Scotland', 'GB-WLS': 'Wales', 'GB-NIR': 'Northern Ireland', CI: "Côte d'Ivoire", CD: 'DR Congo', CG: 'Congo' };

export const isCountry = code => BY_CODE.has(String(code || '').toUpperCase());
export const countryName = code => { const c = String(code || '').toUpperCase(); return SHORT[c] || BY_CODE.get(c) || ''; };
export const flagUrl = code => (isCountry(code) ? `/flags/${String(code).toLowerCase()}.svg` : null);

/** For drop-downs: Nigeria and the nearest football nations first, then everyone A–Z. */
const FIRST = ['NG', 'GH', 'CM', 'BJ', 'NE', 'TG', 'CI', 'SN'];
export const COUNTRY_OPTIONS = [...FIRST.map(c => [c, countryName(c)]), ...COUNTRIES.filter(([c]) => !FIRST.includes(c)).map(([c]) => [c, countryName(c)]).sort((a, b) => a[1].localeCompare(b[1]))];

/** Old answers ("Nigerian", "Ghanaian", "Nigeria") → a code, or null if unsure. */
const DEMONYMS = { nigerian: 'NG', ghanaian: 'GH', cameroonian: 'CM', beninese: 'BJ', togolese: 'TG', nigerien: 'NE', ivorian: 'CI', senegalese: 'SN', liberian: 'LR', 'sierra leonean': 'SL', gambian: 'GM', malian: 'ML', chadian: 'TD', english: 'GB-ENG', british: 'GB', american: 'US' };
export function countryFromText(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  if (DEMONYMS[t]) return DEMONYMS[t];
  if (isCountry(t)) return t.toUpperCase();
  const hit = COUNTRIES.find(([c, n]) => n.toLowerCase() === t || countryName(c).toLowerCase() === t);
  return hit ? hit[0] : null;
}
