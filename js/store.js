/* ==========================================================================
   AOS · ESTADO (store). Sin DOM ni red: solo datos, reglas del carrito y persistencia.

   Las vistas se suscriben al bus (`bus.on('cart', …)`); nada aquí toca la pantalla.
   Eventos:  catalog · cart({ids}) · favs({id,on}) · cmp({ids}) · coupon · ship · stock({ids})
   ========================================================================== */
import { DEFAULTS } from './defaults.js';
import { LS } from './storage.js';
import { createBus, clamp, round2, uid, fmt, fold, normUrl } from './util.js';

export const bus = createBus();

export const SHIP_KEYS = ['pickup', 'departamental', 'casillero', 'delivery'];

export const S = {
  cfg: Object.assign({}, DEFAULTS),
  cats: [],            // categorías (secciones del canvas)
  products: [],
  byId: new Map(),
  order: [],           // ids en el orden del catálogo (sin CONTACTO)
  cart: new Map(),     // id → cantidad
  favs: new Set(),
  compare: [],         // hasta 4 ids
  coupon: null,        // {code,tipo,valor,compraMinima}
  ship: { type: 'pickup', destino: '', nombre: '', celular: '', transportadora: '' },
  clientId: '',
  reqId: null,         // requestId del pedido en curso (idempotencia); se renueva si cambia el carrito
  demo: false,
  rev: '',
  lastOrder: null,
};

/* ------------------------------ textos y números ------------------------------ */
/** Texto de la hoja `Configuracion` (con respaldo de fábrica): t('texto_boton_comprar'), t('texto_escasez', {n:2}) */
export function t(key, vars) {
  let v = S.cfg[key];
  if (v === undefined || v === null || v === '') v = DEFAULTS[key] === undefined ? '' : DEFAULTS[key];
  return fmt(String(v), vars);
}
export function cfgNum(key, def) {
  const n = Number(S.cfg[key]);
  return isFinite(n) && S.cfg[key] !== '' && S.cfg[key] !== null ? n : def;
}
export const maxQty = () => Math.max(1, Math.floor(cfgNum('max_cantidad_por_producto', 10)));

/** "Bs 289" / "Bs 289.50" — igual que el servidor (moneyWith_). */
export function money(n) {
  n = Number(n) || 0;
  const whole = Math.round(n * 100) % 100 === 0;
  return (S.cfg.moneda || 'Bs') + ' ' + (whole ? String(Math.round(n)) : n.toFixed(2));
}

/* --------------------------------- productos --------------------------------- */
export const prod = (id) => S.byId.get(id);
export function cover(p) {
  if (!p) return '';
  for (let i = 0; i < p.media.length; i++) {
    const m = p.media[i];
    if (m.tipo === 'imagen' && m.url) return m.url;
    if (m.poster) return m.poster;
  }
  return '';
}
export const catName = (id) => { const c = S.cats.find((x) => x.id === id); return c ? c.nombre : id; };
export const isOut = (p) => !p || p.stock <= 0;
/** Escasez: queda poco pero no cero. Umbral por producto (Alerta_Bajo) o el global `umbral_escasez`. */
export const isScarce = (p) => !!p && p.stock > 0 && p.stock <= (p.alerta > 0 ? p.alerta : cfgNum('umbral_escasez', 2));
export const maxFor = (p) => (p ? Math.min(p.stock, maxQty()) : 0);
export const discountPct = (p) => (p.precioAnt > p.precio ? Math.round((1 - p.precio / p.precioAnt) * 100) : 0);

/** Texto del micro-banner de escasez. */
export function scarceText(p) {
  return p.stock === 1 ? t('texto_escasez_una') : t('texto_escasez', { n: p.stock });
}

function normProduct(p) {
  p.media = (p.media || []).map((m) => Object.assign({}, m, { url: normUrl(m.url, m.tipo), poster: normUrl(m.poster, 'imagen') }));
  p.stock = Math.max(0, Number(p.stock) || 0);
  p.precio = Number(p.precio) || 0;
  p.precioAnt = Number(p.precioAnt) || 0;
  p.alerta = Number(p.alerta) || 0;
  p.favs = Number(p.favs) || 0;
  p.sold7 = Number(p.sold7) || 0;
  p.desc = p.desc || '';
  p.etiqueta = p.etiqueta || '';
  // índice de búsqueda: minúsculas sin tildes (se usa con .filter() + .includes())
  p._q = fold([p.nombre, p.desc, p.cat, p.etiqueta, p.id].join(' '));
  return p;
}

