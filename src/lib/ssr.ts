// Data embedded in the page by the server (functions/api/_lib/ssr.js), so
// scripts can render straight away without fetching it again.
export function ssrData<T = any>(id: string): T | null {
  const el = document.getElementById(id);
  if (!el?.textContent) return null;
  try { return JSON.parse(el.textContent) as T; } catch { return null; }
}
