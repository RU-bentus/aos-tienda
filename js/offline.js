/* ==========================================================================
   AOS · MODO OFFLINE (PWA)
     - Service Worker (sw.js) para el "cascarón" de la web, fuentes e imágenes.
     - Copia del catálogo en IndexedDB (con respaldo en localStorage): se puede explorar y
       armar el carrito sin conexión. Estrategia "stale-while-revalidate".
     - Cola de pedidos sin conexión: se guardan en el dispositivo y se envían solos a la
       hoja (BD2) al detectar el evento 'online'. Cada pedido lleva un requestId: si el
       servidor ya lo había recibido, devuelve el MISMO pedido (nunca duplica).

   NOTA SOBRE "Service Worker por Blob": los navegadores RECHAZAN registrar un Service Worker
   desde una URL blob: o data: (se probó: "The URL protocol of the script is not supported").
   Por eso el Service Worker es el archivo real `sw.js`, que viaja junto al index.html.
   ========================================================================== */
import { APP } from './config.js';
import { api } from './api.js';
import { IDB, OrderQueue } from './storage.js';
import { bus, applyOrderStock } from './store.js';

/* ------------------------------ Service Worker ------------------------------ */
export async function registerSW() {
  if (!('serviceWorker' in navigator) || !APP.SERVICE_WORKER) return null;
  if (location.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return null;
  try {
    return await navigator.serviceWorker.register(APP.SERVICE_WORKER, { scope: './' });
  } catch (e) {
    console.warn('[AOS] No se pudo registrar el Service Worker:', e && e.message);
    return null;
  }
}

/* ------------------------------ copia del catálogo ------------------------------ */
export const CatalogCache = {
  async read() {
    const v = await IDB.get('kv', 'catalog');
    return v && v.data && v.data.ok ? v : null;
  },
  async write(data) { return IDB.set('kv', 'catalog', { at: Date.now(), data }); },
};

/* --------------------------------- cola de pedidos --------------------------------- */
let flushing = false;

/** ¿Sirve reintentar? (red caída / servidor ocupado) */
export const isTransient = (e) => !!(e && (e.transient || e.kind === 'network' || e.kind === 'timeout'));

export async function pendingOrders() {
  const all = await OrderQueue.merged();
  return all.filter((e) => e.status !== 'failed');
}

/** Envía los pedidos guardados. Se detiene al primer fallo de red y reintenta más tarde. */
export async function flushQueue() {
  if (flushing || navigator.onLine === false) return { sent: 0 };
  flushing = true;
  let sent = 0;
  try {
    const list = await pendingOrders();
    for (const entry of list) {
      try {
        const res = await api.order(Object.assign({}, entry.payload, { origen: 'offline' }));
        await OrderQueue.remove(entry.requestId);
        applyOrderStock(res.items);
        sent++;
        bus.emit('queue:synced', { entry, res });
      } catch (e) {
        if (isTransient(e)) break;                       // sin red o servidor ocupado: se reintenta luego
        // rechazo definitivo (p. ej. se agotó): no se reintenta; queda marcado para revisión
        entry.status = 'failed'; entry.error = String(e && e.message || e);
        await OrderQueue.put(entry);
        bus.emit('queue:failed', { entry, error: entry.error });
      }
    }
  } finally { flushing = false; }
  bus.emit('queue:changed', { n: (await pendingOrders()).length });
  return { sent };
}

/* ---------------------------- conexión (online / offline) ---------------------------- */
export function initNet(handlers) {
  handlers = handlers || {};
  let timer = 0;
  const update = () => { if (handlers.onChange) handlers.onChange(navigator.onLine !== false); };
  window.addEventListener('online', () => {
    update();
    flushQueue().then((r) => { if (handlers.onSynced) handlers.onSynced(r); });
    if (handlers.onOnline) handlers.onOnline();
  });
  window.addEventListener('offline', update);
  // reintento periódico por si el evento 'online' no llegó (algunos navegadores móviles)
  timer = setInterval(() => { if (navigator.onLine !== false) flushQueue(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine !== false) flushQueue(); });
  update();
  return () => clearInterval(timer);
}

