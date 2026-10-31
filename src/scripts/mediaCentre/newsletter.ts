// Media Centre › Lobi Stars Weekly: the 15-section template with hints, the
// "No match this week" switch, fill-in helpers from the fixtures, a live
// preview of the email and of the web version, and autosave. It can only be
// sent for approval when every required section is complete.
import { api, esc, register, go, toast, when } from './core';
import { listScreen, statusBanner, autosaver, workflowButtons } from './items';
import { upload, pickFile, pickFromLibrary } from './files';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const spec = (s: string) => { const [d, t] = String(s || '').split('|'); return `${DAYS[Number(d)] || ''} ${t || ''}`; };

register({ path: 'newsletter', label: 'Lobi Stars Weekly', icon: '✉️', async render(main, parts) {
  if (parts[0]) return editor(main, parts[0]);
  const M = await api('meta');
  await listScreen(main, { kind: 'newsletter', title: 'Lobi Stars Weekly', newLabel: 'Start this week\'s newsletter',
    intro: `<p class="mc-muted">The weekly email to every subscriber. Send it for approval by <b>${esc(spec(M.settings.newsletterDeadline))}</b>; once a Super Admin approves it, it goes out on <b>${esc(spec(M.settings.newsletterPublish))}</b> (or straight away if approved later), and appears in the newsletter archive on the website.</p>`,
    newData: {} });
} });

