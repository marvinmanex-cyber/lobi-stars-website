// Squad & Staff Data Portal: offline protection. Every answer is written to this
// device straight away (IndexedDB) and then sent to the server. If the network
// or the server fails, the changes wait here and are sent automatically, in
// order, when the connection returns. A copy of each profile is also kept here,
// so the form reopens with everything even if the page is reloaded offline.
const DB_NAME = 'lobi-squad-portal', VERSION = 1;
let dbp: Promise<IDBDatabase> | null = null;
function db() {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'n', autoIncrement: true });
      if (!d.objectStoreNames.contains('profiles')) d.createObjectStore('profiles', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('uploads')) d.createObjectStore('uploads', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      const req = fn(s);
      t.oncomplete = () => resolve(req ? (req as IDBRequest<T>).result : undefined);
      t.onerror = () => reject(t.error);
    });
  } catch { return undefined; } // private window / storage blocked: the server is still used
}

export type Change = { n?: number; id: string; changes: Record<string, unknown>; commit: boolean; type?: string; at: number };
export const queueAdd = (c: Change) => tx('queue', 'readwrite', s => s.add(c));
export async function queueAll(): Promise<Change[]> { return (await tx<Change[]>('queue', 'readonly', s => s.getAll())) || []; }
export const queueDelete = (n: number) => tx('queue', 'readwrite', s => s.delete(n));
export async function queueCount(): Promise<number> { return (await tx<number>('queue', 'readonly', s => s.count())) || 0; }

export const keepProfile = (p: any) => tx('profiles', 'readwrite', s => s.put({ ...p, keptAt: Date.now() }));
export async function keptProfile(id: string): Promise<any> { return tx('profiles', 'readonly', s => s.get(id)); }

/**
 * Sends waiting changes in order. send(change) resolves when the server saved it;
 * a connection problem stops the run (tried again later); a refusal (e.g. the
 * profile was submitted meanwhile) drops that change and reports it.
 */
let running: Promise<void> | null = null;
export function flush(send: (c: Change) => Promise<'ok' | 'retry' | 'drop'>) {
  if (running) return running;
  running = (async () => {
    try {
      for (const c of await queueAll()) {
        const r = await send(c);
        if (r === 'retry') return;
        await queueDelete(c.n!);
      }
    } finally { running = null; }
  })();
  return running;
}

/** Photos and recordings waiting to be sent (kept as files on this device). */
export type Upload = { key: string; id: string; what: 'photo' | 'audio'; fields: Record<string, Blob | string>; at: number };
export const uploadKeep = (u: Upload) => tx('uploads', 'readwrite', s => s.put(u));
export async function uploadsAll(): Promise<Upload[]> { return (await tx<Upload[]>('uploads', 'readonly', s => s.getAll())) || []; }
export const uploadDone = (key: string) => tx('uploads', 'readwrite', s => s.delete(key));
export async function uploadsCount(): Promise<number> { return (await tx<number>('uploads', 'readonly', s => s.count())) || 0; }
