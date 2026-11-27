// Statistics Center › Settings › Data retention, archiving and privacy (staff only).
// Super Admins can change policies, archive seasons, mark youth players and anonymise; statisticians can look.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Ctx } from './bst';

const ACT: Record<string, string> = { keep: 'Keep forever', archive: 'Archive', anonymise: 'Remove personal text', purge: 'Delete' };
const sum = (r: any) => {
  if (!r) return '';
  if (r.error) return r.error;
  if (r.keep || r.note) return r.note || 'Kept forever.';
  const bits = [];
  for (const [k, w] of [['wouldPurge', 'to delete'], ['wouldArchive', 'to archive'], ['wouldAnonymise', 'to clear']] as const) if (r[k] !== undefined) bits.push(`${r[k]} ${w}`);
  for (const [k, w] of [['purged', 'deleted'], ['archived', 'archived'], ['anonymised', 'cleared']] as const) if (r[k]) bits.push(`${r[k]} ${w}`);
  return (bits.join(', ') || 'nothing') + (r.oldest ? ` (oldest ${String(r.oldest).slice(0, 10)})` : '');
};

export async function retentionView(ctx: Ctx) {
  const { api, esc, toast, view, when, S } = ctx;
  const d = await api('retention');
  const can = d.canEdit, st = d.state;
  const roster: any[] = (S.roster || []).filter((p: any) => p.slug);
  const priv = new Map<string, any>(d.privacy.map((p: any) => [p.slug, p]));
  const b = d.backups;
  view().innerHTML = `<h2>Data retention &amp; privacy</h2>
    <p class="sx-small">How long each kind of information is kept, what happens to old seasons and how players' personal notes are protected. Match history (matches, events, line-ups and scores) is never deleted. Old seasons are archived and stay on the public pages. ${can ? '' : '<b>Only a Super Admin can change anything here.</b>'} This is the club's own setting, not legal advice: confirm the periods with the club's data-protection adviser.</p>
    <section class="sx-card"><h3>Automatic clean-up</h3>
      <p>${st.paused ? '<b class="sx-err">Paused.</b>' : st.dryRun ? `<b>Trial mode until ${esc(when(st.dryRunUntil))}:</b> it only counts what it would do; nothing is removed.` : '<b>On.</b> Runs every night after 3:00am, a little at a time.'}
        ${st.lastRun ? ` Last run ${esc(when(st.lastRun.at))} (${esc(st.lastRun.mode)}${st.lastRun.errors ? `, ${st.lastRun.errors} problem(s)` : ''}).` : ' Not run yet.'}</p>
      ${can ? `<div class="sx-row"><button class="sx-btn" id="rtPause">${st.paused ? 'Resume' : 'Pause'}</button>${st.dryRun ? '<button class="sx-btn" id="rtLive">End trial mode now</button>' : ''}<button class="sx-btn sx-btn--p" id="rtRun">Run now…</button></div>` : ''}
      <div id="rtOut"></div></section>
    <section class="sx-card sx-scroll"><h3>How long things are kept</h3><table class="sx-t"><thead><tr><th>Information</th><th class="n">Days</th><th>Then</th><th>Now affected</th>${can ? '<th></th>' : ''}</tr></thead><tbody>
      ${d.policies.map((p: any) => `<tr data-key="${esc(p.key)}"><td><b>${esc(p.label)}</b><br><small class="sx-small">${esc(p.notes || '')}</small></td>
        <td class="n">${p.forever ? '—' : can ? `<input type="number" min="1" max="3650" value="${p.days ?? ''}" data-days style="width:6em" aria-label="Days for ${esc(p.label)}">` : esc(p.days ?? '—')}</td>
        <td>${esc(ACT[p.action] || p.action)}</td><td class="sx-small" data-prev>${p.forever ? 'Never removed' : '<button class="sx-btn" data-preview>Count</button>'}</td>
        ${can ? `<td>${p.forever ? '' : '<button class="sx-btn" data-save>Save</button>'}</td>` : ''}</tr>`).join('')}
    </tbody></table><p class="sx-small">Before a shorter period is saved, the page counts what it would affect. Every change is in the activity log.</p></section>
    <section class="sx-card"><h3>Nightly backups</h3>
      <p>${!b.storage ? 'Backup storage is not connected.' : b.stale ? '<b class="sx-err">No backup in the last 36 hours: tell the IT Center.</b>' : `Last backup: ${esc(b.last?.day || '')}.`} ${b.count} kept.</p>
      <p class="sx-small">Daily for 30 days, then one a week up to 90 days, then one a month up to a year (the whole website, encrypted copy sent weekly). Restoring is done by the IT Center.</p></section>
    <section class="sx-card sx-scroll"><h3>Seasons</h3><table class="sx-t"><thead><tr><th>Season</th><th class="n">Matches</th><th>Status</th><th>Archive files</th><th></th></tr></thead><tbody>
      ${d.seasons.map((s: any) => `<tr><td><b>${esc(s.season)}</b>${s.status === 'active' && s.endedDaysAgo > 60 ? '<br><small class="sx-err">Ended over 60 days ago: archive it</small>' : ''}</td><td class="n">${s.matches}</td>
        <td>${s.status === 'archived' ? `Archived ${esc(when(s.archivedAt))}<br><small class="sx-small">read only</small>` : 'Active'}${s.offsiteCopiedAt ? `<br><small class="sx-small">Copied off-site ${esc(when(s.offsiteCopiedAt))}</small>` : ''}</td>
        <td class="sx-small">${s.exports.slice(0, 3).map((e: any) => `<a href="/api/stats-centre/archive/file?id=${encodeURIComponent(e.id)}">${esc(e.path.split('/').pop())}</a> ${e.verifiedOk === true ? '✓ checked' : e.verifiedOk === false ? '<b class="sx-err">✗ damaged</b>' : ''} <button class="sx-btn" data-verify="${esc(e.id)}">Check</button>`).join('<br>') || '—'}</td>
        <td>${can ? (s.status === 'archived' ? `<button class="sx-btn" data-unarch="${esc(s.season)}">Unlock…</button> <button class="sx-btn" data-offsite="${esc(s.season)}">I copied it off-site</button>` : `<button class="sx-btn sx-btn--p" data-arch="${esc(s.season)}">Archive…</button>`) : ''}</td></tr>`).join('') || '<tr><td class="sx-small">No seasons yet.</td></tr>'}
    </tbody></table><p class="sx-small">Archiving saves the whole season (JSON and CSV, with a checksum) in the backup storage and makes it read only. Nothing is deleted, and the public pages and career totals still show it. Download the files and keep a copy away from the website, then press "I copied it off-site".</p></section>
    <section class="sx-card sx-scroll"><h3>Players' privacy</h3>
      <p class="sx-small"><b>Youth / minor:</b> notes are kept 2 seasons, and the player is shown as "Academy player" on public statistics unless "Show publicly" is ticked (with the guardian's agreement). <b>Left the club:</b> their personal notes are removed by the nightly clean-up; numbers stay. <b>Anonymise:</b> removes every note about the player now, for good.</p>
      <table class="sx-t"><thead><tr><th>Player</th><th>Youth / minor</th><th>Show publicly</th><th>Left on</th>${can ? '<th></th>' : ''}</tr></thead><tbody>
      ${roster.map((p: any) => { const x = priv.get(p.slug) || {}; return `<tr data-slug="${esc(p.slug)}"><td>${esc(p.name)}${x.anonymisedAt ? `<br><small class="sx-small">Anonymised ${esc(when(x.anonymisedAt))}</small>` : ''}</td>
        <td><input type="checkbox" data-youth ${x.youth ? 'checked' : ''} ${can ? '' : 'disabled'} aria-label="Youth: ${esc(p.name)}"></td><td><input type="checkbox" data-pub ${x.youthPublic ? 'checked' : ''} ${can ? '' : 'disabled'} aria-label="Show publicly: ${esc(p.name)}"></td>
        <td><input type="date" data-left value="${esc(String(x.leftAt || '').slice(0, 10))}" ${can ? '' : 'disabled'} aria-label="Left on: ${esc(p.name)}"></td>
        ${can ? '<td><button class="sx-btn" data-psave>Save</button> <button class="sx-btn" data-anon>Anonymise…</button></td>' : ''}</tr>`; }).join('')}
      </tbody></table></section>
    <section class="sx-card"><h3>Runs</h3><div class="sx-scroll"><table class="sx-t"><tbody>${d.runs.slice(0, 10).map((r: any) => `<tr><td>${esc(when(r.started_at))}</td><td>${esc(r.mode)}</td><td class="sx-small">${esc(Object.entries(r.counts || {}).map(([k, v]) => `${k}: ${sum(v)}`).join(' · ') || '—')}${r.errors ? `<br><b class="sx-err">${esc(r.errors)}</b>` : ''}</td><td class="sx-small">${esc(r.started_by || '')}</td></tr>`).join('') || '<tr><td class="sx-small">None yet.</td></tr>'}</tbody></table></div>
      <p><a class="sx-btn" href="#/inventory">What we keep (data inventory)</a></p></section>`;

  const v = view();
  const rerun = () => retentionView(ctx);
  v.querySelectorAll('[data-preview]').forEach(btn => btn.addEventListener('click', async () => {
    const tr = btn.closest('tr') as HTMLElement, days = (tr.querySelector('[data-days]') as HTMLInputElement | null)?.value ?? '';
    try { const r = await api(`retention/preview?key=${encodeURIComponent(tr.dataset.key!)}&days=${encodeURIComponent(days)}`); (tr.querySelector('[data-prev]') as HTMLElement).textContent = sum(r); } catch (x: any) { toast(x.message, false); }
  }));
  v.querySelectorAll('[data-save]').forEach(btn => btn.addEventListener('click', async () => {
    const tr = btn.closest('tr') as HTMLElement, key = tr.dataset.key!, days = (tr.querySelector('[data-days]') as HTMLInputElement).value;
    const pol = d.policies.find((p: any) => p.key === key);
    try {
      if (pol && Number(days) < Number(pol.days)) { const r = await api(`retention/preview?key=${encodeURIComponent(key)}&days=${encodeURIComponent(days)}`); if (!confirm(`Shorter period for "${pol.label}": ${sum(r)}. Save it?`)) return; }
      await api('retention/policy', { key, days, action: pol?.action }); toast('Saved.'); rerun();
    } catch (x: any) { toast(x.message, false); }
  }));
  v.querySelector('#rtPause')?.addEventListener('click', async () => { try { await api('retention/switch', { paused: !st.paused }); rerun(); } catch (x: any) { toast(x.message, false); } });
  v.querySelector('#rtLive')?.addEventListener('click', async () => { if (!confirm('End trial mode? From tonight the clean-up really removes old items (never match history).')) return; try { await api('retention/switch', { live: true }); rerun(); } catch (x: any) { toast(x.message, false); } });
  v.querySelector('#rtRun')?.addEventListener('click', async () => {
    const t = prompt(st.dryRun ? 'Trial mode: this only counts. Type RUN to start.' : 'This removes old items now (never match history). Type RUN to start.'); if (!t) return;
    try { const r = await api('retention/run', { confirm: t }); (v.querySelector('#rtOut') as HTMLElement).innerHTML = `<p class="sx-small">${esc(r.mode)}: ${esc(Object.entries(r.counts || {}).map(([k, x]) => `${k}: ${sum(x)}`).join(' · ') || 'nothing to do')}</p>`; toast('Done.'); } catch (x: any) { toast(x.message, false); }
  });
  v.querySelectorAll('[data-arch]').forEach(btn => btn.addEventListener('click', async () => {
    const s = (btn as HTMLElement).dataset.arch!;
    const t = prompt(`Archive ${s}? Everything is saved and the season becomes read only (nothing is deleted). Type ${s} to confirm.`); if (!t) return;
    try { const r = await api('season/archive', { season: s, confirm: t }); toast(`Archived: ${r.matches} matches, ${r.events} events.`); rerun(); } catch (x: any) { toast(x.message, false); }
  }));
  v.querySelectorAll('[data-unarch]').forEach(btn => btn.addEventListener('click', async () => {
    const reason = prompt('Why does this season need changing? (kept in the activity log)'); if (!reason) return;
    try { await api('season/unarchive', { season: (btn as HTMLElement).dataset.unarch, reason }); toast('Unlocked. Archive it again when done.'); rerun(); } catch (x: any) { toast(x.message, false); }
  }));
  v.querySelectorAll('[data-offsite]').forEach(btn => btn.addEventListener('click', async () => { try { await api('season/offsite', { season: (btn as HTMLElement).dataset.offsite }); toast('Recorded.'); rerun(); } catch (x: any) { toast(x.message, false); } }));
  v.querySelectorAll('[data-verify]').forEach(btn => btn.addEventListener('click', async () => { try { const r = await api('archive/verify', { id: (btn as HTMLElement).dataset.verify }); toast(r.matches ? 'The file is complete (checksum matches).' : 'The file does NOT match its checksum: tell the IT Center.', !!r.matches); rerun(); } catch (x: any) { toast(x.message, false); } }));
  v.querySelectorAll('[data-psave]').forEach(btn => btn.addEventListener('click', async () => {
    const tr = btn.closest('tr') as HTMLElement, q = (s: string) => tr.querySelector(s) as HTMLInputElement;
    try { await api('privacy/player', { slug: tr.dataset.slug, youth: q('[data-youth]').checked, youthPublic: q('[data-pub]').checked, leftAt: q('[data-left]').value }); toast('Saved.'); } catch (x: any) { toast(x.message, false); }
  }));
  v.querySelectorAll('[data-anon]').forEach(btn => btn.addEventListener('click', async () => {
    const tr = btn.closest('tr') as HTMLElement;
    const reason = prompt('Anonymise this player: every coach note and event note about them is removed for good (their numbers stay). Reason (kept in the activity log):'); if (!reason) return;
    const full = confirm('Also replace their name with "Former player #(shirt number)" in staff data? (The public squad pages are not changed.)');
    const t = prompt('This cannot be undone. Type ANONYMISE to confirm.'); if (!t) return;
    try { const r = await api('privacy/anonymise', { slug: tr.dataset.slug, reason, full, confirm: t }); toast(`Done: ${r.notes} note(s) removed.`); rerun(); } catch (x: any) { toast(x.message, false); }
  }));
}

