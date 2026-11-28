// Analysis Form improvements (owner's request, 28 Nov 2026): the half-time sheet, what each measure means, the
// sections the measures are grouped into, keyboard keys, and the video link for a 2-minute block.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Ctx } from './bst';
import { fx } from './fx';

/** What each measure means (tap a measure on the form). The same words for every statistician. */
export const DEFS: Record<string, string> = {
  offence_attack: 'Our team has the ball and moves it forward with intent into the opponents\' half (one per attacking move, not per pass).',
  defense: 'The opponents have the ball in our half and we are defending (one per defensive phase).',
  goal_attempt: 'Worked out: shots on target + off target + blocked.',
  dangerous_attack: 'An attack that reaches the final third with a real chance of a shot or a cross (one per attack).',
  shot_on: 'A shot that would have gone in without a save or a defender on the line. Goals count here too (added on the live screen).',
  shot_off: 'A shot wide or over, including hitting the post or bar without going in.',
  blocked: 'A shot stopped by an outfield player before it reaches the goal.',
  free_kick: 'A free kick awarded to the team (any position).',
  corner: 'A corner kick taken by the team.',
  crossing: 'A ball played from a wide area into the penalty area, completed or not.',
  gk_save: 'The goalkeeper stops a shot on target (record it for the goalkeeper\'s team).',
  foul: 'A foul given by the referee against the team.',
  tackle_won: 'A tackle that wins the ball back for the team.',
  offside: 'An offside given against the team.',
  cards: 'Yellow and red cards shown to the team (a second yellow is a red).',
  xa: 'Expected assists: the xG of the shots that came from the pass (0.00 to 9.99 per block; worked out when shots have positions).',
  xg: 'Expected goals: how likely the shots were to be scored (0.00 to 9.99 per block; worked out when shots have positions).',
  goal_for: 'Worked out from the goals recorded.',
  goal_against: 'Worked out from the goals recorded.',
};
/** The sections of the form (open and close each one). */
export const GROUPS = [
  { key: 'attack', label: 'Attack', metrics: ['offence_attack', 'dangerous_attack', 'goal_attempt', 'shot_on', 'shot_off', 'blocked', 'crossing', 'xg', 'xa', 'goal_for'] },
  { key: 'defence', label: 'Defence', metrics: ['defense', 'tackle_won', 'gk_save', 'goal_against'] },
  { key: 'set', label: 'Set pieces and discipline', metrics: ['corner', 'free_kick', 'foul', 'offside', 'cards'] },
];
/** Keyboard keys (laptop): the letter adds one, Shift + the letter removes one. */
export const KEYS: Record<string, string> = { a: 'offence_attack', d: 'defense', g: 'dangerous_attack', s: 'shot_on', o: 'shot_off', b: 'blocked', x: 'crossing', c: 'corner', f: 'free_kick', k: 'gk_save', l: 'foul', w: 'tackle_won', y: 'offside' };
export const KEY_OF: Record<string, string> = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [v, k.toUpperCase()]));

