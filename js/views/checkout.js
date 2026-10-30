/* ==========================================================================
   AOS · VISTA "CHECKOUT": pago con QR, envío del pedido, WhatsApp y confirmación.

   LEY DE HICK (sin fricción): no hay registro ni pasarela. Al pulsar CONTINUAR VIA WHATSAPP
   ocurren A LA VEZ, en el mismo clic:
        1) el payload del carrito viaja al doPost de Google Apps Script (fila nueva en `Pedidos`), y
        2) se abre WhatsApp con el pedido ya redactado.
   El ID oficial (AOS-DDMM/NNN) lo asigna el servidor. WhatsApp espera ese ID hasta
   `espera_id_pedido_ms` (hoja Configuracion); si el servidor tarda más, el mensaje sale con una
   referencia provisional (REF-XXXXXX) que también se guarda en la hoja, así nunca se pierde un pedido.
   Sin internet, el pedido queda en la cola local y se sincroniza solo al volver la conexión.
   ========================================================================== */
import {
  S, bus, t, cfgNum, money, cover, prod, catName, totals, shipPayload, shipLabel, shipDetail, requestId,
  applyOrderStock, cartClear, setCoupon,
} from '../store.js';
import { api } from '../api.js';
import { OrderQueue } from '../storage.js';
import { isTransient, flushQueue } from '../offline.js';
import { $, esc, ic, fmt, round2, sleep, shortCode, saveBlob, b64ToBlob, reduceMotion } from '../util.js';
import { Layers } from '../ui/layers.js';
import { toast } from '../ui/toast.js';
import { Log } from '../remote.js';
import { waUrl } from '../whatsapp.js';
import { openViewer } from './viewer.js';
import { resetCouponUi } from './cart.js';

let busy = false;
const cur = { requestId: '', official: false, waUrl: '', order: null };     // pedido que muestra la confirmación

/* --------------------------------------- pago --------------------------------------- */
function openPay() {
  const tt = totals();
  if (!tt.count) { toast(t('texto_vacio_carrito_titulo'), { err: true }); return; }
  const img = $('#qrImg'), url = t('url_qr_pago');
  if (img.getAttribute('data-src') !== url) {
    const box = $('#qrOpen'); box.classList.remove('is-loaded');
    img.addEventListener('load', () => box.classList.add('is-loaded'), { once: true });
    img.addEventListener('error', () => box.classList.add('is-loaded'), { once: true });
    img.setAttribute('data-src', url); img.src = url;
  }
  $('#paySum').innerHTML =
    '<div class="tot"><div><dt>' + tt.count + ' ' + esc(t(tt.count === 1 ? 'texto_prenda' : 'texto_prendas')) + '</dt><dd>' + money(tt.sub) + '</dd></div>' +
    (tt.disc > 0 ? '<div class="is-disc"><dt>' + esc(t('texto_descuento')) + ' ' + esc(S.coupon.code) + '</dt><dd>− ' + money(tt.disc) + '</dd></div>' : '') +
    '<div class="tot__big"><dt>' + esc(t('texto_total_pagar')) + '</dt><dd>' + money(tt.total) + '</dd></div></div>' +
    '<p>' + esc(t('texto_envio_etiqueta')) + ': <b>' + esc(shipLabel(S.ship.type)) + '</b>' + (shipDetail() ? ' · ' + esc(shipDetail()) : '') + ' · ' + esc(t('texto_envio_nota')) + '</p>';
  Log.push('checkout_start'); Log.push('qr_open');
  Layers.open('pay');
}

async function downloadQr() {
  const btn = $('#qrDl'); btn.classList.add('is-loading');
  const url = t('url_qr_pago');
  try {
    let blob = null, name = 'QR_Pago_' + (S.cfg.titulo_tienda || 'tienda') + '.jpg';
    try {
      const r = await fetch(url, { mode: 'cors' });
      if (!r.ok) throw new Error('http');
      blob = await r.blob();
    } catch (e1) {                                           // CORS: se lo pedimos al servidor (Apps Script)
      const s = await api.qr();
      if (!s || !s.ok) throw new Error('server');
      blob = b64ToBlob(s.base64, s.mime); name = s.filename || name;
    }
    saveBlob(blob, name);
    toast('QR descargado ✓', { ttl: 1800 });
  } catch (e2) {
    window.open(url, '_blank', 'noopener');
    toast('Se abrió el QR en una pestaña: mantén presionada la imagen para guardarla', { ttl: 5000 });
  } finally { btn.classList.remove('is-loading'); }
}

/* ----------------------------------- pedido (doPost) ----------------------------------- */
function buildPayload(ref) {
  return {
    requestId: requestId(), clientId: S.clientId,
    items: Array.from(S.cart.entries()).map(([id, qty]) => ({ id, qty })),
    coupon: S.coupon ? S.coupon.code : '', shipping: shipPayload(),
    referencia: ref, origen: 'online', clientTime: new Date().toISOString(),
  };
}