/** Instala el catálogo completo (respuesta de doGet). */
export function setCatalog(res) { installCatalog(res, true); }

/** ¿Cambió la estructura (productos/categorías/posiciones)? Útil para decidir si se reconstruye el canvas. */
export function structureKey(res) {
  const ps = (res.products || []).map((p) => [p.id, p.x, p.y, p.w, p.cat, (p.media || []).map((m) => m.url).join('|')].join(':'));
  const cs = (res.categories || []).map((c) => [c.id, c.cx, c.cy, c.tipo, c.nombre].join(':'));
  return ps.join(',') + '#' + cs.join(',');
}

/** Actualización suave (revalidación): conserva el estado y avisa qué cambió. */
export function patchCatalog(res) {
  const same = structureKey(res) === structureKey({ products: S.products, categories: S.cats });
  const oldCfg = JSON.stringify(S.cfg);
  installCatalog(res, false);
  return { structural: !same, configChanged: oldCfg !== JSON.stringify(S.cfg) };
}
function installCatalog(res, fresh) {
  S.cfg = Object.assign({}, DEFAULTS, res.config || {});
  S.cats = (res.categories || []).slice();
  const prev = S.byId;
  S.products = (res.products || []).map(normProduct);
  S.byId = new Map(S.products.map((p) => [p.id, p]));
  S.rev = res.rev || '';
  S.order = [];
  S.cats.filter((c) => c.tipo !== 'contacto').forEach((c) => {
    S.products.filter((p) => p.cat === c.id).sort((a, b) => a.orden - b.orden).forEach((p) => S.order.push(p.id));
  });
  S.products.forEach((p) => { if (S.order.indexOf(p.id) < 0) S.order.push(p.id); });
  reconcile();
  if (fresh) { bus.emit('catalog', { fresh: true, changed: [] }); return; }
  const changed = S.products.filter((p) => {
    const o = prev.get(p.id);
    return !o || o.stock !== p.stock || o.precio !== p.precio || o.precioAnt !== p.precioAnt || o.nombre !== p.nombre || o.etiqueta !== p.etiqueta;
  }).map((p) => p.id);
  bus.emit('catalog', { fresh: false, changed });
}

/** Quita del carrito / favoritos / comparador lo que ya no existe o se agotó, y recorta cantidades. */
function reconcile() {
  let cartChanged = false;
  S.cart.forEach((q, id) => {
    const p = prod(id);
    if (!p || p.stock <= 0) { S.cart.delete(id); cartChanged = true; return; }
    const m = maxFor(p);
    if (q > m) { S.cart.set(id, m); cartChanged = true; }
  });
  Array.from(S.favs).forEach((id) => { if (!prod(id)) S.favs.delete(id); });
  S.compare = S.compare.filter((id) => !!prod(id));
  if (cartChanged) { S.reqId = null; persistCart(); }
}

/* ------------------------------ persistencia local ------------------------------ */
function persistCart() { const o = {}; S.cart.forEach((q, id) => { o[id] = q; }); LS.set('cart', o); }

/** Lee del dispositivo: id de cliente, carrito, favoritos y envío. Se llama ANTES del catálogo. */
export function loadLocal() {
  S.clientId = LS.get('cid', '') || ('c_' + uid().replace(/-/g, ''));
  LS.set('cid', S.clientId);
  const cart = LS.get('cart', {}) || {};
  Object.keys(cart).forEach((id) => { const q = Math.floor(Number(cart[id])); if (q >= 1) S.cart.set(id, q); });
  (LS.get('favs', []) || []).forEach((id) => S.favs.add(String(id)));
  const sh = LS.get('ship', null);
  if (sh && SHIP_KEYS.indexOf(sh.type) >= 0) S.ship = Object.assign(S.ship, sh);
}
/** Cuando el catálogo ya está, valida lo guardado (productos agotados o eliminados). */
export function afterCatalog() { reconcile(); }

/* ------------------------------------ carrito ------------------------------------ */
export function totals() {
  let sub = 0, count = 0;
  S.cart.forEach((q, id) => { const p = prod(id); if (p) { sub += p.precio * q; count += q; } });
  sub = round2(sub);
  let disc = 0;
  const c = S.coupon;
  if (c && !(c.compraMinima && sub < c.compraMinima)) {
    disc = c.tipo === 'PORCENTAJE' ? round2(sub * c.valor / 100) : Math.min(c.valor, sub);
  }
  return { sub, disc, total: round2(Math.max(0, sub - disc)), count, lines: S.cart.size };
}

