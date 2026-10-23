// Printable blank forms (players; coaches & staff): made from the same question
// list as the portal, so every current question is on the paper form and the
// removed ones are not. Runs without a server (Node strips the TypeScript types).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { blankFormPdf } from '../src/scripts/squadPortal/blankForm.ts';
import { fieldsFor, labelOf } from '../src/lib/squadFields.js';

globalThis.fetch = async () => new Response(null, { status: 404 }); // no club badge offline

/** The text drawn on the pages (pdfLite writes "(…) Tj"; streams may be compressed). */
function pdfText(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  const parts = [];
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body = m[1];
    try { body = inflateSync(Buffer.from(body, 'latin1')).toString('latin1'); } catch { /* not compressed */ }
    for (const t of body.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)) parts.push(t[1].replace(/\\([()\\])/g, '$1'));
  }
  return parts.join('\n');
}
const norm = s => s.replace(/\s+/g, ' ');

for (const kind of ['player', 'staff']) {
  test(`${kind} form: every current question, no removed or club-only ones`, async () => {
    const text = norm(pdfText(await blankFormPdf(kind, '2026/27')));
    assert.match(text, /Lobi Stars FC/); assert.match(text, kind === 'player' ? /Players data form/ : /Staff data form/);
    assert.ok(!text.includes('Squad & Staff Data Portal'), 'not the portal name');
    assert.ok(!/(DOCUMENTS TO ATTACH|PERSONAL DETAILS|CONFIRMATION|FOR CLUB USE)/.test(text), 'sentence case headings');
    for (const f of fieldsFor(kind)) {
      const label = f.key === 'interestingFact' && kind === 'staff' ? 'An interesting fact about the coach / staff member' : labelOf(f, kind);
      const start = label.replace(/['’]/g, '').slice(0, 24);
      assert.ok(text.replace(/['’]/g, '').includes(start), `"${label}" on the ${kind} form`);
    }
    for (const gone of ['Display name', 'Name pronunciation', 'Full legal name', 'Football role model', 'Name on website', 'Shirt shop link', 'Public', 'Private']) assert.ok(!text.includes(gone), `no "${gone}"`);
    if (kind === 'player') { assert.match(text, /Parent or guardian \(players under 18 only\)/); assert.match(text, /Evidence of any international career/); }
    else { assert.ok(!text.includes('Shirt number')); assert.match(text, /coaching licences/i); }
  });
}
