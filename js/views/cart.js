/* ==========================================================================
   AOS · VISTA "CARRITO": lista, cupón, tipo de envío y totales.

   ENVÍO (regla del proyecto): ningún tipo de envío pide datos obligatorios.
   Solo "Envío departamental" despliega cajas de texto OPCIONALES (destino, nombre completo,
   teléfono, transportadora); al tocarlo de nuevo se ocultan.
   ========================================================================== */
import {
  S, bus, t, money, cover, prod, catName, totals, isScarce, scarceText, maxFor,
  setCoupon, cartClear, setShipType, setShipField, SHIP_KEYS,
} from '../store.js';
import { api } from '../api.js';
import { $, $$, esc, ic, fmt } from '../util.js';
import { Layers } from '../ui/layers.js';
import { toast } from '../ui/toast.js';
import { Log } from '../remote.js';
import { dockOrder } from './dock.js';

let shipOpen = false;                // ¿están visibles las cajas opcionales del envío departamental?
const seen = new Set();

/* --------------------------------- mensajes del cupón --------------------------------- */
function setCpMsg(text, kind, withRemove) {
  const m = $('#cpMsg');
  m.className = 'cp__msg' + (kind ? ' is-' + kind : '');
  m.textContent = text || '';
  if (withRemove) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = 'Quitar'; b.dataset.cpRemove = '1';
    m.appendChild(b);
  }
}

/* --------------------------------------- lista --------------------------------------- */
function renderList() {
  const empty = !S.cart.size, tt = totals();
  $('#cartEmpty').hidden = !empty; $('#cartFull').hidden = empty; $('#cartFoot').hidden = empty;
  $('#cartCount').textContent = tt.count ? '(' + tt.count + ')' : '';
  if (empty) {
    const sg = dockOrder.filter((id) => prod(id) && prod(id).stock > 0).slice(0, 3);
    $('#cartEmpty').innerHTML = '<h3>' + esc(t('texto_vacio_carrito_titulo')) + '</h3><p>' + esc(t('texto_vacio_carrito')) + '</p>' +
      '<div class="empty__row">' + sg.map((id) => '<img src="' + esc(cover(prod(id))) + '" alt="' + esc(prod(id).nombre) + '" data-open-product="' + esc(id) + '">').join('') + '</div>';
    return;
  }
  $('#cartList').innerHTML = Array.from(S.cart.entries()).map(([id, q]) => {
    const p = prod(id); if (!p) return '';
    const isNew = !seen.has(id); seen.add(id);
    const max = maxFor(p);
    return '<li class="' + (isNew ? 'is-new' : '') + '" data-id="' + esc(id) + '">' +
      '<img src="' + esc(cover(p)) + '" alt="' + esc(p.nombre) + '" data-open-product="' + esc(id) + '" decoding="async">' +
      '<div class="row__t"><h4>' + esc(p.nombre) + '</h4><p>' + esc(catName(p.cat)) + ' · ' + money(p.precio) + '</p>' +
      (isScarce(p) ? '<p class="row__warn">' + esc(scarceText(p)) + '</p>' : '') +
      '<p class="row__sub">' + money(p.precio * q) + '</p></div>' +
      '<div class="row__r"><div class="qty"><button type="button" data-qd="-1" data-id="' + esc(id) + '" aria-label="Menos">' + ic('minus') + '</button>' +
      '<output>' + q + '</output><button type="button" data-qd="1" data-id="' + esc(id) + '" aria-label="Más"' + (q >= max ? ' disabled' : '') + '>' + ic('plus') + '</button></div>' +
      '<button type="button" class="rm" data-rm="' + esc(id) + '" aria-label="Quitar">' + ic('trash') + '</button></div></li>';
  }).join('');
  renderTotals();
}

export function renderTotals() {
  const tt = totals();
  $('#tSub').textContent = money(tt.sub);
  $('#tDiscRow').hidden = !(tt.disc > 0);
  $('#tDiscRow').classList.toggle('is-disc', tt.disc > 0);
  if (tt.disc > 0) {
    $('#tDiscLbl').textContent = t('texto_descuento') + (S.coupon ? ' (' + S.coupon.code + ')' : '');
    $('#tDisc').textContent = '− ' + money(tt.disc);
  }
  $('#tTotal').textContent = money(tt.total);
  const rows = $('#tSub').closest('dl');
  rows.children[0].firstElementChild.textContent = t('texto_subtotal');
  $('.tot__big dt', rows).textContent = t('texto_total');
}

/* ---------------------------------------- envío ---------------------------------------- */
function shipFieldHtml(k, label, type, list) {
  return '<div class="fld"><label for="sh_' + k + '">' + esc(label) + ' <i>(' + esc(t('texto_campo_opcional')) + ')</i></label>' +
    '<input id="sh_' + k + '" name="' + k + '" type="' + (type || 'text') + '" maxlength="80" autocomplete="off"' +
    (list ? ' list="sh_dep"' : '') + (type === 'tel' ? ' inputmode="tel"' : '') + ' value="' + esc(S.ship[k] || '') + '"></div>';
}

