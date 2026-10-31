// Media Centre › Press Kit: the public download page /media/press-kit (club
// badge, colours, how to write the club name, squad photo, player headshots,
// fact sheet, media contact, media rules). Each entry (text and/or files) is
// managed in the Media Centre and appears only after a Super Admin approves it.
import { oneLine, clean, ensureMediaSchema, parseJson } from './mediaCentre.js';
import { setPublic, fileIdsIn } from './mediaFiles.js';

export const KIT_SECTIONS = { badge: 'Club badge', colours: 'Club colours', name: 'How to write the club name', squad: 'Squad photo', headshots: 'Player headshots', facts: 'Fact sheet', contact: 'Media contact', rules: 'Media rules', other: 'Other' };
const FILE_URL = /^\/api\/media-file\/[a-z0-9_]{4,40}$/;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function normalise(d) {
  d = d || {};
  return { value: {
    section: KIT_SECTIONS[d.section] ? d.section : 'other', title: oneLine(d.title, 120), text: clean(d.text, 3000),
    files: (Array.isArray(d.files) ? d.files : []).filter(f => FILE_URL.test(String(f?.url || ''))).slice(0, 40).map(f => ({ url: String(f.url), id: String(f.url).split('/').pop(), label: oneLine(f.label, 120), kind: f.kind === 'document' ? 'document' : 'image' })),
    sort: Number.isInteger(Number(d.sort)) ? Number(d.sort) : 0,
  } };
}
const validate = v => (v.title.length < 3 ? 'Give it a title (e.g. "Club badge, full colour").' : !v.text && !v.files.length ? 'Add some text or at least one file.' : null);
const previewHtml = v => `<p style="font-size:12px;text-transform:uppercase;color:#C9242C;font-weight:700">${esc(KIT_SECTIONS[v.section])}</p><h3 style="margin:0 0 6px">${esc(v.title)}</h3>${v.text ? `<p style="white-space:pre-line">${esc(v.text)}</p>` : ''}
  <ul>${v.files.map(f => `<li>${f.kind === 'image' ? `<img src="${esc(f.url)}" alt="" style="height:60px;vertical-align:middle;margin-right:6px">` : '📄 '}${esc(f.label || 'File')}</li>`).join('')}</ul>`;
export const PRESSKIT = {
  label: 'Press kit item', section: 'presskit', schedulable: false,
  normalise, validate, previewHtml,
  publish: async (env, r, v) => { await setPublic(env.DB, fileIdsIn(v), true); return { ok: true, note: 'It is on the press kit page.' }; },
  unpublish: async (env, r) => { await setPublic(env.DB, fileIdsIn(parseJson(r.live_json, {})), false); return { ok: true }; },
  titleOf: v => v.title || '(untitled press kit item)',
  adminFields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' }, { key: 'files', label: 'Files', type: 'json' }],
};
/** Published press kit entries, grouped in the page order. */
export async function pressKit(db) {
  await ensureMediaSchema(db);
  const rows = (await db.prepare(`SELECT id, live_json, published_at FROM mc_items WHERE kind = 'presskit' AND status = 'published' ORDER BY published_at`).all()).results.map(r => ({ id: r.id, ...parseJson(r.live_json, {}) }));
  return Object.keys(KIT_SECTIONS).map(k => ({ key: k, title: KIT_SECTIONS[k], items: rows.filter(r => r.section === k).sort((a, b) => (a.sort || 0) - (b.sort || 0)).map(({ id, title, text, files }) => ({ id, title, text, files: (files || []).map(f => ({ url: f.url, label: f.label, kind: f.kind })) })) })).filter(s => s.items.length);
}