export async function inventoryView(ctx: Ctx) {
  const { api, esc, view } = ctx;
  const d = await api('inventory');
  const CL: Record<string, string> = { performance: 'Performance', personal_note: 'Personal note', youth_or_minor: 'Youth / minor', opponent_personal: 'Opponent personal', operational: 'Operational', scouting: 'Scouting', 'all of the above': 'Everything' };
  const pol = new Map<string, any>(d.policies.map((p: any) => [p.key, p]));
  view().innerHTML = `<h2>What we keep</h2><p class="sx-small">Every kind of information in the Statistics Center, how it is classed and how long it is kept. <a href="#/retention">Back to retention</a></p>
    <section class="sx-card sx-scroll"><table class="sx-t"><thead><tr><th>Information</th><th>Where</th><th>Class</th><th>Kept</th></tr></thead><tbody>
    ${d.classification.map((c: any) => { const p = pol.get(String(c.policy).split(' ')[0]); return `<tr><td>${esc(c.data)}</td><td class="sx-small"><code>${esc(c.table)}</code></td><td>${esc(CL[c.classification] || c.classification)}</td><td class="sx-small">${p ? (p.forever || p.action === 'keep' ? 'Forever' : `${p.days} days, then ${esc((ACT[p.action] || p.action).toLowerCase())}`) : esc(c.policy)}</td></tr>`; }).join('')}
    </tbody></table></section>
    <section class="sx-card"><h3>Who sees what</h3><p class="sx-small">Public pages: published matches and players' numbers only (never notes, ratings notes, analyses or staff names; youth players unnamed unless allowed). Coaches with a share link: one analysis, notes only if ticked. Statisticians: everything recorded. Super Admins: everything, and the only ones who can change retention, archive seasons or anonymise.</p></section>`;
}
