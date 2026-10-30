/* ==========================================================================
   AOS · ACCIONES del usuario (agregar, favorito, comparar) y delegación global de clics.
   Une el estado (store.js) con los avisos (toast) y el registro de eventos (remote.js).
   Las vistas no se importan entre sí: se hablan por el bus (`ui:*`).
   ========================================================================== */
import { S, bus, t, money, cover, prod, cartAdd, cartSet, cartRemove, toggleFav, toggleCmp, CMP_MAX, maxFor } from './store.js';
import { toast } from './ui/toast.js';
import { Log } from './remote.js';
import { afterAdd } from './views/dock.js';
import { $, $$, esc, ic, clamp } from './util.js';

let dragGuard = () => false;
export function setDragGuard(fn) { dragGuard = fn; }

export const ui = {
  product: (id) => bus.emit('ui:product', id),
  cart: () => bus.emit('ui:cart'),
  favs: () => bus.emit('ui:favs'),
  compare: () => bus.emit('ui:cmp'),
  pay: () => bus.emit('ui:pay'),
};

function popEl(el) { if (!el) return; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }

/** Agrega al carrito con avisos y el siguiente producto sugerido en el aviso. Devuelve true si se agregó. */
export function addToCart(id, qty, opt) {
  const r = cartAdd(id, qty || 1);
  if (!r.ok) {
    const msg = r.reason === 'soldout' ? t('texto_agotado') : r.reason === 'nostock' ? 'No quedan más unidades disponibles' : r.reason === 'max' ? 'Máximo ' + r.max + ' por producto' : 'Producto no disponible';
    toast(msg, { err: true });
    return false;
  }
  const p = prod(id);
  Log.push('cart_add', id, (opt && opt.src) || '');
  popEl($('#fab'));
  const sug = afterAdd(id), sp = sug ? prod(sug) : null;
  let html = '<span>' + ic('check') + '</span><div class="toast__t"><small>' + esc(t('texto_toast_agregado')) + '</small><b>' + esc(p.nombre) + '</b></div>';
  if (sp) {
    html = '<img src="' + esc(cover(sp)) + '" alt="" data-open-product="' + esc(sp.id) + '">' +
      '<div class="toast__t"><small>' + esc(t('texto_toast_sugerido')) + '</small><b>' + esc(sp.nombre) + ' · ' + money(sp.precio) + '</b></div>' +
      '<button type="button" class="act" data-add="' + esc(sp.id) + '" aria-label="' + esc(t('texto_boton_agregar')) + '">' + ic('plus') + '</button>';
  }
  toast(null, { html, ttl: sp ? 5200 : 2200 });
  return true;
}

export function removeFromCart(id) { cartRemove(id); Log.push('cart_remove', id); }
export function setQty(id, n) { const p = prod(id); if (!p) return; cartSet(id, clamp(n, 0, maxFor(p))); }

export function favToggle(id) {
  const on = toggleFav(id);
  Log.push(on ? 'fav_add' : 'fav_remove', id);
  toast(t(on ? 'texto_toast_fav_on' : 'texto_toast_fav_off'), { ttl: 1800 });
  $$('[data-fav="' + id + '"], [data-act="fav"]').forEach((b) => { if (b.closest('.tile') && b.closest('.tile').dataset.id !== id) return; popEl(b); });
  popEl($('#dockFav'));
  return on;
}

export function cmpToggle(id) {
  const r = toggleCmp(id);
  if (r.full) { toast('Puedes comparar hasta ' + CMP_MAX + ' productos', { err: true }); return; }
  if (r.on) { Log.push('compare', id); toast('⇄ ' + t('texto_comparar') + ' (' + S.compare.length + '/' + CMP_MAX + ')', { ttl: 1800 }); }
}

/** Un solo escuchador de clics para todos los data-* de la tienda. */
export function bindGlobalClicks() {
  document.addEventListener('click', (e) => {
    if (dragGuard()) return;                                   // el clic que sigue a un arrastre no cuenta
    const tg = e.target;
    let el;
    if ((el = tg.closest('[data-open-product]'))) { e.preventDefault(); ui.product(el.dataset.openProduct); return; }
    if ((el = tg.closest('[data-add]'))) {
      if (el.disabled) return;
      e.preventDefault(); addToCart(el.dataset.add, 1);
      const tt = el.closest('.toast'); if (tt && tt._kill) tt._kill();
      return;
    }
    if ((el = tg.closest('[data-fav]'))) { e.preventDefault(); favToggle(el.dataset.fav); return; }
    if ((el = tg.closest('[data-cmp]'))) { e.preventDefault(); cmpToggle(el.dataset.cmp); return; }
    if ((el = tg.closest('[data-qd]'))) { const id = el.dataset.id; setQty(id, (S.cart.get(id) || 0) + Number(el.dataset.qd)); return; }
    if ((el = tg.closest('[data-rm]'))) { removeFromCart(el.dataset.rm); }
  });
}