type F = { k: string; label: string; hint: string; type?: 'text' | 'area' | 'photo'; req?: boolean };
const SECTIONS: { n: number; key: string; title: string; rule: string; fields: F[]; match?: boolean; training?: boolean }[] = [
  { n: 2, key: '', title: 'Welcome', rule: 'Required', fields: [
    { k: 'headline', label: 'Headline (shown in the subject line)', hint: 'Short and specific, e.g. "Three points and a clean sheet".' },
    { k: 'welcome', label: 'Welcome', type: 'area', req: true, hint: 'Two or three friendly sentences: what happened this week and what is coming, e.g. "What a week for the Pride of Benue…"' }] },
  { n: 3, key: 'lastMatch', title: 'Last Match Report', rule: 'Required if a match was played', match: true, fields: [
    { k: 'date', label: 'Date', req: true, hint: 'e.g. Sun 2 Nov 2026' }, { k: 'competition', label: 'Competition / matchday', req: true, hint: 'e.g. NNL Conference D, Matchday 5' },
    { k: 'opponent', label: 'Opponent', req: true, hint: 'e.g. Kada City FC' }, { k: 'venue', label: 'Venue', req: true, hint: 'e.g. McCarthy Stadium, Makurdi' },
    { k: 'score', label: 'Final score (Lobi Stars first)', req: true, hint: 'e.g. 2-1' }, { k: 'scorers', label: 'Scorers and minutes', hint: 'e.g. Terna Akaa 23\', Musa Adeyemi 67\' (pen)' },
    { k: 'lineup', label: 'Line-up', type: 'area', req: true, hint: 'The starting XI, goalkeeper first, then the substitutes used.' }, { k: 'photo', label: 'Key photo', type: 'photo', req: true, hint: 'The moment of the match (a goal, the celebration).' }] },
  { n: 4, key: 'analysis', title: 'Match Analysis', rule: 'Required if a match was played', match: true, fields: [
    { k: 'well', label: 'What went well', type: 'area', req: true, hint: 'e.g. "We pressed high and won the ball back quickly in midfield."' },
    { k: 'improve', label: 'Areas to improve', type: 'area', req: true, hint: 'Honest but positive, e.g. "Defending set pieces in the last 15 minutes."' },
    { k: 'turning', label: 'Turning point', type: 'area', req: true, hint: 'The moment that decided it, e.g. "The double save on 80 minutes."' },
    { k: 'quote', label: 'Coach\'s quote', type: 'area', req: true, hint: 'One or two sentences from the head coach, in their words.' }] },
  { n: 5, key: 'potm', title: 'Player of the Match', rule: 'Required if a match was played', match: true, fields: [
    { k: 'name', label: 'Player', req: true, hint: 'From the fan vote if there was one.' }, { k: 'photo', label: 'Photo', type: 'photo', req: true, hint: 'A clear photo of the player.' },
    { k: 'reason', label: 'Why', type: 'area', req: true, hint: 'e.g. "A goal and an assist, and he never stopped running."' }] },
  { n: 0, key: '', title: 'Training & Preparation', rule: 'Optional (no match this week)', training: true, fields: [
    { k: 'training', label: 'Training & preparation', type: 'area', hint: 'What the squad worked on this week, friendlies, fitness news.' }] },
  { n: 6, key: 'table', title: 'League Table', rule: 'Required', fields: [
    { k: 'position', label: 'Lobi Stars\' position', req: true, hint: 'e.g. 3' }, { k: 'points', label: 'Points', req: true, hint: 'e.g. 11' },
    { k: 'top', label: 'Top of the conference', req: true, hint: 'e.g. "Kwara United, 14 points"' }] },
  { n: 7, key: 'squad', title: 'Squad Update', rule: 'Required', fields: [
    { k: 'injuries', label: 'Injuries', type: 'area', hint: 'Who is out and roughly how long (no medical details). Write "None" if none.' },
    { k: 'returns', label: 'Returns', type: 'area', hint: 'Who is back in training or available again.' },
    { k: 'suspensions', label: 'Suspensions', type: 'area', hint: 'Who misses the next match and why (e.g. 5 yellow cards).' }] },
  { n: 8, key: 'nextMatch', title: 'Next Match Preview', rule: 'Required', fields: [
    { k: 'opponent', label: 'Opponent', req: true, hint: 'e.g. Plateau United' }, { k: 'date', label: 'Date', req: true, hint: 'e.g. Sunday 9 November' },
    { k: 'kickoff', label: 'Kick-off', req: true, hint: 'e.g. 16:00' }, { k: 'venue', label: 'Venue', req: true, hint: 'e.g. McCarthy Stadium, Makurdi' },
    { k: 'form', label: 'Their form', req: true, hint: 'e.g. "W W D L W, unbeaten at home"' }, { k: 'expect', label: 'What to expect', type: 'area', req: true, hint: 'Two or three sentences to make fans want to come.' },
    { k: 'ticketLink', label: 'Ticket link', hint: 'Leave as /tickets/ for home matches.' }] },
  { n: 10, key: 'spotlight', title: 'Player or Staff Spotlight', rule: 'Optional', fields: [
    { k: 'name', label: 'Name', hint: 'A player or staff member to get to know.' }, { k: 'text', label: 'Spotlight', type: 'area', hint: 'A short profile or Q&A.' }, { k: 'photo', label: 'Photo', type: 'photo', hint: '' }] },
  { n: 11, key: '', title: 'Club News', rule: 'Optional', fields: [{ k: 'clubNews', label: 'Club news', type: 'area', hint: 'Announcements: memberships, community work, partners.' }] },
  { n: 12, key: '', title: "Fans' Corner", rule: 'Optional', fields: [{ k: 'fans', label: "Fans' corner", type: 'area', hint: 'A fan message, supporters club news, a fan photo story.' }] },
  { n: 13, key: 'partner', title: 'Partner Spotlight', rule: 'Optional', fields: [
    { k: 'name', label: 'Partner', hint: 'e.g. ZEVA' }, { k: 'logo', label: 'Logo', type: 'photo', hint: 'PNG or JPG logo.' }, { k: 'text', label: 'Text', type: 'area', hint: 'One or two sentences about the partner or their offer.' }, { k: 'link', label: 'Link', hint: 'https://…' }] },
  { n: 14, key: 'photo', title: 'Photo of the Week', rule: 'Optional', fields: [
    { k: 'photo', label: 'Photo', type: 'photo', hint: 'The best picture of the week.' }, { k: 'caption', label: 'Caption', hint: '' }, { k: 'credit', label: 'Photo credit', hint: 'e.g. Lobi Stars Media' }] },
];

