// The fan's rating of a delivered order: food, speed and service, one tap each, and an optional
// comment. Drawn into a box the page provides. Colours come from the box's own text colour.
const FIELDS: [string, string][] = [['food', 'Food'], ['speed', 'Speed'], ['service', 'Service']];

export function mountRating(box: HTMLElement, o: { ref: string; token: string }) {
  const picked: Record<string, number> = {};
  box.hidden = false;
  box.innerHTML = `<b style="display:block;margin-bottom:8px">How was your order?</b>
    ${FIELDS.map(([k, label]) => `<div role="group" aria-label="${label}" style="display:flex;align-items:center;gap:4px;margin-bottom:6px"><span style="min-width:70px">${label}</span>${[1, 2, 3, 4, 5].map(n => `<button type="button" data-k="${k}" data-v="${n}" aria-label="${label}: ${n} out of 5" aria-pressed="false" style="width:44px;height:44px;border:0;background:none;color:inherit;font-size:26px;line-height:1;cursor:pointer;opacity:.45">★</button>`).join('')}</div>`).join('')}
    <label style="display:block;margin:8px 0 4px" for="rateNote">Anything to add? (optional)</label>
    <input id="rateNote" maxlength="500" style="width:100%;box-sizing:border-box;min-height:44px;padding:8px;border-radius:8px;border:1px solid currentColor;background:transparent;color:inherit;font:inherit" />
    <button type="button" id="rateSend" style="margin-top:10px;min-height:44px;padding:0 18px;border:1px solid currentColor;border-radius:8px;background:none;color:inherit;font:inherit;font-weight:700;cursor:pointer">Send rating</button>
    <p id="rateMsg" role="status" style="margin:8px 0 0" hidden></p>`;
  const msg = box.querySelector('#rateMsg') as HTMLElement;
  // Leaving the comment box can bring the cookie banner back over the button mid-tap, so the tap is lost.
  box.addEventListener('mousedown', e => { if ((e.target as HTMLElement).id === 'rateSend') e.preventDefault(); });
  box.addEventListener('click', async e => {
    const star = (e.target as HTMLElement).closest('[data-k]') as HTMLButtonElement | null;
    if (star) {
      const k = star.dataset.k!, v = Number(star.dataset.v);
      picked[k] = v;
      box.querySelectorAll<HTMLButtonElement>(`[data-k="${k}"]`).forEach(b => { const on = Number(b.dataset.v) <= v; b.style.opacity = on ? '1' : '.45'; b.setAttribute('aria-pressed', String(Number(b.dataset.v) === v)); });
      return;
    }
    if ((e.target as HTMLElement).id !== 'rateSend') return;
    if (FIELDS.some(([k]) => !picked[k])) { msg.textContent = 'Please tap a score for the food, the speed and the service.'; msg.hidden = false; return; }
    const btn = e.target as HTMLButtonElement; btn.disabled = true;
    try {
      const r = await fetch('/api/food/rating', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: o.ref, t: o.token, ...picked, comment: (box.querySelector('#rateNote') as HTMLInputElement).value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'That did not send. Please try again.');
      box.innerHTML = '<b>Thank you for your rating.</b>';
    } catch (err) { msg.textContent = (err as Error).message; msg.hidden = false; btn.disabled = false; }
  });
}