/** Pedido "provisional" armado con los datos locales (se muestra mientras el servidor responde). */
function snapshot(ref) {
  const tt = totals();
  const items = Array.from(S.cart.entries()).map(([id, qty]) => {
    const p = prod(id);
    return { id, nombre: p.nombre, cat: p.cat, qty, precio: p.precio, sub: round2(p.precio * qty), img: cover(p) };
  });
  return {
    orderId: ref, provisional: true, items, subtotal: tt.sub, descuento: tt.disc,
    cupon: S.coupon ? { code: S.coupon.code, tipo: S.coupon.tipo, valor: S.coupon.valor } : null, total: tt.total,
    envio: { tipo: S.ship.type, etiqueta: shipLabel(S.ship.type), detalle: shipDetail() },
  };
}

/** Nunca lanza. {kind:'ok',res} | {kind:'queued'} | {kind:'rejected',error} */
async function send(payload) {
  const queue = async () => {
    await OrderQueue.put({ requestId: payload.requestId, createdAt: Date.now(), payload, status: 'pending' });
    bus.emit('queue:changed', {});
    if (navigator.onLine !== false) setTimeout(() => flushQueue(), 8000);        // falló la red estando "online": reintento pronto
    return { kind: 'queued' };
  };
  if (navigator.onLine === false) return queue();
  try { return { kind: 'ok', res: await api.order(payload) }; }
  catch (e) { return isTransient(e) ? queue() : { kind: 'rejected', error: String((e && e.message) || e) }; }
}

function openBlank() {
  try {                                                      // se abre ya, dentro del gesto del usuario: evita el bloqueo de ventanas
    const w = window.open('', '_blank');
    if (w) w.document.write('<title>' + esc(S.cfg.titulo_tienda || '') + '</title><body style="margin:0;display:grid;place-content:center;height:100vh;font:600 18px system-ui;background:#f6f4ef;color:#111">…</body>');
    return w;
  } catch (e) { return null; }
}
function goWhatsApp(win, url) {
  if (win && !win.closed) { try { win.location.href = url; return true; } catch (e) { /* cae al botón */ } }
  return false;
}

async function confirm() {
  if (busy) return;
  const tt = totals();
  if (!tt.count) return;
  busy = true;
  const btn = $('#payWa'); btn.classList.add('is-loading');
  try {
    const ref = 'REF-' + shortCode(6);
    const payload = buildPayload(ref), snap = snapshot(ref);
    const win = openBlank();                                 // (1) WhatsApp: ventana lista en el mismo gesto
    const sending = send(payload);                           // (2) doPost: sale en el mismo instante
    const wait = Math.max(0, cfgNum('espera_id_pedido_ms', 3000));
    const early = await Promise.race([sending, sleep(wait).then(() => null)]);
    if (early && early.kind === 'rejected') {
      if (win) { try { win.close(); } catch (e) { /* noop */ } }
      toast(early.error, { err: true, ttl: 5600 });
      bus.emit('ui:refresh');                                // el stock pudo cambiar: revalida el catálogo
      return;
    }
    const official = early && early.kind === 'ok' ? early.res : null;
    const order = official || snap;
    const url = waUrl(order);
    const opened = goWhatsApp(win, url);
    cur.requestId = payload.requestId; cur.official = !!official; cur.waUrl = url; cur.order = order;
    if (official) applyOrderStock(official.items);
    setCoupon(null); resetCouponUi();
    cartClear();
    Layers.close('pay'); Layers.close('cart');
    openDone(order, opened, early && early.kind === 'queued' ? 'queued' : official ? '' : 'pending');
    Log.push('order', '', order.orderId); Log.flush();
    if (official) fetchReceipt(official.orderId);
    else if (!early) sending.then((late) => lateResult(late, payload.requestId, ref));
  } finally { busy = false; btn.classList.remove('is-loading'); }
}

/** El servidor respondió DESPUÉS de abrir WhatsApp: actualiza la confirmación con el ID oficial. */
function lateResult(late, requestId, ref) {
  if (late.kind === 'ok') {
    applyOrderStock(late.res.items);
    if (cur.requestId === requestId && Layers.isOpen('done')) {
      cur.official = true; cur.order = late.res;
      fillDone(late.res, 'late', ref);
      fetchReceipt(late.res.orderId);
    } else toast(fmt(t('texto_pedido_sincronizado'), { id: late.res.orderId }), { ttl: 3500 });
  } else if (late.kind === 'queued') {
    if (cur.requestId === requestId) setNote(t('texto_pedido_cola'), false);
  } else if (late.kind === 'rejected') {
    setNote('No pudimos registrar tu pedido: ' + late.error + ' Escríbenos por WhatsApp con tu referencia ' + ref + '.', true);
    toast(late.error, { err: true, ttl: 6000 });
  }
}

/* ------------------------------------ confirmación ------------------------------------ */
function setNote(text, err) {
  const n = $('#doneNote');
  n.hidden = !text; n.textContent = text || ''; n.classList.toggle('is-err', !!err);
}