async function editor(main: HTMLElement, id: string) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const { item, editable } = await api(`items/${id}`);
  const d: any = item.data || {};
  const ro = editable ? '' : 'disabled';
  const get = (sec: string, k: string) => (sec ? d[sec]?.[k] : d[k]);
  const field = (sec: string, f: F) => {
    const name = sec ? `${sec}.${f.k}` : f.k, v = get(sec, f.k);
    const lab = `<label for="nf-${name}">${esc(f.label)}${f.req ? ' <span class="mc-req">*</span>' : ''}</label>`;
    if (f.type === 'photo') return `<div class="mc-field" data-photo="${esc(name)}"><span class="mc-label">${esc(f.label)}${f.req ? ' <span class="mc-req">*</span>' : ''}</span><div class="mc-photo" data-pbox>${v?.url ? `<img src="${esc(v.url)}" alt="" />` : '<p class="mc-muted mc-small">No photo yet.</p>'}</div>${editable ? `<button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-up="${esc(name)}">Upload</button> <button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-lib="${esc(name)}">From library</button> ${v?.url ? `<button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-rm="${esc(name)}">Remove</button>` : ''}` : ''}${f.hint ? `<span class="mc-hint">${esc(f.hint)}</span>` : ''}</div>`;
    const input = f.type === 'area' ? `<textarea id="nf-${name}" data-k="${esc(name)}" rows="3" ${ro}>${esc(v || '')}</textarea>` : `<input id="nf-${name}" data-k="${esc(name)}" value="${esc(v ?? (f.k === 'ticketLink' ? '/tickets/' : ''))}" ${ro} />`;
    return `<div class="mc-field">${lab}${input}${f.hint ? `<span class="mc-hint">${esc(f.hint)}</span>` : ''}</div>`;
  };
  main.innerHTML = `<div class="mc-page-head"><h1>Lobi Stars Weekly</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/newsletter/" data-go="/newsletter">← All newsletters</a></div>
    ${statusBanner(item, editable)}
    <div class="mc-ed">
      <form class="mc-ed-form" id="f" onsubmit="return false">
        <section class="mc-card mc-nl-sec"><h2 class="mc-h3">1 · Masthead <small class="mc-muted">automatic</small></h2><p class="mc-small mc-muted">The edition number and date are added automatically.</p></section>
        <label class="mc-check mc-card" style="margin:12px 0"><input type="checkbox" id="noMatch" ${d.noMatch ? 'checked' : ''} ${ro} /> <b>No match this week</b> (hides sections 3–5 and offers "Training & Preparation")</label>
        ${editable ? '<p><button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="fillLast">Fill in the last result</button> <button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="fillNext">Fill in the next match</button></p>' : ''}
        ${SECTIONS.map(s => `<section class="mc-card mc-nl-sec" data-sec="${s.match ? 'match' : s.training ? 'training' : ''}"><h2 class="mc-h3">${s.n ? `${s.n} · ` : ''}${esc(s.title)} <small class="mc-muted">${esc(s.rule)}</small></h2>${s.fields.map(f => field(s.key, f)).join('')}</section>`).join('')}
        <section class="mc-card mc-nl-sec"><h2 class="mc-h3">9 · Coming Fixtures <small class="mc-muted">automatic</small></h2><p class="mc-small mc-muted">The next three Lobi Stars fixtures are added from the fixtures list.</p></section>
        <section class="mc-card mc-nl-sec"><h2 class="mc-h3">15 · Sign-off <small class="mc-muted">automatic</small></h2><p class="mc-small mc-muted">Ticket link, the club's social media links, #WeAreLobi and the unsubscribe link.</p></section>
        <p class="mc-alert" id="missing" hidden></p>
        <p class="mc-hint" id="saveState"></p>
        <div id="wf"></div>
      </form>
      <aside class="mc-pv"><div class="mc-pv-bar"><b>Preview</b><div class="mc-tabs" style="margin:0"><button type="button" data-pv="email" class="on">Email</button><button type="button" data-pv="web">Web version</button></div></div>
        <div class="mc-pv-frame desktop" style="--pv-scale:1"><iframe id="pv" title="Preview of the newsletter" sandbox="allow-same-origin" style="width:100%;height:1100px;transform:none;margin:0"></iframe></div></aside>
    </div>`;
  const $ = (s: string) => main.querySelector(s) as any;
  const photos: Record<string, any> = {};
  SECTIONS.forEach(s => s.fields.filter(f => f.type === 'photo').forEach(f => { photos[s.key ? `${s.key}.${f.k}` : f.k] = get(s.key, f.k) || null; }));
  const value = () => {
    const v: any = { noMatch: $('#noMatch').checked };
    main.querySelectorAll<HTMLInputElement>('[data-k]').forEach(el => { const [a, b] = el.dataset.k!.split('.'); if (b) (v[a] ||= {})[b] = el.value; else v[a] = el.value; });
    for (const [k, p] of Object.entries(photos)) { const [a, b] = k.split('.'); if (b) (v[a] ||= {})[b] = p; else v[a] = p; }
    return v;
  };
  const toggle = () => { const nm = $('#noMatch').checked; main.querySelectorAll<HTMLElement>('[data-sec="match"]').forEach(s => { s.hidden = nm; }); main.querySelectorAll<HTMLElement>('[data-sec="training"]').forEach(s => { s.hidden = !nm; }); };
  toggle();
  let web = false, pvT = 0;
  const preview = async () => {
    try {
      const r = await api('newsletter', { method: 'POST', body: { data: value(), web, id }, quiet: true });
      ($('#pv') as HTMLIFrameElement).srcdoc = r.html;
      $('#missing').hidden = !r.missing || !editable; $('#missing').textContent = r.missing ? `Still needed before it can be sent: ${r.missing}` : '';
      const sb = main.querySelector<HTMLButtonElement>('[data-wf="submit"]'); if (sb) sb.disabled = !!r.missing;
    } catch { /* shown on save */ }
  };
  const saver = autosaver(async () => { await api(`items/${id}`, { method: 'PUT', body: { data: value() } }); }, $('#saveState'));
  const changed = () => { if (!editable) return; saver.changed(); clearTimeout(pvT); pvT = window.setTimeout(preview, 700); };
  $('#f').addEventListener('input', changed);
  $('#noMatch').addEventListener('change', () => { toggle(); changed(); });
  main.querySelectorAll<HTMLButtonElement>('[data-pv]').forEach(b => b.addEventListener('click', () => { main.querySelectorAll('[data-pv]').forEach(x => x.classList.toggle('on', x === b)); web = b.dataset.pv === 'web'; preview(); }));
  main.addEventListener('click', async e => {
    const t = e.target as HTMLElement, up = t.closest<HTMLElement>('[data-up]'), rm = t.closest<HTMLElement>('[data-rm]');
    const lib = t.closest<HTMLElement>('[data-lib]');
    if (lib) { const p = await pickFromLibrary(); if (p) { photos[lib.dataset.lib!] = p; main.querySelector(`[data-photo="${lib.dataset.lib}"] [data-pbox]`)!.innerHTML = `<img src="${esc(p.url)}" alt="" />`; changed(); } }
    if (up) {
      const f = await pickFile('image/jpeg,image/png,image/webp'); if (!f) return;
      try { toast('Uploading…'); const r = await upload(f, { section: 'newsletter', maxSide: 1200 }); photos[up.dataset.up!] = { url: r.url, id: r.id }; main.querySelector(`[data-photo="${up.dataset.up}"] [data-pbox]`)!.innerHTML = `<img src="${esc(r.url)}" alt="" />`; changed(); toast('Photo added.'); } catch (err: any) { toast(err.message, 9000); }
    }
    if (rm) { photos[rm.dataset.rm!] = null; main.querySelector(`[data-photo="${rm.dataset.rm}"] [data-pbox]`)!.innerHTML = '<p class="mc-muted mc-small">No photo.</p>'; changed(); }
  });
  const fill = (sec: string, data: any) => { for (const [k, v] of Object.entries(data || {})) { const el = main.querySelector<HTMLInputElement>(`[data-k="${sec}.${k}"]`); if (el && v != null && v !== '' && !el.value.trim()) el.value = String(v); } changed(); };
  $('#fillLast')?.addEventListener('click', async () => { const r = await api('newsletter'); if (!r.lastMatch) { toast('No past Lobi Stars match in the fixtures.'); return; } fill('lastMatch', r.lastMatch); toast(`Filled from ${r.lastMatch.opponent}. Check every detail.`); });
  $('#fillNext')?.addEventListener('click', async () => { const r = await api('newsletter'); if (!r.nextMatch) { toast('No upcoming Lobi Stars match in the fixtures.'); return; } fill('nextMatch', r.nextMatch); toast(`Filled from the next match v ${r.nextMatch.opponent}.`); });
  const wf = workflowButtons(item, editable, { flush: () => saver.flush(), onDone: () => go('/newsletter') });
  $('#wf').innerHTML = wf.html; wf.wire($('#wf'));
  if (item.status === 'scheduled') $('#wf').insertAdjacentHTML('afterbegin', `<p class="mc-ok">Approved: it goes out ${esc(when(item.scheduledAt))}.</p>`);
  preview();
}
