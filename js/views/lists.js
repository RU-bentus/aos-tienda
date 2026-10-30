/* ==========================================================================
   AOS · VISTAS "LISTAS": Mis favoritos (panel izquierdo) y Comparador (pantalla completa).
   ========================================================================== */
import { S, bus, t, money, cover, prod, catName, isOut, isScarce, scarceText, discountPct, CMP_MAX, clearCmp } from '../store.js';
import { $, esc, ic } from '../util.js';
import { Layers } from '../ui/layers.js';
import { toast } from '../ui/toast.js';

/* ------------------------------------ favoritos ------------------------------------ */
function renderFavs() {
  const ids = Array.from(S.favs).filter((id) => prod(id));
  $('#favsCount').textContent = ids.length ? '(' + ids.length + ')' : '';
  const body = $('#favsBody');
  if (!ids.length) {
    body.innerHTML = '<div class="empty"><h3>' + esc(t('texto_vacio_favoritos_titulo')) + '</h3><p>' + esc(t('texto_vacio_favoritos')) + '</p></div>';
    return;
  }
  body.innerHTML = '<ul class="fav__list">' + ids.map((id) => {
    const p = prod(id), out = isOut(p);
    return '<li><img src="' + esc(cover(p)) + '" alt="' + esc(p.nombre) + '" data-open-product="' + esc(id) + '" decoding="async">' +
      '<div class="row__t"><h4>' + esc(p.nombre) + '</h4><p>' + esc(catName(p.cat)) + '</p><p class="row__sub">' + money(p.precio) + '</p>' +
      (isScarce(p) ? '<p class="row__warn">' + esc(scarceText(p)) + '</p>' : '') + '</div>' +
      '<div class="row__r"><button type="button" class="btn btn--ink" style="padding:10px 12px" data-add="' + esc(id) + '"' + (out ? ' disabled' : '') + '>' +
      (out ? esc(t('texto_agotado')) : ic('plus') + '<span>' + esc(t('texto_boton_agregar')) + '</span>') + '</button>' +
      '<button type="button" class="rm" data-fav="' + esc(id) + '" aria-label="Quitar">' + ic('trash') + '</button></div></li>';
  }).join('') + '</ul>';
}

/* ----------------------------------- comparador ----------------------------------- */
function renderCmp() {
  const grid = $('#cmpGrid'), ids = S.compare.filter((id) => prod(id));
  $('#cmpCount').textContent = ids.length + '/' + CMP_MAX;
  if (!ids.length) { Layers.close('cmp'); return; }
  grid.style.setProperty('--n', ids.length);
  const best = ids.length > 1 ? ids.slice().sort((a, b) => prod(a).precio - prod(b).precio)[0] : null;
  grid.innerHTML = ids.map((id) => {
    const p = prod(id), out = isOut(p), disc = discountPct(p);
    return '<article class="cmp__col' + (id === best ? ' is-best' : '') + '">' +
      '<div class="cmp__img" data-best="' + esc(t('texto_mejor_precio')) + '"><img src="' + esc(cover(p)) + '" alt="' + esc(p.nombre) + '" data-open-product="' + esc(id) + '" decoding="async">' +
      '<button type="button" class="act cmp__rm" data-cmp="' + esc(id) + '" aria-label="Quitar del comparador">' + ic('close') + '</button></div>' +
      '<div class="cmp__body"><p class="eyebrow">' + esc(catName(p.cat)) + '</p><h3>' + esc(p.nombre) + '</h3>' +
      '<div class="cmp__row"><span>Precio</span><b>' + money(p.precio) + '</b></div>' +
      '<div class="cmp__row"><span>Antes</span><b>' + (p.precioAnt > p.precio ? money(p.precioAnt) + ' (−' + disc + '%)' : '—') + '</b></div>' +
      '<div class="cmp__row"><span>Disponible</span><b>' + (out ? esc(t('texto_agotado')) : isScarce(p) ? esc(scarceText(p)) : p.stock + ' u.') + '</b></div>' +
      '<div class="cmp__row"><span>Etiqueta</span><b>' + esc(p.etiqueta || '—') + '</b></div>' +
      '<p class="cmp__desc">' + esc(p.desc) + '</p>' +
      '<button type="button" class="btn btn--ink" data-add="' + esc(id) + '"' + (out ? ' disabled' : '') + '>' +
      (out ? esc(t('texto_agotado')) : ic('bag') + '<span>' + esc(t('texto_boton_comprar')) + '</span>') + '</button></div></article>';
  }).join('');
}

export function initLists() {
  bus.on('ui:favs', () => { renderFavs(); Layers.open('favs'); });
  bus.on('ui:cmp', () => {
    if (!S.compare.length) { toast('Marca productos con ⇄ para compararlos (hasta ' + CMP_MAX + ')'); return; }
    renderCmp(); Layers.open('cmp');
  });
  bus.on('favs', () => { if (Layers.isOpen('favs')) renderFavs(); });
  bus.on('cmp', () => { if (Layers.isOpen('cmp')) renderCmp(); });
  bus.on('stock', () => { if (Layers.isOpen('favs')) renderFavs(); if (Layers.isOpen('cmp')) renderCmp(); });
  bus.on('catalog', () => { if (Layers.isOpen('favs')) renderFavs(); if (Layers.isOpen('cmp')) renderCmp(); });
  $('#dockFav').addEventListener('click', () => bus.emit('ui:favs'));
  $('#btnCmp').addEventListener('click', () => bus.emit('ui:cmp'));
  $('#cmpClear').addEventListener('click', () => { clearCmp(); Layers.close('cmp'); });
}
