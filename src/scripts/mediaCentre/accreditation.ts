// Media Centre › Accreditation: requests per home match (photo, documents),
// Approve with the access zone / Reject with a reason / Ask for more
// information (any media user decides), the card PDF, invitation links, and the
// media contacts list.
import { api, esc, when, day, register, toast, go } from './core';

const ST: Record<string, string> = { pending: 'New', info: 'Waiting for the applicant', approved: 'Approved', rejected: 'Rejected', revoked: 'Revoked' };
const PILL: Record<string, string> = { pending: 'submitted', info: 'returned', approved: 'published', rejected: 'rejected', revoked: 'rejected' };

register({ path: 'accreditation', label: 'Accreditation', icon: '🪪', async render(main, parts) {
  if (parts[0] === 'contacts') return contactsScreen(main);
  const event = parts[0] || '';
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const d = await api(`accreditations${event ? `?event=${encodeURIComponent(event)}` : ''}`);
  const m = d.matches.find((x: any) => x.id === event);
  main.innerHTML = `<div class="mc-page-head"><h1>Accreditation</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/accreditation/contacts/" data-go="/accreditation/contacts">Media contacts</a></div>
    <p class="mc-muted">Journalists apply on the public form (<a href="/media/accreditation/" target="_blank" rel="noopener">lobistarsfc.com/media/accreditation</a>) for one home match. Any media staff member can decide. At most <b>${d.max}</b> accredited per match; applications close ${d.closeHours} hours before kick-off. After that you can <b>Open applications</b> again for a match (until kick-off).</p>
    <section class="mc-card"><h2 class="mc-h3">Upcoming home matches</h2>${d.matches.length ? `<ul class="mc-list">${d.matches.map((x: any) => `<li><div class="t"><b>${esc(x.label)}</b><small>${esc(x.day)}, ${esc(x.kickOff)} · ${x.reopened ? 'applications opened again by the media team' : x.open ? `applications close ${esc(when(x.closesAt))}` : 'applications closed'}</small></div>
      <span class="mc-pill submitted">${x.counts.pending || 0} new</span> <span class="mc-pill published">${x.counts.approved || 0}/${d.max} approved</span>
      <a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/accreditation/${esc(x.id)}/" data-go="/accreditation/${esc(x.id)}">Requests</a> <button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-invite="${esc(x.id)}">Invitation link</button>${x.reopened ? ` <button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-reopen="${esc(x.id)}" data-open="0">Close applications</button>` : !x.open ? ` <button class="mc-btn mc-btn-blue mc-btn-sm" type="button" data-reopen="${esc(x.id)}" data-open="1">Open applications</button>` : ''}</li>`).join('')}</ul>` : '<p class="mc-empty">No upcoming home matches in the fixtures.</p>'}</section>
    <section class="mc-card" style="margin-top:14px"><h2 class="mc-h3">${m ? `Requests: ${esc(m.label)}` : 'Latest requests (all matches)'}</h2><div id="reqs"></div></section>`;
  const reqs = main.querySelector('#reqs') as HTMLElement;
  const label = (id: string) => d.matches.find((x: any) => x.id === id)?.label || 'Past match';
  reqs.innerHTML = d.requests.length ? d.requests.map((r: any) => `<article class="mc-acc" data-id="${esc(r.id)}">
      ${r.photo ? `<img src="${esc(r.photo)}" alt="Passport photo of ${esc(r.fullName)}" width="90" height="120" />` : '<div class="mc-acc-nophoto">No photo</div>'}
      <div class="mc-acc-body"><p><b>${esc(r.fullName)}</b> <span class="mc-pill ${PILL[r.status]}">${esc(ST[r.status] || r.status)}</span>${r.number ? ` <small>${esc(r.number)}</small>` : ''}</p>
        <p class="mc-small">${esc(r.organisation)} (${esc(r.employment)}) · ${esc(r.role)}${m ? '' : ` · <b>${esc(label(r.eventId))}</b>`}<br />${esc(r.email)} · ${esc(r.phone)}<br />Applied ${esc(when(r.createdAt))}${r.decidedBy ? ` · decided by ${esc(r.decidedBy)}` : ''}</p>
        ${r.equipment ? `<p class="mc-small"><b>Equipment:</b> ${esc(r.equipment)}</p>` : ''}${r.needs ? `<p class="mc-small"><b>Special needs:</b> ${esc(r.needs)}</p>` : ''}
        ${r.infoRequest && r.status === 'info' ? `<p class="mc-comment">Asked: ${esc(r.infoRequest)}</p>` : ''}${r.reason ? `<p class="mc-comment">Reason: ${esc(r.reason)}</p>` : ''}${r.revokeReason ? `<p class="mc-comment">Revoked by ${esc(r.revokedBy)}: ${esc(r.revokeReason)}</p>` : ''}
        <p class="mc-small">${r.pressDoc ? `<a href="${esc(r.pressDoc)}" target="_blank" rel="noopener">ID card / letter</a>` : 'No document'}${r.photo ? ` · <a href="${esc(r.photo)}" target="_blank" rel="noopener">Photo</a>` : ''}${r.zone ? ` · Access: <b>${esc(r.zone)}</b>` : ''}</p>
        ${['pending', 'info'].includes(r.status) ? `<div class="mc-acc-acts"><select data-zone aria-label="Access zone"><option value="">Access zone…</option>${d.zones.map((z: string) => `<option>${esc(z)}</option>`).join('')}</select><button class="mc-btn mc-btn-blue mc-btn-sm" type="button" data-do="approve">Approve</button><button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-do="info">Request more info</button><button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-do="reject">Reject</button></div>` : ''}
        ${['approved', 'revoked'].includes(r.status) ? `<p><a class="mc-btn mc-btn-o mc-btn-sm" href="/api/media-centre/accreditations/${esc(r.id)}/card">Card for lamination (PDF)</a> <a class="mc-btn mc-btn-o mc-btn-sm" href="/api/media-centre/accreditations/${esc(r.id)}/letter">Approval letter (PDF)</a> ${r.verifyUrl ? `<a class="mc-small" href="${esc(r.verifyUrl)}" target="_blank" rel="noopener">Verification page</a>` : ''}</p>` : ''}
      </div></article>`).join('') : '<p class="mc-empty">No requests yet.</p>';
  reqs.addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-do]'); if (!b) return;
    const card = b.closest<HTMLElement>('[data-id]')!, id = card.dataset.id!, decision = b.dataset.do!;
    const body: any = { decision };
    if (decision === 'approve') { body.zone = (card.querySelector('[data-zone]') as HTMLSelectElement).value; if (!body.zone) { toast('Choose the access zone first.'); return; } }
    if (decision === 'reject') { body.reason = prompt('Reason (it is emailed to the applicant):') || ''; if (!body.reason.trim()) return; }
    if (decision === 'info') { body.message = prompt('What do you need from the applicant? (emailed with a link to update the request)') || ''; if (!body.message.trim()) return; }
    b.setAttribute('disabled', '');
    try {
      const r = await api(`accreditations/${id}`, { method: 'POST', body });
      toast(decision === 'approve' ? `Approved: ${r.number}. ${r.emailed ? 'The card was emailed.' : 'Email is not set up: download the card and send it.'}` : decision === 'reject' ? `Rejected.${r.emailed ? ' The applicant was emailed.' : ''}` : `Request sent.${r.emailed ? '' : ` Email is not set up: send them this link: ${r.link}`}`, 12000);
      go(`/accreditation${event ? `/${event}` : ''}`, true);
    } catch (err: any) { toast(err.message, 9000); b.removeAttribute('disabled'); }
  });
  main.querySelectorAll<HTMLElement>('[data-reopen]').forEach(b => b.addEventListener('click', async () => {
    const open = b.dataset.open === '1';
    if (!confirm(open ? 'Open applications for this match again? Journalists can then apply until kick-off.' : 'Close applications for this match again?')) return;
    try {
      await api('accreditations', { method: 'POST', body: { action: 'reopen', eventId: b.dataset.reopen, open } });
      toast(open ? 'Applications are open again for this match.' : 'Applications are closed for this match.');
      go(`/accreditation${event ? `/${event}` : ''}`, true);
    } catch (err: any) { toast(err.message, 9000); }
  }));
  main.querySelectorAll<HTMLElement>('[data-invite]').forEach(b => b.addEventListener('click', async () => {
    const email = prompt('Email the invitation to (optional; leave empty to just copy the link):') ?? null;
    if (email === null) return;
    try {
      const r = await api('accreditations', { method: 'POST', body: { action: 'invite', eventId: b.dataset.invite, email } });
      try { await navigator.clipboard.writeText(r.link); } catch { /* not allowed */ }
      if (navigator.share && !email) navigator.share({ title: 'Lobi Stars FC media accreditation', url: r.link }).catch(() => {});
      toast(`${r.emailed ? 'Invitation emailed. ' : ''}Link copied: ${r.link}`, 14000);
    } catch (err: any) { toast(err.message, 9000); }
  }));
} });

