// Every Statistics Center page fits the screen it is on (owner's request, 27 Nov 2026): nothing is cut off.
// Each table is measured against the space it has; if it is wider than the screen it becomes one block per row,
// each value with its column name beside it ("sx-t--stack"). Checked again whenever the page changes or the screen
// turns. The BST data grid stays a grid (it is a wide sheet by design) and shows a "swipe" hint instead.
let queued = false;
function labelRows(t: HTMLTableElement) {
  const head = t.tHead?.rows[0];
  if (!head) return;
  const names: string[] = [];
  for (const th of Array.from(head.cells)) for (let i = 0; i < (th.colSpan || 1); i++) names.push((th.textContent || '').trim());
  for (const body of Array.from(t.tBodies)) for (const tr of Array.from(body.rows)) {
    if (tr.parentElement !== body) continue;
    let col = 0;
    for (const td of Array.from(tr.cells)) { const n = names[col]; if (n && !td.hasAttribute('data-label')) td.setAttribute('data-label', n); col += td.colSpan || 1; }
  }
}
export function fitTables(root: ParentNode = document) {
  for (const t of Array.from(root.querySelectorAll('table.sx-t:not(.sx-t--cards)')) as HTMLTableElement[]) {
    if (t.parentElement?.closest('table.sx-t--stack')) continue; // a table inside a stacked row
    labelRows(t);
    t.classList.remove('sx-t--stack');
    const box = (t.closest('.sx-scroll, .sx-card') as HTMLElement | null) || t.parentElement;
    if (box && t.scrollWidth > box.clientWidth + 2) t.classList.add('sx-t--stack');
  }
  for (const g of Array.from(root.querySelectorAll('table.bst-grid')) as HTMLElement[]) {
    const box = g.parentElement as HTMLElement | null;
    if (!box) continue;
    const wide = g.scrollWidth > box.clientWidth + 2;
    let hint = box.previousElementSibling as HTMLElement | null;
    if (wide && !(hint && hint.classList.contains('sx-swipe'))) { hint = document.createElement('p'); hint.className = 'sx-swipe'; hint.textContent = 'Swipe the grid sideways to see every column →'; box.before(hint); }
    if (!wide && hint?.classList.contains('sx-swipe')) hint.remove();
  }
}
const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fitTables(); }); };
/** Called once: watches the page for new content and the screen for size changes. */
export function setupFit() {
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  try { new ResizeObserver(schedule).observe(document.getElementById('sx') || document.body); } catch { /* older browsers: resize events */ }
  try { (document as any).fonts?.ready?.then(schedule); } catch { /* no font API */ }
  schedule();
}
