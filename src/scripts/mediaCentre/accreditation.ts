// Media Centre › Accreditation.
//   /accreditation               home matches (card colours, new / approved counts, status)
//   /accreditation/<id>          applications for one match: approve with access zones 1–5,
//                                reject, ask for more, revoke / restore; "Send approval emails",
//                                "Print all approved cards"
//   /accreditation/<id>/settings the match's card settings (design, opponent, approving officer)
//   /accreditation/<id>/review/<application>  the full application: the only place to approve,
//                                reject or ask for more (the server refuses decisions on unopened applications)
//   (media contacts are in the Press List)
import { api, esc, when, day, register, toast, go } from './core';
import { upload, pickFile } from './files';

const ST: Record<string, string> = { pending: 'New', info: 'Waiting for the applicant', approved: 'Approved', rejected: 'Rejected', revoked: 'Revoked' };
const PILL: Record<string, string> = { pending: 'submitted', info: 'returned', approved: 'published', rejected: 'rejected', revoked: 'rejected' };
const swatch = (c: any) => `<span class="mc-sw" aria-hidden="true"><i style="background:${esc(c.main)}"></i><i style="background:${esc(c.band)}"></i><i style="background:${esc(c.alert)}"></i></span>`;
const fileUrl = (id: string | null) => (id ? `/api/media-file/${encodeURIComponent(id)}` : '');

register({ path: 'accreditation', label: 'Accreditation', icon: '🎫', async render(main, parts) {
  if (parts[0] === 'contacts') { go('/press-list', true); return; }
  if (parts[0] && parts[1] === 'settings') return settingsScreen(main, parts[0]);
  if (parts[0] && parts[1] === 'review' && parts[2]) return reviewScreen(main, parts[0], parts[2]);
  if (parts[0]) return applicationsScreen(main, parts[0]);
  return matchesScreen(main);
} });

async function matchesScreen(main: HTMLElement) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const [d, a] = await Promise.all([api('accreditations/matches'), api('accreditations?event=__none__')]);
  const open = (id: string) => a.matches.find((x: any) => x.id === id);
  main.innerHTML = `<div class="mc-page-head"><h1>Accreditation</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/press-list/" data-go="/press-list">Press List</a></div>
    <p class="mc-muted">Journalists apply on <a href="/media/accreditation/" target="_blank" rel="noopener">lobistarsfc.com/media/accreditation</a> for one home match. Approve them here, then press <b>Send approval emails</b>. Cards are printed and collected at the stadium. At most <b>${a.max}</b> accredited per match; applications close ${a.closeHours} hours before kick-off (you can open them again until kick-off).</p>
    <section class="mc-card"><div class="mc-scroll"><table class="mc-table"><thead><tr><th>Card</th><th>Match</th><th>Date</th><th>New</th><th>Approved</th><th>Status</th><th></th></tr></thead><tbody>
    ${d.matches.map((m: any) => { const o = open(m.id); return `<tr>
      <td>${swatch(m.colours)}<br /><small>${esc(m.theme)}</small></td>
      <td><b>Lobi Stars FC vs ${esc(m.opponent)}</b><br /><small>${esc(m.competition)}${m.matchday ? ` · MD ${esc(m.matchday)}` : ''}</small>${m.approverSet ? '' : '<br /><small class="mc-warn-t">No approving officer yet</small>'}</td>
      <td>${esc(m.day)}</td><td><span class="mc-pill submitted">${m.pending}</span></td><td><span class="mc-pill published">${m.approved}</span>${m.waiting ? `<br /><small>${m.waiting} not emailed</small>` : ''}</td>
      <td>${esc(m.status)}${o?.reopened ? '<br /><small>opened again</small>' : ''}</td>
      <td class="mc-acts"><a class="mc-btn mc-btn-blue mc-btn-sm" href="/media-centre/accreditation/${esc(m.id)}/" data-go="/accreditation/${esc(m.id)}">Applications</a> <a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/accreditation/${esc(m.id)}/settings/" data-go="/accreditation/${esc(m.id)}/settings">Match settings</a>
        ${o ? ` <button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-invite="${esc(m.id)}">Invitation link</button>${o.reopened ? ` <button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-reopen="${esc(m.id)}" data-open="0">Close late applications</button>` : !o.open && o.accept ? ` <button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-reopen="${esc(m.id)}" data-open="1">Open late applications</button>` : ''}` : ''}</td></tr>`; }).join('') || '<tr><td colspan="7" class="mc-empty">No home matches in the fixtures.</td></tr>'}
    </tbody></table></div></section>`;
  main.querySelectorAll<HTMLElement>('[data-reopen]').forEach(b => b.addEventListener('click', async () => {
    const o = b.dataset.open === '1';
    if (!confirm(o ? 'Open applications for this match again? Journalists can then apply until kick-off.' : 'Close the late applications for this match?')) return;
    try { await api('accreditations', { method: 'POST', body: { action: 'reopen', eventId: b.dataset.reopen, open: o } }); toast(o ? 'Applications are open again.' : 'Late applications closed.'); go('/accreditation', true); } catch (err: any) { toast(err.message, 9000); }
  }));
  main.querySelectorAll<HTMLElement>('[data-invite]').forEach(b => b.addEventListener('click', async () => {
    const email = prompt('Email the invitation to (optional; leave empty to just copy the link):') ?? null;
    if (email === null) return;
    try {
      const r = await api('accreditations', { method: 'POST', body: { action: 'invite', eventId: b.dataset.invite, email } });
      try { await navigator.clipboard.writeText(r.link); } catch { /* not allowed */ }
      toast(`${r.emailed ? 'Invitation emailed. ' : ''}Link copied: ${r.link}`, 14000);
    } catch (err: any) { toast(err.message, 9000); }
  }));
}

