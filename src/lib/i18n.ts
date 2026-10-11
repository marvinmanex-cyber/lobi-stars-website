// Interface translations (menus, buttons, labels, footer, cookie notice).
// English is the default and the source: src/i18n/en.json lists every
// translatable piece of text. Each language file has the same keys; a value
// of "" or starting with "TODO" is not translated yet.
//  - A language is published (/i18n/<code>.json) only when EVERY text is translated.
//  - It appears in the language switcher only when a native speaker has also
//    reviewed it ("reviewed": true). Before that it can be previewed with ?lang=<code>.
// News stories stay in English unless a translated version is added.
import en from '../i18n/en.json';
import pcm from '../i18n/pcm.json';
import ha from '../i18n/ha.json';
import tiv from '../i18n/tiv.json';

type LangFile = { _meta: { code: string; name: string; nativeName: string; reviewed: boolean; translator?: string }; strings: Record<string, string> };
const FILES = [pcm, ha, tiv] as LangFile[];
export const SOURCE: string[] = Object.keys((en as LangFile).strings);

const isDone = (v: string | undefined) => !!v && v.trim() !== '' && !/^TODO/i.test(v.trim());
export function progress(f: LangFile) {
  const done = SOURCE.filter(k => isDone(f.strings[k])).length;
  return { done, total: SOURCE.length, complete: done === SOURCE.length };
}
export const LANGUAGES = FILES.map(f => ({ ...f._meta, ...progress(f) }));
/** Complete languages: their file is published (preview with ?lang=code). */
export const PUBLISHED = FILES.filter(f => progress(f).complete);
/** Shown in the switcher: complete and reviewed by a native speaker. */
export const SWITCHER = [{ code: 'en', name: 'English', nativeName: 'EN' }, ...PUBLISHED.filter(f => f._meta.reviewed).map(f => f._meta)];
export function dictionary(code: string): Record<string, string> | null {
  const f = PUBLISHED.find(x => x._meta.code === code);
  return f ? Object.fromEntries(SOURCE.map(k => [k, f.strings[k]])) : null;
}
