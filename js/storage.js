/* ==========================================================================
   AOS · Almacenamiento local
   - LS  : localStorage (carrito, favoritos, envío, id de cliente)
   - IDB : IndexedDB    (copia del catálogo y COLA DE PEDIDOS sin conexión)
   Si el navegador bloquea el almacenamiento (modo privado, etc.) todo sigue
   funcionando en memoria, solo que sin persistencia.
   ========================================================================== */
import { APP } from './config.js';

const P = APP.STORAGE_PREFIX;
const mem = new Map();

export const LS = {
  get(k, d) {
    try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); }
    catch (e) { return mem.has(k) ? mem.get(k) : d; }
  },
  set(k, v) {
    mem.set(k, v);
    try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ }
  },
  del(k) { mem.delete(k); try { localStorage.removeItem(P + k); } catch (e) { /* noop */ } },
};

/* ------------------------------ IndexedDB ------------------------------ */
const DB_NAME = 'aos-store';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('sin IndexedDB')); return; }
    const rq = indexedDB.open(DB_NAME, DB_VER);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'requestId' });
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
    rq.onblocked = () => reject(new Error('IndexedDB bloqueada'));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const st = t.objectStore(store);
    let out;
    const rq = fn(st);
    if (rq) rq.onsuccess = () => { out = rq.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const IDB = {
  /** Lee una clave; si IndexedDB no está disponible cae a localStorage. */
  async get(store, key) {
    try { const v = await tx(store, 'readonly', (s) => s.get(key)); return v === undefined ? null : v; }
    catch (e) { return LS.get('idb.' + store + '.' + key, null); }
  },
  async set(store, key, value) {
    try { await tx(store, 'readwrite', (s) => (store === 'queue' ? s.put(value) : s.put(value, key))); return true; }
    catch (e) {
      try { LS.set('idb.' + store + '.' + key, value); return true; } catch (e2) { return false; }
    }
  },
  async del(store, key) {
    try { await tx(store, 'readwrite', (s) => s.delete(key)); } catch (e) { LS.del('idb.' + store + '.' + key); }
  },
  async all(store) {
    try { return (await tx(store, 'readonly', (s) => s.getAll())) || []; }
    catch (e) { return LS.get('idb.' + store + '.__all', []); }
  },
};

/** Cola de pedidos (respaldo en localStorage si IndexedDB no existe). */
export const OrderQueue = {
  async list() {
    const rows = await IDB.all('queue');
    return rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  },
  async put(entry) {
    const ok = await IDB.set('queue', entry.requestId, entry);
    // respaldo paralelo: si IndexedDB falla, el pedido sigue vivo en localStorage
    const bak = LS.get('idb.queue.__all', []).filter((e) => e.requestId !== entry.requestId);
    bak.push(entry); LS.set('idb.queue.__all', bak);
    return ok;
  },
  async remove(requestId) {
    await IDB.del('queue', requestId);
    LS.set('idb.queue.__all', LS.get('idb.queue.__all', []).filter((e) => e.requestId !== requestId));
  },
  async merged() {
    const a = await this.list();
    const seen = new Set(a.map((e) => e.requestId));
    LS.get('idb.queue.__all', []).forEach((e) => { if (!seen.has(e.requestId)) a.push(e); });
    return a.sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
  },
};