async function applicationsScreen(main: HTMLElement, event: string) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const [d, s] = await Promise.all([api(`accreditations?event=${encodeURIComponent(event)}`), api(`accreditations/matches?event=${encodeURIComponent(event)}`)]);
  const ms = s.settings, approverOk = !!(ms.approverName && ms.approverSignatureId);
  const toSend = d.requests.filter((r: any) => r.status === 'approved' && !r.emailSentAt).length;
  const roleZones = (role: string) => (d.roleInfo.find((x: any) => x.name === role) || d.roleInfo[0]).zones as number[];
  main.innerHTML = `<div class="mc-page-head"><h1>Lobi Stars FC vs ${esc(ms.opponent)}</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/accreditation/" data-go="/accreditation">← All matches</a></div>
    <p class="mc-muted">${esc(s.match.day)} · ${esc(ms.kickoff)} · ${esc(ms.venue)} · ${swatch(ms.colours)} ${esc(s.themes[ms.theme].name)}</p>
    ${approverOk ? '' : `<div class="mc-banner-warn"><b>No approving officer for this match.</b> Add the name, title and signature in <a href="/media-centre/accreditation/${esc(event)}/settings/" data-go="/accreditation/${esc(event)}/settings">Match settings</a> before sending approval emails.</div>`}
    <div class="mc-acts" style="margin:0 0 12px"><button class="mc-btn mc-btn-blue" type="button" id="send" ${toSend && approverOk ? '' : 'disabled'}>Send approval emails (${toSend})</button>
      <a class="mc-btn mc-btn-o" href="/api/media-centre/accreditations/print?event=${encodeURIComponent(event)}" target="_blank" rel="noopener">Print all approved cards</a>
      <a class="mc-btn mc-btn-o" href="/media-centre/accreditation/${esc(event)}/settings/" data-go="/accreditation/${esc(event)}/settings">Match settings</a></div>
    <section class="mc-card"><div class="mc-scroll"><table class="mc-table mc-acc-t"><thead><tr><th>Photo</th><th>Applicant</th><th>Press ID</th><th>Cat.</th><th>Status</th><th>Number</th><th>Actions</th></tr></thead><tbody id="rows">
    ${d.requests.map((r: any) => `<tr data-id="${esc(r.id)}">
      <td>${r.photo ? `<a href="${esc(r.photo)}" target="_blank" rel="noopener"><img src="${esc(r.photo)}" alt="Photo of ${esc(r.fullName)}" width="54" height="68" class="mc-acc-ph" /></a>` : '<small>No photo</small>'}</td>
      <td><b>${esc(r.fullName)}</b><br /><small>${esc(r.roleName)} · ${esc(r.organisation)} (${esc(r.employment)})<br />${esc(r.email)} · ${esc(r.phone)}<br />Applied ${esc(when(r.createdAt))}</small>
        ${r.needs ? `<br /><small><b>Special needs:</b> ${esc(r.needs)}</small>` : ''}${r.infoRequest && r.status === 'info' ? `<p class="mc-comment">Asked: ${esc(r.infoRequest)}</p>` : ''}${r.reason ? `<p class="mc-comment">Reason: ${esc(r.reason)}</p>` : ''}${r.revokeReason ? `<p class="mc-comment">Revoked: ${esc(r.revokeReason)}</p>` : ''}</td>
      <td>${r.pressDoc ? `<a href="${esc(r.pressDoc)}" target="_blank" rel="noopener">View ID</a>` : '<small>None</small>'}</td>
      <td><b class="mc-cat">${esc(r.category)}</b></td>
      <td><span class="mc-pill ${PILL[r.status]}">${esc(ST[r.status] || r.status)}</span>${r.emailSentAt ? `<br /><small>Emailed ${esc(day(r.emailSentAt))}</small>` : r.status === 'approved' ? '<br /><small>Not emailed yet</small>' : ''}</td>
      <td>${r.number ? `<b>${esc(r.number)}</b>${r.status === 'approved' ? `<br /><small>Zones ${esc(r.zones.join(', '))}</small>` : ''}` : ''}</td>
      <td class="mc-acts">${['pending', 'info'].includes(r.status) ? `<a class="mc-btn mc-btn-blue mc-btn-sm" href="/media-centre/accreditation/${esc(event)}/review/${esc(r.id)}/" data-go="/accreditation/${esc(event)}/review/${esc(r.id)}">Review application</a>${r.reviewedAt ? `<br /><small>Reviewed by ${esc(r.reviewedBy || '')}</small>` : ''}`
        : r.status === 'approved' ? `<a class="mc-btn mc-btn-o mc-btn-sm" href="/api/media-centre/accreditations/${esc(r.id)}/card" target="_blank" rel="noopener">View card</a> ${r.emailSentAt ? '<button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-act="resend">Resend email</button> ' : ''}<button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-act="revoke">Revoke</button>`
        : r.status === 'revoked' ? `<a class="mc-btn mc-btn-o mc-btn-sm" href="/api/media-centre/accreditations/${esc(r.id)}/card" target="_blank" rel="noopener">View card</a> <button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-act="restore">Restore</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="mc-empty">No applications for this match yet.</td></tr>'}
    </tbody></table></div><p class="mc-small">Zones: ${d.zones.map((z: any) => `<b>${z.n}</b> ${esc(z.name)}`).join(' · ')}</p></section>`;
  const reload = () => go(`/accreditation/${event}`, true);
  main.querySelector('#send')?.addEventListener('click', async e => {
    if (!confirm(`Send the approval email to ${toSend} approved applicant${toSend === 1 ? '' : 's'}? Each person is emailed only once.`)) return;
    (e.currentTarget as HTMLButtonElement).disabled = true;
    try { const r = await api('accreditations/matches', { method: 'POST', body: { action: 'send_emails', eventId: event } }); toast(`${r.sent} approval email${r.sent === 1 ? '' : 's'} sent.${r.failed ? ` ${r.failed} could not be sent; try again.` : ''}`, 9000); reload(); }
    catch (err: any) { toast(err.message, 9000); reload(); }
  });
  main.querySelector('#rows')!.addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-do],[data-act]'); if (!b) return;
    const row = b.closest<HTMLElement>('[data-id]')!, id = row.dataset.id!;
    const body: any = {};
    if (b.dataset.do) {
      body.decision = b.dataset.do;
      if (body.decision === 'approve') { body.zones = [...row.querySelectorAll<HTMLInputElement>('.mc-zones input:checked')].map(i => Number(i.value)); if (!body.zones.length) { toast('Tick at least one access zone.'); return; } }
      if (body.decision === 'reject') { body.reason = prompt('Reason (it is emailed to the applicant):') || ''; if (!body.reason.trim()) return; }
      if (body.decision === 'info') { body.message = prompt('What do you need from the applicant? (emailed with a link to update the request)') || ''; if (!body.message.trim()) return; }
    } else {
      body.action = b.dataset.act;
      if (body.action === 'revoke') { const why = prompt('Revoke this accreditation? The QR code will show NOT VALID. Reason (optional):'); if (why === null) return; body.reason = why; }
      if (body.action === 'resend' && !confirm('Send the approval email to this person again?')) return;
    }
    b.setAttribute('disabled', '');
    try {
      const r = await api(`accreditations/${id}`, { method: 'POST', body });
      toast(body.decision === 'approve' ? `Approved: ${r.number}. Press "Send approval emails" when you are ready.` : body.decision === 'reject' ? `Rejected.${r.emailed ? ' The applicant was emailed.' : ''}` : body.decision === 'info' ? `Request sent.${r.emailed ? '' : ` Email is not set up: send them this link: ${r.link}`}` : body.action === 'revoke' ? 'Revoked.' : body.action === 'restore' ? 'Restored (same number and QR code).' : 'Email sent again.', 9000);
      reload();
    } catch (err: any) { toast(err.message, 9000); b.removeAttribute('disabled'); }
  });
}

