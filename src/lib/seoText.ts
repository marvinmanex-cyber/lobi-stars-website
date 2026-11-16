// Page titles and descriptions that fit Google's limits (title 30–60 characters, description 70–160), used by the
// story, player and other templates so every new page gets them right by itself (SEO Scanner, Nov 2026).
// Fancy Unicode letters (e.g. 𝗟𝗢𝗕𝗜 𝗦𝗧𝗔𝗥𝗦 pasted from social media) become normal letters: Google and screen
// readers treat the fancy ones as symbols.

/** Normal letters and single spaces. */
export function plainText(s: unknown): string {
  return String(s ?? '').normalize('NFKC').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
}
const clipWords = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/[\s,.;:–—|-]+\S*$/, '')}…`);

/** The main title plus the first ending that keeps it within 60 characters (else the title alone, shortened). */
export function fitTitle(main: string, endings: string[] = [' | Lobi Stars FC']): string {
  let m = plainText(main);
  // A title typed in capitals reads as shouting in Google results: normal capitals (NNL, FC and the like stay).
  if ((m.match(/[A-Z]/g) || []).length > m.length * 0.6) m = m.toLowerCase().replace(/(^|[\s(“"'-])([a-z])/g, (_, a, c) => a + c.toUpperCase()).replace(/\b(Nnl|Npfl|Fc|Caf|Nff|Lmc|Motm)\b/g, w => w.toUpperCase());
  for (const e of endings) if ((m + e).length <= 60) return m + e;
  return clipWords(m, 60);
}

/** A description of 70–160 characters: long ones cut at a word, short ones completed with `more` (a true sentence). */
export function fitDescription(text: unknown, more = 'From the official website of Lobi Stars FC, the Pride of Benue.'): string {
  let d = plainText(text);
  if (d.length < 70 && more) d = `${d}${d && !/[.!?…]$/.test(d) ? '.' : ''} ${more}`.trim();
  return clipWords(d, 160);
}