const START: Record<string, number> = { '1H': 0, '2H': 45, ET1: 90, ET2: 105 };
/** A link to the match video at the start of a 2-minute block (when the video and its kick-off time are set in Match Setup). */
export function videoAt(m: any, sel: { period: string; block: string }) {
  if (!m.videoUrl || m.videoOffset === null || m.videoOffset === undefined) return null;
  const [b, plus] = String(sel.block).split('+').map(Number);
  const minuteStart = b - 2; // the block "12" is minutes 10–12
  let t: number;
  if (sel.period === '1H') t = Number(m.videoOffset) + (Math.max(0, minuteStart) + (plus ? plus - 2 : 0)) * 60;
  else if (sel.period === '2H') t = (m.videoOffset2 !== null && m.videoOffset2 !== undefined ? Number(m.videoOffset2) : Number(m.videoOffset) + 62 * 60) + (Math.max(0, minuteStart - START['2H']) + (plus ? plus - 2 : 0)) * 60;
  else return null;
  t = Math.max(0, Math.round(t));
  try {
    const u = new URL(m.videoUrl);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (/youtu\.be$|youtube\.com$/.test(host)) { const vid = host === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v') || u.pathname.split('/').pop(); return `https://www.youtube.com/watch?v=${encodeURIComponent(String(vid))}&t=${t}s`; }
    if (/vimeo\.com$/.test(host)) { u.hash = `t=${Math.floor(t / 60)}m${t % 60}s`; return u.toString(); }
    u.hash = `t=${t}`; return u.toString();
  } catch { return null; }
}

// ── The half-time sheet: one page for the dressing room (phone, print or WhatsApp) ──
export async function halfTimeView(c: Ctx, id: string) {
  const { esc } = c;
  const d = await c.api(`bst/one?id=${encodeURIComponent(id)}`);
  const m = d.match, lobiSide = m.lobiHome ? 'home' : 'away';
  const name = (s: string) => ((s === 'lobi') === (lobiSide === 'home') ? m.home : m.away);
  const sideOf = (s: string) => (s === 'lobi' ? lobiSide : lobiSide === 'home' ? 'away' : 'home');
  const h1 = (s: string, k: string) => Number(d.totals[s]?.[k]?.['1H'] || 0);
  const goals1 = d.events.filter((e: any) => !e.deleted && e.type === 'goal' && e.period === '1H');
  const htH = m.htHome ?? goals1.filter((e: any) => e.side === 'home').length, htA = m.htAway ?? goals1.filter((e: any) => e.side === 'away').length;
  const rows = d.metrics.filter((mt: any) => !['goal_for', 'goal_against'].includes(mt.key));
  const val = (mt: any, s: string) => (mt.kind === 'decimal' ? h1(s, mt.key).toFixed(2) : String(h1(s, mt.key)));
  // Talking points worked out from the first half.
  const pts: string[] = [];
  const att = h1('lobi', 'offence_attack'), def = h1('lobi', 'defense');
  if (att + def) pts.push(`We were attacking in ${Math.round((att / (att + def)) * 100)}% of the recorded phases (${att} attacks, ${def} defending phases).`);
  const ga = h1('lobi', 'goal_attempt'), on = h1('lobi', 'shot_on');
  pts.push(ga ? `${ga} goal attempt${ga === 1 ? '' : 's'}, ${on} on target${ga ? ` (${Math.round((on / ga) * 100)}%)` : ''}. They had ${h1('opponent', 'goal_attempt')}, ${h1('opponent', 'shot_on')} on target.` : `No goal attempts yet: they had ${h1('opponent', 'goal_attempt')}.`);
  const blocks = (d.cols.find((x: any) => x.period === '1H')?.blocks || []) as string[];
  const peak = (s: string, k: string) => blocks.map(b => ({ b, v: Number(d.grid[s]?.[k]?.['1H']?.[b] || 0) })).sort((x, y) => y.v - x.v)[0];
  const ourPeak = peak('lobi', 'dangerous_attack'), theirPeak = peak('opponent', 'dangerous_attack');
  if (ourPeak?.v) pts.push(`Our most dangerous spell: up to minute ${esc(ourPeak.b)} (${ourPeak.v} dangerous attack${ourPeak.v === 1 ? '' : 's'}).`);
  if (theirPeak?.v) pts.push(`Their most dangerous spell: up to minute ${esc(theirPeak.b)} (${theirPeak.v}).`);
  const fo = h1('lobi', 'foul'), cards = h1('lobi', 'cards');
  if (fo || cards) pts.push(`Discipline: ${fo} foul${fo === 1 ? '' : 's'}, ${cards} card${cards === 1 ? '' : 's'}.`);
  const key = d.events.filter((e: any) => !e.deleted && e.period === '1H' && ['goal', 'yellow_card', 'red_card', 'substitution', 'injury'].includes(e.type)).sort((a: any, b: any) => a.minute - b.minute);
  const LAB: Record<string, string> = { goal: '⚽ Goal', yellow_card: '🟨 Yellow', red_card: '🟥 Red', substitution: '🔁 Sub', injury: '✚ Injury' };
  // Momentum (1st half only)
  const a1 = blocks.map(b => Number(d.grid.lobi.offence_attack['1H'][b] || 0)), f1 = blocks.map(b => Number(d.grid.opponent?.offence_attack?.['1H']?.[b] || 0));
  const mx = Math.max(1, ...a1, ...f1), Wd = 600, Hd = 80, st = Wd / Math.max(1, blocks.length - 1);
  const line = (v: number[]) => v.map((x, i) => `${(i * st).toFixed(1)},${(Hd - (x / mx) * (Hd - 6) - 3).toFixed(1)}`).join(' ');
  const text = [`Lobi Stars half-time: ${m.home} ${htH}–${htA} ${m.away}`, ...pts.map(p => `• ${p}`), d.analysis.half1Note ? `Note: ${d.analysis.half1Note}` : ''].filter(Boolean).join('\n');
  c.view().innerHTML = `<div class="sx-row sx-noprint" style="justify-content:space-between;margin-bottom:10px"><a class="sx-btn" href="/staff/statistics-center/bst-analysis/${esc(id)}/">← Back to the form</a>
      <div class="sx-row"><button class="sx-btn sx-btn--p" type="button" data-htprint>Print / Save as PDF</button><a class="sx-btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">Send on WhatsApp</a><button class="sx-btn" type="button" data-htcopy>Copy text</button></div></div>
    <section class="sx-card ht-sheet"><p class="sx-h2pre">Half-time sheet</p><h2 style="margin:0 0 6px">${fx(m.home, m.away, `${htH}–${htA}`)}</h2>
      <p class="sx-small">${esc(m.competition)} · ${esc(c.day(m.date))} · first half only · made ${esc(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }))}</p>
      <h3>Talking points</h3><ul class="ht-pts">${pts.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
      ${key.length ? `<h3>Key moments</h3><ul class="ht-pts">${key.map((e: any) => `<li><b>${e.minute}'${e.stoppage ? `+${e.stoppage}` : ''}</b> ${LAB[e.type] || esc(e.type)} · ${esc(e.side === sideOf('lobi') ? name('lobi') : name('opponent'))}${e.name ? ` · ${esc(e.name)}` : ''}${e.type === 'substitution' && e.relatedName ? ` → ${esc(e.relatedName)}` : ''}</li>`).join('')}</ul>` : ''}
      <h3>First-half numbers</h3><div class="sx-scroll"><table class="sx-t"><thead><tr><th>Measure</th><th class="n">${esc(name('lobi'))}</th><th class="n">${esc(name('opponent'))}</th></tr></thead><tbody>
        ${rows.map((mt: any) => { const a = Number(val(mt, 'lobi')), b = Number(val(mt, 'opponent')); return `<tr><td>${esc(mt.label)}</td><td class="n${a > b ? ' ht-up' : ''}">${val(mt, 'lobi')}</td><td class="n${b > a ? ' ht-up' : ''}">${val(mt, 'opponent')}</td></tr>`; }).join('')}</tbody></table></div>
      <h3>Who had the ball going forward (every 2 minutes)</h3><svg viewBox="0 0 ${Wd} ${Hd}" preserveAspectRatio="none" width="100%" height="${Hd}" role="img" aria-label="First-half attacks, both teams"><polyline points="${line(a1)}" fill="none" stroke="#C8102E" stroke-width="2.5" vector-effect="non-scaling-stroke"/><polyline points="${line(f1)}" fill="none" stroke="#1C3F7A" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>
      <p class="sx-small"><span style="color:#C8102E">━</span> ${esc(name('lobi'))} attacks &nbsp; <span style="color:#1C3F7A">━</span> ${esc(name('opponent'))} attacks</p>
      ${d.analysis.half1Note ? `<h3>Analyst's note</h3><p style="white-space:pre-wrap">${esc(d.analysis.half1Note)}</p>` : ''}</section>`;
  c.view().querySelector('[data-htprint]')?.addEventListener('click', () => window.print());
  c.view().querySelector('[data-htcopy]')?.addEventListener('click', () => navigator.clipboard?.writeText(text).then(() => c.toast('Copied.')));
}