async function settingsScreen(main: HTMLElement, event: string) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const { match, settings: ms, themes } = await api(`accreditations/matches?event=${encodeURIComponent(event)}`);
  const v: any = { ...ms };
  const f = (k: string, label: string, val: string, extra = '') => `<label class="mc-field"><span>${label}</span><input class="mc-input" name="${k}" value="${esc(val)}" ${extra} /></label>`;
  main.innerHTML = `<div class="mc-page-head"><h1>Match settings</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/accreditation/${esc(event)}/" data-go="/accreditation/${esc(event)}">← Applications</a></div>
    <p class="mc-muted">${esc(match.label)} · ${esc(match.day)}. These details appear on the cards, the approval email and the verification page.</p>
    <form id="ms" class="mc-card mc-form-grid">
      <h2 class="mc-h3">Match</h2>
      ${f('opponent', 'Opponent name', ms.opponent, 'required maxlength="80"')}
      <div class="mc-field"><span>Opponent logo</span><div class="mc-acts"><img id="logo" src="${esc(fileUrl(ms.opponentLogoId))}" alt="" width="56" height="56" class="mc-oplogo" ${ms.opponentLogoId ? '' : 'hidden'} /><button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="uplogo">${ms.opponentLogoId ? 'Change logo' : 'Upload logo'}</button><small>If none, the club's usual logo is used.</small></div></div>
      ${f('competition', 'Competition', ms.competition, 'maxlength="80"')}
      ${f('matchday', 'Matchday (number)', ms.matchday, 'maxlength="10" inputmode="numeric"')}
      ${f('kickoff', 'Kick-off (as printed)', ms.kickoff, 'maxlength="20"')}
      ${f('venue', 'Venue', ms.venue, 'maxlength="120"')}
      ${f('collectionTime', 'Card collection from', ms.collectionTime, 'type="time" required')}
      <label class="mc-check"><input type="checkbox" name="accept" ${ms.accept ? 'checked' : ''} /> Accept applications on the website for this match</label>
      <h2 class="mc-h3">Card colours</h2>
      <div class="mc-themes" role="radiogroup" aria-label="Card colour design">${Object.entries(themes).map(([k, t]: any) => `<label class="mc-theme"><input type="radio" name="theme" value="${k}" ${ms.theme === k ? 'checked' : ''} />${swatch(t)}<span>${esc(t.name)}</span></label>`).join('')}</div>
      <p class="mc-small">Custom colours (optional, e.g. #0E2A55) replace the design's colours:</p>
      <div class="mc-acts">${f('customMain', 'Main', ms.custom.main, 'placeholder="#0E2A55" pattern="#[0-9A-Fa-f]{6}"')}${f('customBand', 'Band', ms.custom.band, 'placeholder="#F5C11A" pattern="#[0-9A-Fa-f]{6}"')}${f('customAlert', 'Alert', ms.custom.alert, 'placeholder="#D62839" pattern="#[0-9A-Fa-f]{6}"')}</div>
      <h2 class="mc-h3">Approving officer</h2>
      <p class="mc-small">Printed on every card and in the approval email. Filled in from the last match; change it if someone else approves.</p>
      ${f('approverName', 'Name', ms.approverName, 'maxlength="80"')}
      ${f('approverTitle', 'Title', ms.approverTitle, 'maxlength="60"')}
      <div class="mc-field"><span>Signature</span><div class="mc-acts"><img id="sig" src="${esc(fileUrl(ms.approverSignatureId))}" alt="Signature" height="50" class="mc-sig" ${ms.approverSignatureId ? '' : 'hidden'} /><button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="upsig">${ms.approverSignatureId ? 'Change signature' : 'Upload signature'}</button><small>A photo of the signature on white paper (PNG or JPG).</small></div></div>
      <p><button class="mc-btn mc-btn-blue" type="submit">Save settings</button></p>
    </form>`;
  const form = main.querySelector('#ms') as HTMLFormElement;
  const pick = async (img: string, key: string, btn: HTMLElement) => {
    const file = await pickFile('image/png,image/jpeg,image/webp'); if (!file) return;
    btn.setAttribute('disabled', '');
    try { const u = await upload(file, { kind: 'image', section: 'accreditation', maxSide: 800 }); v[key] = u.id; const el = main.querySelector(`#${img}`) as HTMLImageElement; el.src = u.url || fileUrl(u.id); el.hidden = false; toast('Uploaded. Press Save settings to keep it.'); }
    catch (err: any) { toast(err.message, 9000); } finally { btn.removeAttribute('disabled'); }
  };
  main.querySelector('#uplogo')!.addEventListener('click', e => pick('logo', 'opponentLogoId', e.currentTarget as HTMLElement));
  main.querySelector('#upsig')!.addEventListener('click', e => pick('sig', 'approverSignatureId', e.currentTarget as HTMLElement));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const body: any = { action: 'settings', eventId: event, opponentLogoId: v.opponentLogoId, approverSignatureId: v.approverSignatureId, accept: fd.get('accept') === 'on' };
    for (const k of ['opponent', 'competition', 'matchday', 'kickoff', 'venue', 'collectionTime', 'theme', 'customMain', 'customBand', 'customAlert', 'approverName', 'approverTitle']) body[k] = String(fd.get(k) || '').trim();
    if (body.approverName && body.approverName !== ms.approverName && body.approverSignatureId === ms.approverSignatureId) body.approverSignatureId = null;
    try { await api('accreditations/matches', { method: 'POST', body }); toast('Settings saved.'); go(`/accreditation/${event}`); } catch (err: any) { toast(err.message, 9000); }
  });
}