async function contactsScreen(main: HTMLElement) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const { contacts } = await api('accreditations?view=contacts');
  main.innerHTML = `<div class="mc-page-head"><h1>Media contacts</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/accreditation/" data-go="/accreditation">← Accreditation</a></div>
    <p class="mc-muted">Journalists saved when they are accredited (or after an interview request). Returning applicants are recognised by their email address. Press releases are emailed to this list.</p>
    <section class="mc-card"><input class="mc-input" id="q" placeholder="Search name, organisation or email" style="margin:0 0 10px" /><div class="mc-scroll"><table class="mc-table"><thead><tr><th>Name</th><th>Organisation</th><th>Contact</th><th>History</th></tr></thead><tbody id="rows">${contacts.map((c: any) => `<tr data-s="${esc(`${c.fullName} ${c.organisation} ${c.email}`.toLowerCase())}"><td><b>${esc(c.fullName)}</b><br /><small>${esc(c.role || '')} · ${esc(c.employment || '')}</small></td><td>${esc(c.organisation || '')}</td><td><a href="mailto:${esc(c.email)}">${esc(c.email)}</a><br />${esc(c.phone || '')}</td><td><small>${c.accreditations} accreditation(s), ${c.interviews} interview request(s) · last ${esc(day(c.lastSeen))}</small></td></tr>`).join('') || '<tr><td colspan="4" class="mc-empty">No contacts yet.</td></tr>'}</tbody></table></div></section>`;
  main.querySelector('#q')!.addEventListener('input', e => { const v = (e.target as HTMLInputElement).value.toLowerCase(); main.querySelectorAll<HTMLElement>('#rows tr[data-s]').forEach(r => { r.hidden = !!v && !r.dataset.s!.includes(v); }); });
}