function cartChanged(ids) {
  S.reqId = null;                                   // otro carrito = otro pedido (nuevo requestId)
  persistCart();
  let couponDropped = false;
  if (S.coupon && S.coupon.compraMinima && totals().sub < S.coupon.compraMinima) { S.coupon = null; couponDropped = true; }
  bus.emit('cart', { ids: ids || [], couponDropped });
}

/** @returns {{ok:true}|{ok:false,reason:'missing'|'soldout'|'nostock'|'max',max?:number}} */
export function cartAdd(id, qty) {
  qty = qty || 1;
  const p = prod(id);
  if (!p) return { ok: false, reason: 'missing' };
  if (isOut(p)) return { ok: false, reason: 'soldout' };
  const cur = S.cart.get(id) || 0, max = maxFor(p);
  if (cur >= max) return { ok: false, reason: cur >= p.stock ? 'nostock' : 'max', max };
  S.cart.set(id, Math.min(max, cur + qty));
  cartChanged([id]);
  return { ok: true };
}
export function cartSet(id, n) {
  const p = prod(id); if (!p) return;
  n = clamp(Math.floor(n), 0, maxFor(p));
  if (n <= 0) { cartRemove(id); return; }
  S.cart.set(id, n); cartChanged([id]);
}
export function cartRemove(id) { if (S.cart.delete(id)) cartChanged([id]); }
export function cartClear() { const ids = Array.from(S.cart.keys()); S.cart.clear(); cartChanged(ids); }

export function setCoupon(c) { S.coupon = c || null; S.reqId = null; bus.emit('coupon', { coupon: S.coupon }); }

/* ------------------------------- favoritos / comparar ------------------------------- */
export function toggleFav(id) {
  const on = !S.favs.has(id);
  if (on) S.favs.add(id); else S.favs.delete(id);
  LS.set('favs', Array.from(S.favs));
  bus.emit('favs', { id, on });
  return on;
}
export const CMP_MAX = 4;
/** @returns {{on:boolean, full?:boolean}} */
export function toggleCmp(id) {
  const i = S.compare.indexOf(id);
  if (i >= 0) { S.compare.splice(i, 1); bus.emit('cmp', { ids: [id] }); return { on: false }; }
  if (S.compare.length >= CMP_MAX) return { on: false, full: true };
  S.compare.push(id);
  bus.emit('cmp', { ids: [id] });
  return { on: true };
}
export function clearCmp() { const old = S.compare.slice(); S.compare = []; bus.emit('cmp', { ids: old }); }

/* ------------------------------------- envío ------------------------------------- */
export function setShipType(k) {
  if (SHIP_KEYS.indexOf(k) < 0) return;
  S.ship.type = k; S.reqId = null;
  LS.set('ship', S.ship);
  bus.emit('ship', { type: k });
}
export function setShipField(k, v) {
  if (!(k in S.ship) || k === 'type') return;
  S.ship[k] = String(v).slice(0, 120); S.reqId = null;
  LS.set('ship', S.ship);
}
/** Datos de envío que viajan en el pedido. Nada es obligatorio; solo "departamental" lleva campos. */
export function shipPayload() {
  const o = { type: S.ship.type };
  if (S.ship.type === 'departamental') {
    ['destino', 'nombre', 'celular', 'transportadora'].forEach((k) => { o[k] = String(S.ship[k] || '').trim(); });
  }
  return o;
}
export const shipLabel = (k) => t('envio_' + k + '_titulo');
export function shipDetail() {
  if (S.ship.type !== 'departamental') return '';
  const p = shipPayload(), parts = [];
  if (p.destino) parts.push(t('label_envio_destino') + ': ' + p.destino);
  if (p.nombre) parts.push(t('label_envio_nombre') + ': ' + p.nombre);
  if (p.celular) parts.push(t('label_envio_telefono') + ': ' + p.celular);
  if (p.transportadora) parts.push(t('label_envio_transportadora') + ': ' + p.transportadora);
  return parts.join(' · ');
}

/** Refleja en el catálogo local el stock que descontó el servidor. */
export function applyOrderStock(items) {
  const ids = [];
  (items || []).forEach((it) => {
    const p = prod(it.id);
    if (p) { p.stock = Math.max(0, p.stock - it.qty); ids.push(p.id); }
  });
  if (ids.length) bus.emit('stock', { ids });
}

/** Referencia de pedido en curso (idempotencia). */
export function requestId() { return S.reqId || (S.reqId = 'r' + uid().replace(/-/g, '')); }