async function reviewScreen(main: HTMLElement, event: string, id: string) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const [d, list] = await Promise.all([api(`accreditations/${encodeURIComponent(id)}?review=1`), api(`accreditations?event=${encodeURIComponent(event)}`)]);
  const r = d.request, open = ['pending', 'info'].includes(r.status);
  const roleZones = ((list.roleInfo.find((x: any) => x.name === r.roleName) || list.roleInfo[0]).zones) as number[];
  const pos = d.queue.indexOf(r.id), next = d.queue[pos + 1] || d.queue.find((x: string) => x !== r.id) || '';
  const docUrl = r.pressDoc ? `${r.pressDoc}${d.doc?.mime === 'application/pdf' ? '?frame=1' : ''}` : '';
  const row = (k: string, v: string) => v ? `<tr><th>${k}</th><td>${v}</td></tr>` : '';
  const STL: Record<string, string> = { pending: 'New', info: 'Waiting for the applicant', approved: 'Approved', rejected: 'Rejected', revoked: 'Revoked' };
  main.innerHTML = `<div class="mc-page-head"><h1>Review: ${esc(r.fullName)}</h1><div class="mc-acts"><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/accreditation/${esc(event)}/" data-go="/accreditation/${esc(event)}">← Applications</a>${next ? ` <a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/accreditation/${esc(event)}/review/${esc(next)}/" data-go="/accreditation/${esc(event)}/review/${esc(next)}">Next application →</a>` : ''}</div></div>
    <p class="mc-muted">${d.match ? `${esc(d.match.label)} · ${esc(day(d.match.date))} · ` : ''}applied ${esc(when(r.createdAt))}${d.queue.length && pos >= 0 ? ` · ${pos + 1} of ${d.queue.length} waiting` : ''}</p>
    <div class="mc-review">
      <section class="mc-card mc-review-person">
        ${r.photo ? `<a href="${esc(r.photo)}" target="_blank" rel="noopener"><img src="${esc(r.photo)}" alt="Passport photo of ${esc(r.fullName)}" width="240" height="320" class="mc-review-photo" /></a>` : '<div class="mc-review-photo">No photo</div>'}
        <div class="mc-review-who"><h2>${esc(r.fullName)}</h2><p><b class="mc-cat">${esc(r.category)}</b> ${esc(r.roleName)}</p><p>${esc(r.organisation)} <small>(${esc(r.employment)})</small></p>
          <span class="mc-pill ${r.status === 'approved' ? 'published' : r.status === 'pending' ? 'submitted' : r.status === 'info' ? 'returned' : 'rejected'}">${esc(STL[r.status] || r.status)}</span></div>
        <table class="mc-table mc-review-t">
          ${row('Email', `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>`)}${row('Phone', `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>`)}
          ${row('Special needs', esc(r.needs || ''))}${row('Press list', d.pressList ? 'Subscribed' : 'Not subscribed')}
          ${row('Asked for more', r.infoRequest ? esc(r.infoRequest) : '')}${row('Number', r.number ? esc(r.number) : '')}${row('Reviewed', r.reviewedAt ? `${esc(r.reviewedBy || '')}, ${esc(when(r.reviewedAt))}` : '')}
        </table>
        <h3 class="mc-h3">Earlier applications</h3>
        ${d.earlier.length ? `<ul class="mc-review-earlier">${d.earlier.map((x: any) => `<li>${esc(x.match)} · ${esc(x.status)}${x.number ? ` · ${esc(x.number)}` : ''} <small>${esc(day(x.createdAt))}</small></li>`).join('')}</ul>` : '<p class="mc-small">First application from this email.</p>'}
      </section>
      <section class="mc-card mc-review-doc"><div class="mc-page-head"><h2 class="mc-h3">Organisation ID card / letter</h2>${r.pressDoc ? `<a class="mc-btn mc-btn-o mc-btn-sm" href="${esc(docUrl)}" target="_blank" rel="noopener">Open full size</a>` : ''}</div>
        ${!r.pressDoc ? '<p class="mc-empty">No document was added.</p>' : d.doc?.mime === 'application/pdf' ? `<iframe class="mc-review-frame" src="${esc(docUrl)}" title="ID card or letter (PDF)"></iframe>` : `<img class="mc-review-img" src="${esc(r.pressDoc)}" alt="ID card or letter from ${esc(r.organisation)}" />`}
        <p class="mc-small">Check that the name and organisation match the application and the photo.</p></section>
    </div>
    ${open ? `<section class="mc-card mc-review-decide"><h2 class="mc-h3">Your decision</h2>
      <fieldset class="mc-zones mc-zones-lg"><legend>Access zones (ticked for a ${esc(r.roleName)})</legend>${list.zones.map((z: any) => `<label><input type="checkbox" value="${z.n}" ${roleZones.includes(z.n) ? 'checked' : ''} /> <b>${z.n}</b> ${esc(z.name)}</label>`).join('')}</fieldset>
      <div class="mc-acts"><button class="mc-btn mc-btn-blue" type="button" id="approve">Approve</button><button class="mc-btn mc-btn-o" type="button" id="showReject">Reject…</button><button class="mc-btn mc-btn-o" type="button" id="showInfo">Ask for more…</button></div>
      <div id="rejectBox" hidden><label class="mc-field"><span>Reason (emailed to the applicant)</span><textarea class="mc-input" id="reason" rows="3" maxlength="500"></textarea></label><button class="mc-btn mc-btn-o" type="button" id="reject">Reject this application</button></div>
      <div id="infoBox" hidden><label class="mc-field"><span>What do you need from the applicant? (emailed with a link to update the application)</span><textarea class="mc-input" id="infoMsg" rows="3" maxlength="500"></textarea></label><button class="mc-btn mc-btn-o" type="button" id="info">Send the request</button></div>
    </section>` : `<p class="mc-muted">This application has been decided (${esc(STL[r.status] || r.status)}).</p>`}`;
  if (!open) return;
  const $ = (x: string) => main.querySelector(`#${x}`) as any;
  const after = () => go(next ? `/accreditation/${event}/review/${next}` : `/accreditation/${event}`, true);
  const decide = async (body: any, btn: HTMLButtonElement, done: (res: any) => string) => {
    btn.disabled = true;
    try { const res = await api(`accreditations/${encodeURIComponent(id)}`, { method: 'POST', body }); toast(done(res), 9000); after(); }
    catch (err: any) { toast(err.message, 9000); btn.disabled = false; }
  };
  $('showReject').addEventListener('click', () => { $('rejectBox').hidden = false; $('infoBox').hidden = true; $('reason').focus(); });
  $('showInfo').addEventListener('click', () => { $('infoBox').hidden = false; $('rejectBox').hidden = true; $('infoMsg').focus(); });
  $('approve').addEventListener('click', (e: Event) => {
    const zones = [...main.querySelectorAll<HTMLInputElement>('.mc-zones input:checked')].map(i => Number(i.value));
    if (!zones.length) { toast('Tick at least one access zone.'); return; }
    if (!confirm(`Approve ${r.fullName} (${r.organisation}) with zones ${zones.join(', ')}?`)) return;
    decide({ decision: 'approve', zones }, e.currentTarget as HTMLButtonElement, res => `Approved: ${res.number}. Press "Send approval emails" on the applications page when you are ready.`);
  });
  $('reject').addEventListener('click', (e: Event) => { const reason = $('reason').value.trim(); if (!reason) { toast('Write the reason.'); return; } decide({ decision: 'reject', reason }, e.currentTarget as HTMLButtonElement, res => `Rejected.${res.emailed ? ' The applicant was emailed.' : ''}`); });
  $('info').addEventListener('click', (e: Event) => { const message = $('infoMsg').value.trim(); if (!message) { toast('Write what you need.'); return; } decide({ decision: 'info', message }, e.currentTarget as HTMLButtonElement, res => `Request sent.${res.emailed ? '' : ` Email is not set up: send them this link: ${res.link}`}`); });
}