function fillDone(o, mode, ref) {
  $('#doneTitle').textContent = o.orderId;
  $('#doneItems').innerHTML = o.items.map((it) => {
    const p = prod(it.id), src = p ? cover(p) : it.img;
    return '<li><img src="' + esc(src) + '" alt="' + esc(it.nombre) + '" data-open-product="' + esc(it.id) + '"><small><b>' + esc(it.nombre) + '</b><br>×' + it.qty + ' · ' + money(it.sub) + '</small></li>';
  }).join('');
  $('#doneTot').innerHTML =
    '<div><dt>' + esc(t('texto_subtotal')) + '</dt><dd>' + money(o.subtotal) + '</dd></div>' +
    (o.descuento > 0 ? '<div class="is-disc"><dt>' + esc(t('texto_descuento')) + (o.cupon ? ' ' + esc(o.cupon.code) : '') + '</dt><dd>− ' + money(o.descuento) + '</dd></div>' : '') +
    '<div><dt>' + esc(t('texto_envio_etiqueta')) + '</dt><dd>' + esc(o.envio.etiqueta) + '</dd></div>' +
    '<div class="tot__big"><dt>' + esc(t('texto_total')) + '</dt><dd>' + money(o.total) + '</dd></div>';
  if (mode === 'pending') setNote(fmt(t('texto_pedido_ref'), { ref: o.orderId }), false);
  else if (mode === 'queued') setNote(t('texto_pedido_cola') + ' ' + fmt(t('texto_pedido_ref'), { ref: o.orderId }), false);
  else if (mode === 'late') setNote(ref ? 'Tu pedido quedó registrado como ' + o.orderId + ' (en WhatsApp lo enviaste como ' + ref + ').' : '', false);
  else setNote('', false);
}

function openDone(o, opened, mode) {
  fillDone(o, mode, o.orderId);
  $('#doneWa').hidden = !!opened;
  $('#doneGroup').href = t('url_grupo_whatsapp');
  const pdf = $('#donePdf'); pdf.disabled = true;
  $('span', pdf).textContent = t('texto_boton_comprobante');
  Layers.open('done');
  confetti();
}

function confetti() {
  const box = $('#confetti'); box.innerHTML = '';
  if (reduceMotion) return;
  const cols = ['#da532c', '#0d0d0d', '#f2b134', '#17794a', '#8c5cf5'];
  for (let i = 0; i < 34; i++) {
    const p = document.createElement('i');
    p.style.left = (Math.random() * 100) + '%'; p.style.background = cols[i % cols.length];
    p.style.setProperty('--x', (Math.random() * 160 - 80) + 'px'); p.style.setProperty('--r', (Math.random() * 900 - 450) + 'deg');
    p.style.setProperty('--d', (Math.random() * 0.5) + 's'); p.style.setProperty('--t', (1.8 + Math.random() * 1.2) + 's');
    box.appendChild(p);
  }
  setTimeout(() => { box.innerHTML = ''; }, 4200);
}

/* ------------------------------------ comprobante PDF ------------------------------------ */
let receipt = null;
function fetchReceipt(orderId) {
  const btn = $('#donePdf'), lab = $('span', btn);
  btn.disabled = true; btn.classList.add('is-loading'); lab.textContent = t('texto_boton_comprobante');
  receipt = null;
  api.receipt(orderId, S.clientId).then((r) => {
    btn.classList.remove('is-loading');
    if (r && r.ok) { receipt = r; btn.disabled = false; } else { btn.disabled = false; lab.textContent = 'Reintentar comprobante'; }
  }).catch(() => { btn.classList.remove('is-loading'); btn.disabled = false; lab.textContent = 'Reintentar comprobante'; });
}

export function initCheckout() {
  bus.on('ui:pay', openPay);
  $('#payWa').addEventListener('click', confirm);
  $('#qrDl').addEventListener('click', downloadQr);
  $('#qrOpen').addEventListener('click', () => openViewer([{ tipo: 'imagen', url: t('url_qr_pago') }], 0, { title: t('texto_pago_titulo'), cover: true }));
  $('#donePdf').addEventListener('click', () => {
    if (receipt) { saveBlob(b64ToBlob(receipt.base64, receipt.mime), receipt.filename); return; }
    if (cur.order && cur.official) fetchReceipt(cur.order.orderId);
  });
  $('#doneWa').addEventListener('click', () => {
    let w = null; try { w = window.open(cur.waUrl, '_blank'); } catch (e) { w = null; }
    if (!w) { try { window.top.location.href = cur.waUrl; } catch (e2) { toast('No pudimos abrir WhatsApp. Copia el enlace desde tu navegador.', { err: true }); } }
  });
  // pedido que estaba en la cola offline y ya se envió
  bus.on('queue:synced', ({ entry, res }) => {
    toast(fmt(t('texto_pedido_sincronizado'), { id: res.orderId }), { ttl: 4000 });
    if (cur.requestId === entry.requestId && Layers.isOpen('done')) {
      cur.official = true; cur.order = res;
      fillDone(res, 'late', (entry.payload && entry.payload.referencia) || '');
      fetchReceipt(res.orderId);
    }
  });
}
void catName; void ic;
