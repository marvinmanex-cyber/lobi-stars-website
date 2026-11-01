// Media Centre › Press Releases & Statements: fixed layout (headline, date,
// FOR IMMEDIATE RELEASE, body, quote, media contact, ENDS). Always approved by a
// Super Admin; then on /media/press-releases with a branded PDF, and emailed to
// the media contacts list.
import { api, esc, register, go } from './core';
import { listScreen, statusBanner, autosaver, workflowButtons } from './items';
import { rteHtml, wireRte } from './rte';

register({ path: 'press', label: 'Press Releases', icon: '📣', async render(main, parts) {
  if (parts[0]) return editor(main, parts[0]);
  await listScreen(main, { kind: 'press', title: 'Press Releases & Statements', newLabel: 'New press release',
    intro: '<p class="mc-muted">Always approved before publishing. Published releases go on <a href="/media/press-releases/" target="_blank" rel="noopener">lobistarsfc.com/media/press-releases</a> (with a PDF) and are emailed to the media contacts list.</p>',
    newData: () => ({ date: new Date(Date.now() + 3600e3).toISOString().slice(0, 10), location: 'MAKURDI' }) });
} });

async function editor(main: HTMLElement, id: string) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const { item, editable } = await api(`items/${id}`);
  const d: any = item.data || {}, ro = editable ? '' : 'disabled';
  main.innerHTML = `<div class="mc-page-head"><h1>Press release</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/press/" data-go="/press">← All releases</a></div>
    ${statusBanner(item, editable)}${item.status === 'published' && item.slug ? `<p><a href="/media/press-releases/${esc(item.slug)}/" target="_blank" rel="noopener">View on the website</a> · <a href="/media/press-releases/${esc(item.slug)}.pdf" target="_blank" rel="noopener">PDF</a></p>` : ''}
    <div class="mc-ed"><form class="mc-ed-form" id="f">
      <label class="mc-check"><input type="checkbox" id="statement" ${d.statement ? 'checked' : ''} ${ro} /> This is an <b>official statement</b> (heading "OFFICIAL STATEMENT" instead of "FOR IMMEDIATE RELEASE")</label>
      <div class="mc-field"><label for="headline">Headline <span class="mc-req">*</span></label><input id="headline" maxlength="160" value="${esc(d.headline || '')}" ${ro} /></div>
      <div class="mc-field"><label for="sub">Sub-headline <small>(optional)</small></label><input id="sub" maxlength="240" value="${esc(d.subheadline || '')}" ${ro} /></div>
      <div class="mc-grid two"><div class="mc-field"><label for="date">Release date <span class="mc-req">*</span></label><input id="date" type="date" value="${esc(d.date || '')}" ${ro} /></div>
      <div class="mc-field"><label for="loc">Dateline place</label><input id="loc" maxlength="60" value="${esc(d.location || 'MAKURDI')}" ${ro} /></div></div>
      <div class="mc-field"><span class="mc-label">Body <span class="mc-req">*</span></span>${rteHtml('body', d.body || '', editable)}<span class="mc-hint">The facts first: who, what, when, where, why. Short paragraphs.</span></div>
      <div class="mc-field"><label for="quote">Quote <small>(optional)</small></label><textarea id="quote" rows="3" maxlength="1200" ${ro}>${esc(d.quote || '')}</textarea></div>
      <div class="mc-field"><label for="quoteBy">Quote from</label><input id="quoteBy" maxlength="120" value="${esc(d.quoteBy || '')}" ${ro} placeholder="e.g. Head Coach, Lobi Stars FC" /></div>
      <div class="mc-field"><label for="contact">Media contact <small>(leave empty for the club's default)</small></label><textarea id="contact" rows="2" maxlength="400" ${ro}>${esc(d.contact || '')}</textarea></div>
      <p class="mc-hint">"ENDS" is added automatically.</p><p class="mc-hint" id="saveState"></p><div id="wf"></div>
    </form>
    <aside class="mc-pv"><div class="mc-pv-bar"><b>Preview</b></div><div class="mc-card mc-pr-pv" id="pv"></div></aside></div>`;
  const $ = (s: string) => main.querySelector(s) as any;
  const body = wireRte(main, 'body', () => changed(), 'press');
  const value = () => ({ statement: $('#statement').checked, headline: $('#headline').value, subheadline: $('#sub').value, date: $('#date').value, location: $('#loc').value, body: body(), quote: $('#quote').value, quoteBy: $('#quoteBy').value, contact: $('#contact').value });
  const preview = () => {
    const v = value();
    const date = v.date ? new Date(`${v.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    $('#pv').innerHTML = `<p style="font-weight:700;letter-spacing:.12em;font-size:13px;color:#C9242C;margin:0 0 8px">${v.statement ? 'OFFICIAL STATEMENT' : 'FOR IMMEDIATE RELEASE'}</p><h2 style="margin:0 0 6px">${esc(v.headline || 'Headline')}</h2>${v.subheadline ? `<p style="color:#4A505C">${esc(v.subheadline)}</p>` : ''}<p><b>${esc(v.location)}</b>, ${esc(date)} –</p><div>${v.body}</div>${v.quote ? `<blockquote style="border-left:4px solid #EE343C;margin:12px 0;padding:6px 12px">“${esc(v.quote)}”<br><b>${esc(v.quoteBy)}</b></blockquote>` : ''}<p style="text-align:center;font-weight:700;letter-spacing:.1em">ENDS</p><p style="font-size:14px"><b>Media contact</b><br>${esc(v.contact || 'Media Department, Lobi Stars FC · media@lobistarsfc.com').replace(/\n/g, '<br>')}</p>`;
  };
  const saver = autosaver(async () => { await api(`items/${id}`, { method: 'PUT', body: { data: value() } }); }, $('#saveState'));
  function changed() { preview(); if (editable) saver.changed(); }
  $('#f').addEventListener('input', changed); $('#f').addEventListener('change', changed);
  const wf = workflowButtons(item, editable, { flush: () => saver.flush(), schedule: () => null, onDone: () => go('/press') });
  $('#wf').innerHTML = wf.html; wf.wire($('#wf'));
  preview();
}
