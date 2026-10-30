/* ==========================================================================
   AOS · VISTA "DOCK": barra de botones dinámicos animados con productos sugeridos.
   El producto agregado viaja al final y el siguiente sugerido pasa al frente (FLIP).
   ========================================================================== */
import { S, bus, t, money, cover, prod, isOut } from '../store.js';
import { $, $$, esc, ic, flip } from '../util.js';

let track;
const els = new Map();
let suggested = null;
export let dockOrder = [];

function chip(p) {
  const el = document.createElement('div');
  el.className = 'chip'; el.dataset.id = p.id;
  el.dataset.sug = t('texto_sugerido');
  el.innerHTML =
    '<img src="' + esc(cover(p)) + '" alt="' + esc(p.nombre) + '" data-open-product="' + esc(p.id) + '" draggable="false" decoding="async">' +
    '<div class="chip__t"><b>' + esc(p.nombre) + '</b><span>' + money(p.precio) + '</span></div>' +
    '<div class="chip__b"><button type="button" class="act" data-fav="' + esc(p.id) + '" aria-label="' + esc(t('texto_favoritos')) + '">' + ic('heart') + '</button>' +
    '<button type="button" class="act" data-add="' + esc(p.id) + '" aria-label="' + esc(t('texto_boton_comprar')) + '">' + ic('plus') + '</button></div>';
  if (isOut(p)) { el.classList.add('is-soldout'); $('[data-add]', el).disabled = true; }
  return el;
}

export function build() {
  track = track || $('#dockTrack');
  const inStock = S.order.filter((id) => !isOut(prod(id)));
  const out = S.order.filter((id) => isOut(prod(id)));
  dockOrder = inStock.concat(out);
  els.clear();
  track.innerHTML = '';
  dockOrder.forEach((id) => { const el = chip(prod(id)); els.set(id, el); track.appendChild(el); sync(id); });
  setSuggested(null);
}

export function sync(id) {
  const el = els.get(id);
  if (!el) return;
  el.classList.toggle('in-cart', S.cart.has(id));
  $('[data-fav]', el).classList.toggle('is-on', S.favs.has(id));
}

function update(p) {
  const el = els.get(p.id);
  if (!el) return;
  el.classList.toggle('is-soldout', isOut(p));
  const b = $('[data-add]', el); if (b) b.disabled = isOut(p);
  $('.chip__t span', el).textContent = money(p.precio);
}

function setSuggested(id) {
  suggested = id;
  els.forEach((el, k) => el.classList.toggle('is-suggested', k === id));
}

/** Siguiente producto sugerido: misma sección primero, con stock y fuera de la lista. */
export function suggestNext(addedId) {
  const added = prod(addedId);
  const cands = dockOrder.filter((id) => { const p = prod(id); return id !== addedId && p && !isOut(p) && !S.cart.has(id); });
  const same = cands.filter((id) => added && prod(id).cat === added.cat);
  return same[0] || cands[0] || null;
}

/** Reordena el dock tras agregar un producto. Devuelve el id sugerido (o null). */
export function afterAdd(id) {
  const sug = suggestNext(id), el = els.get(id), sel = sug ? els.get(sug) : null;
  if (!el) return sug;
  track.scrollLeft = 0;
  flip(track, () => {
    track.appendChild(el);                                    // el producto tocado viaja al final
    if (sel) track.insertBefore(sel, track.firstChild);       // el siguiente sugerido pasa al frente
    track.scrollLeft = 0;                                     // el navegador re-ancla el scroll al mover nodos
  }, 650, el);
  dockOrder = $$(':scope > .chip', track).map((c) => c.dataset.id);
  setSuggested(sug);
  return sug;
}

export function initDock() {
  track = $('#dockTrack');
  bus.on('cart', (e) => (e.ids || []).forEach(sync));
  bus.on('favs', (e) => (e.bulk || [e.id]).forEach(sync));
  bus.on('stock', (e) => (e.ids || []).forEach((id) => { const p = prod(id); if (p) update(p); }));
}
export function refreshChip(p) { update(p); }
