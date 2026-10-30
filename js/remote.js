/* ==========================================================================
   AOS · EFECTOS REMOTOS "silenciosos" (registro de eventos y sincronía de favoritos).
   Nunca rompen la tienda: si no hay red, se descartan o se reintentan en el siguiente cambio.
   ========================================================================== */
import { api } from './api.js';
import { S, bus } from './store.js';

export const Log = {
  q: [],
  push(e, p, d) {
    this.q.push({ e, p: p || '', d: d || '' });
    if (this.q.length >= 12) this.flush();
  },
  flush() {
    if (!this.q.length || !S.clientId || api.demo || navigator.onLine === false) return;
    const batch = this.q.splice(0, 40);
    api.events(S.clientId, batch).catch(() => { /* el registro nunca debe romper la tienda */ });
  },
};

let favTimer = 0;
function queueFavs() {
  clearTimeout(favTimer);
  favTimer = setTimeout(() => {
    if (api.demo || navigator.onLine === false) return;
    api.favorites(S.clientId, Array.from(S.favs)).catch(() => { /* se reintenta en el próximo cambio */ });
  }, 1500);
}

/** Une los favoritos del servidor con los locales (no bloquea la carga). Devuelve los ids añadidos. */
export async function mergeServerFavorites() {
  if (api.demo || navigator.onLine === false) return [];
  try {
    const r = await api.getFavorites(S.clientId);
    if (!r || !r.ok || !Array.isArray(r.ids)) return [];
    const added = [];
    r.ids.forEach((id) => { if (S.byId.has(id) && !S.favs.has(id)) { S.favs.add(id); added.push(id); } });
    if (added.length) bus.emit('favs', { id: added[0], on: true, bulk: added });
    return added;
  } catch (e) { return []; }
}

export function initRemote() {
  bus.on('favs', (e) => { if (!e.bulk) queueFavs(); });
  setInterval(() => Log.flush(), 20000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) Log.flush(); });
}
