/* ==========================================================================
   AOS · Capa de API  (solo habla con Google Apps Script; no toca el DOM)

   CORS: Apps Script no permite fijar encabezados a mano. Una Web App publicada para
   "Cualquier persona" que responde con ContentService.MimeType.JSON la sirve Google
   con `Access-Control-Allow-Origin: *`. Para NO disparar el preflight (OPTIONS) —que
   Apps Script no sabe contestar— los POST se envían como `text/plain`: el navegador
   los trata como "petición simple". El cuerpo sigue siendo JSON.
   ========================================================================== */
import { APP } from './config.js';

export class ApiError extends Error {
  /** kind: 'network' (sin internet/CORS) · 'timeout' · 'bad' (no devolvió JSON) · 'server' (fallo transitorio) · 'user' (dato rechazado) */
  constructor(message, kind, extra) { super(message); this.name = 'ApiError'; this.kind = kind; Object.assign(this, extra || {}); }
  /** ¿Vale la pena reintentar más tarde con el mismo requestId? */
  get transient() { return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'bad' || this.kind === 'server'; }
}

const BASE = () => String(APP.API_URL || '').trim();

async function request(method, opt) {
  opt = opt || {};
  const url = new URL(BASE());
  Object.entries(opt.params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opt.timeout || 20000);
  let res;
  try {
    const init = { redirect: 'follow', credentials: 'omit', signal: ctl.signal, cache: 'no-store' };
    if (method === 'POST') {
      init.method = 'POST';
      init.headers = { 'Content-Type': 'text/plain;charset=utf-8' };      // "petición simple": sin preflight
      init.body = JSON.stringify(opt.body || {});
    } else init.method = 'GET';
    res = await fetch(url.toString(), init);
  } catch (e) {
    throw new ApiError(e && e.name === 'AbortError' ? 'La respuesta tardó demasiado.' : 'Sin conexión con el servidor.', e && e.name === 'AbortError' ? 'timeout' : 'network');
  } finally { clearTimeout(timer); }
  let data;
  try { data = await res.json(); }
  catch (e) { throw new ApiError('El servidor no devolvió datos válidos. Revisa que la Web App esté publicada para "Cualquier persona".', 'bad'); }
  return data;
}

function okOrThrow(data) {
  if (data && data.ok) return data;
  throw new ApiError((data && data.error) || 'No se pudo completar la operación.', data && data.retry ? 'server' : 'user');
}

const real = {
  demo: false,
  /** Catálogo completo (config + categorías + productos) en UN solo JSON. */
  async catalog(opt) {
    return okOrThrow(await request('GET', { timeout: (opt && opt.timeout) || APP.CATALOG_TIMEOUT_MS }));
  },
  async coupon(code, subtotal, clientId) {
    return request('GET', { params: { action: 'coupon', code, subtotal, clientId } });
  },
  async getFavorites(clientId) {
    return request('GET', { params: { action: 'favorites', clientId } });
  },
  async favorites(clientId, ids) {
    return request('POST', { body: { action: 'favorites', clientId, ids } });
  },
  async events(clientId, events) {
    return request('POST', { body: { action: 'events', clientId, events } });
  },
  async receipt(orderId, clientId) {
    return request('GET', { params: { action: 'receipt', orderId, clientId }, timeout: 40000 });
  },
  async qr() {
    return request('GET', { params: { action: 'qr' }, timeout: 30000 });
  },
  /** doPost: registra el pedido. Devuelve el resultado o lanza ApiError. */
  async order(payload) {
    return okOrThrow(await request('POST', { body: Object.assign({ action: 'order' }, payload), timeout: 30000 }));
  },
};

/* ---- fachada: el resto de la app solo conoce `api` (real o demo) ---- */
let impl = real;
export const api = new Proxy({}, {
  get(_, k) {
    if (k === 'init') return init;
    if (k === 'demo') return impl.demo;
    return (...a) => impl[k](...a);
  },
});

async function init() {
  if (BASE()) { impl = real; return impl; }
  const m = await import('./demo.js');                  // sin API_URL → modo demo (datos de ejemplo)
  impl = m.demoApi;
  return impl;
}