function renderShip() {
  const box = $('#shipOpts');
  box.innerHTML = SHIP_KEYS.map((k) => {
    const on = S.ship.type === k, dep = k === 'departamental';
    return '<button type="button" class="ship__opt' + (on ? ' is-on' : '') + '" data-t="' + k + '" role="radio" aria-checked="' + on + '"' +
      (dep ? ' aria-expanded="' + (on && shipOpen) + '" aria-controls="shipForm"' : '') + '>' +
      '<span class="ship__dot"></span><span><b>' + esc(t('envio_' + k + '_titulo')) + '</b><small>' + esc(t('envio_' + k + '_detalle')) + '</small></span>' +
      (dep ? ic('chev', 'ship__chev') : '') + '</button>';
  }).join('');
  renderShipForm();
}

function renderShipForm() {
  const f = $('#shipForm');
  const show = S.ship.type === 'departamental' && shipOpen;
  f.hidden = !show;
  if (!show) return;
  const deps = String(t('departamentos')).split(',').map((s) => s.trim()).filter(Boolean);
  f.innerHTML =
    shipFieldHtml('destino', t('label_envio_destino'), 'text', true) +
    '<datalist id="sh_dep">' + deps.map((d) => '<option value="' + esc(d) + '">').join('') + '</datalist>' +
    shipFieldHtml('nombre', t('label_envio_nombre'), 'text') +
    shipFieldHtml('celular', t('label_envio_telefono'), 'tel') +
    shipFieldHtml('transportadora', t('label_envio_transportadora'), 'text');
}

function onShipClick(e) {
  const b = e.target.closest('.ship__opt');
  if (!b) return;
  const k = b.dataset.t;
  if (k === 'departamental') {
    // 1er toque: selecciona y muestra las cajas · toques siguientes: muestra / oculta (sin cambiar la selección)
    shipOpen = S.ship.type === 'departamental' ? !shipOpen : true;
    if (S.ship.type !== 'departamental') setShipType(k);
  } else { shipOpen = false; setShipType(k); }
  renderShip();
  if (k === 'departamental' && shipOpen) { const i = $('#sh_destino'); if (i && !matchMedia('(hover: none)').matches) i.focus({ preventScroll: true }); }
}

/* ---------------------------------------- cupón ---------------------------------------- */
async function onCoupon(e) {
  e.preventDefault();
  const code = $('#cpIn').value.trim().toUpperCase();
  if (!code) return;
  const tt = totals();
  if (!tt.count) { setCpMsg('Agrega productos antes de usar un cupón.', 'err'); return; }
  if (navigator.onLine === false) { setCpMsg('Sin conexión: valida el cupón cuando vuelva internet.', 'err'); return; }
  const btn = $('#cpBtn'); btn.classList.add('is-loading');
  try {
    const r = await api.coupon(code, tt.sub, S.clientId);
    if (r && r.ok) {
      setCoupon({ code: r.code, tipo: r.tipo, valor: r.valor, compraMinima: r.compraMinima || 0 });
      setCpMsg('✓ ' + r.mensaje, 'ok', true);
      $('#cpIn').value = '';
      Log.push('coupon_ok', r.code);
    } else {
      setCoupon(null);
      setCpMsg((r && r.mensaje) || 'Código no válido.', 'err');
    }
  } catch (err) { setCpMsg('No pudimos validar el código. Revisa tu conexión.', 'err'); }
  finally { btn.classList.remove('is-loading'); }
  renderTotals();
}

/* --------------------------------------- arranque --------------------------------------- */
export function openCart() { renderList(); renderShip(); Layers.open('cart'); Log.push('cart_open'); }

export function initCart() {
  $('#fab').addEventListener('click', () => bus.emit('ui:cart'));
  bus.on('ui:cart', openCart);
  bus.on('cart', (e) => {
    if (e.couponDropped) setCpMsg('El cupón se quitó: ya no llegas a la compra mínima.', 'err');
    if (Layers.isOpen('cart')) renderList(); else if (!S.cart.size) seen.clear();
  });
  bus.on('coupon', () => { if (Layers.isOpen('cart')) renderTotals(); });
  bus.on('catalog', () => { if (Layers.isOpen('cart')) { renderList(); renderShip(); } });
  bus.on('stock', () => { if (Layers.isOpen('cart')) renderList(); });
  $('#shipOpts').addEventListener('click', onShipClick);
  $('#shipForm').addEventListener('input', (e) => { const k = e.target.name; if (k) setShipField(k, e.target.value); });
  $('#cpForm').addEventListener('submit', onCoupon);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-cp-remove]')) { setCoupon(null); setCpMsg('Cupón quitado.', ''); renderTotals(); }
  });
  $('#cartClear').addEventListener('click', () => { cartClear(); setCoupon(null); setCpMsg('', ''); });
  $('#cartGo').addEventListener('click', () => bus.emit('ui:pay'));
}
export function resetCouponUi() { setCpMsg('', ''); }
