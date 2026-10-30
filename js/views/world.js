/* ==========================================================================
   AOS · VISTA "MUNDO": tarjetas de producto, decoración editorial y regiones del canvas.
   Solo dibuja (DOM). El estado vive en store.js y el movimiento en canvas.js.
   ========================================================================== */
import { Canvas } from '../canvas.js';
import { S, bus, t, money, cover, prod, isOut, isScarce, scarceText, discountPct } from '../store.js';
import { $, $$, esc, ic, pad2, clamp, fmt } from '../util.js';
import { waContactUrl } from '../whatsapp.js';

const tileEls = new Map();
export const getTile = (id) => tileEls.get(id);

/* --------------------------- datos que se pintan en cada tarjeta --------------------------- */
function flagText(p) {
  if (isOut(p)) return t('texto_agotado');
  return p.etiqueta || '';
}
function scarceHtml(p) {
  return isScarce(p) ? '<span class="scarce" data-scarce role="status">' + esc(scarceText(p)) + '</span>' : '';
}

function makeTile(p, n) {
  const el = document.createElement('article');
  el.className = 'tile'; el.dataset.id = p.id; el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', p.nombre + ', ' + money(p.precio));
  el.dataset.soldout = t('texto_agotado');
  el.dataset.incart = t('texto_en_lista');
  const out = isOut(p), disc = discountPct(p), flag = flagText(p);
  el.innerHTML =
    '<div class="tile__media"><img alt="' + esc(p.nombre) + '" draggable="false"></div>' +
    '<span class="tile__num" aria-hidden="true">' + pad2(n) + '</span>' +
    '<div class="tile__acts">' +
    '<button type="button" class="act" data-act="fav" aria-label="' + esc(t('texto_favoritos')) + '">' + ic('heart') + '</button>' +
    '<button type="button" class="act" data-act="cmp" aria-label="' + esc(t('texto_comparar')) + '">' + ic('compare') + '</button>' +
    '<button type="button" class="act" data-act="cart" aria-label="' + esc(t('texto_boton_comprar')) + '"' + (out ? ' disabled' : '') + '>' + ic('plus') + '</button>' +
    '<span class="act act--grip" data-grip aria-hidden="true">' + ic('grip') + '</span>' +
    '</div>' +
    '<div class="tile__cap"><h3>' + esc(p.nombre) + '</h3>' +
    '<p class="tile__price"><b>' + money(p.precio) + '</b>' + (disc ? '<s>' + money(p.precioAnt) + '</s><em>−' + disc + '%</em>' : '') + '</p>' +
    '<span class="tile__flag"' + (flag ? '' : ' hidden') + '>' + esc(flag) + '</span>' +
    '<span class="tile__scarce">' + scarceHtml(p) + '</span></div>';
  if (out) el.classList.add('is-soldout');
  tileEls.set(p.id, el);
  return {
    id: p.id, el, mediaEl: el.querySelector('.tile__media'), imgEl: el.querySelector('img'), src: cover(p),
    x: p.x, y: p.y, w: p.w, pr: p.pr, d: p.d, rot: p.rot, textH: scarceHtml(p) ? 124 : 96,
  };
}

/** Refresca precio, etiqueta, agotado y micro-banner de escasez de una tarjeta (sin reconstruirla). */
export function updateTile(p) {
  const el = tileEls.get(p.id);
  if (!el) return;
  const out = isOut(p), disc = discountPct(p), flag = flagText(p);
  el.classList.toggle('is-soldout', out);
  const fl = $('.tile__flag', el); fl.textContent = flag; fl.hidden = !flag;
  const sc = $('.tile__scarce', el); const html = scarceHtml(p); if (sc.innerHTML !== html) sc.innerHTML = html;
  $('.tile__price', el).innerHTML = '<b>' + money(p.precio) + '</b>' + (disc ? '<s>' + money(p.precioAnt) + '</s><em>−' + disc + '%</em>' : '');
  const b = $('[data-act="cart"]', el); if (b) b.disabled = out;
}

export function syncTile(id) {
  const el = tileEls.get(id);
  if (!el) return;
  el.classList.toggle('in-cart', S.cart.has(id));
  const f = $('[data-act="fav"]', el); if (f) f.classList.toggle('is-on', S.favs.has(id));
  const c = $('[data-act="cmp"]', el); if (c) c.classList.toggle('is-on', S.compare.indexOf(id) >= 0);
}

/* -------------------------------------- decoración -------------------------------------- */
function mkDecor(cls, html, st) {
  const el = document.createElement('div');
  el.className = 'decor ' + cls;
  if (html) el.innerHTML = html;
  if (st) Object.assign(el.style, st);
  return el;
}
const seeded = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };

function contactPanel() {
  const wa = waContactUrl();
  return '<p class="contact__k">' + esc((S.cats.find((c) => c.tipo === 'contacto') || { nombre: 'CONTACTO' }).nombre) + '</p>' +
    '<h2>' + esc(t('texto_contacto_titulo')) + '<em>.</em></h2>' +
    '<p>' + esc(t('texto_contacto_cuerpo')) + '</p>' +
    '<div class="contact__btns">' +
    '<a class="btn btn--wa" href="' + esc(wa) + '" target="_blank" rel="noopener">' + ic('wa') + '<span>' + esc(t('texto_boton_whatsapp')) + '</span></a>' +
    '<a class="btn" href="' + esc(t('url_ubicacion')) + '" target="_blank" rel="noopener">' + ic('pin') + '<span>' + esc(t('texto_boton_ubicacion')) + '</span></a>' +
    '<a class="btn" href="' + esc(t('url_grupo_whatsapp')) + '" target="_blank" rel="noopener">' + ic('users') + '<span>' + esc(t('texto_boton_grupo')) + '</span></a>' +
    '</div>';
}

/** Construye (o reconstruye) todo el mundo. opts.keepCamera conserva la vista al refrescar el catálogo. */
export function buildWorld(opts) {
  tileEls.clear();
  const items = [], decor = [], regions = [];
  const real = S.cats.filter((c) => c.tipo !== 'contacto');
  S.cats.forEach((c, ci) => {
    regions.push({ id: c.id, label: c.nombre, cx: c.cx, cy: c.cy });
    const label = String(c.nombre).toUpperCase();
    const fs = clamp(2300 / label.length * 0.9, 240, 440);
    if (c.tipo === 'contacto') {
      decor.push({ el: mkDecor('decor--word', esc(label), { fontSize: 'calc(var(--S) * ' + Math.round(fs * 0.7) + 'px)' }), x: c.cx - 560, y: c.cy - 520, w: label.length * fs * 0.45, h: fs * 0.6, d: 0.72 });
      decor.push({ el: mkDecor('decor--panel contact', contactPanel()), x: c.cx - 360, y: c.cy - 250, w: 720, h: 520, d: 1 });
    } else {
      decor.push({ el: mkDecor('decor--word', esc(label), { fontSize: 'calc(var(--S) * ' + Math.round(fs) + 'px)' }), x: c.cx - 820, y: c.cy - 600, w: label.length * fs * 0.62, h: fs * 0.85, d: 0.72 });
      decor.push({ el: mkDecor('decor--idx', pad2(ci + 1) + ' — ' + pad2(real.length) + ' · ' + esc(c.sub || '')), x: c.cx - 820, y: c.cy - 690, w: 360, h: 20, d: 1 });
      decor.push({ el: mkDecor('decor--note', esc(c.sub || c.nombre) + ' ↘'), x: c.cx - 700, y: c.cy + 300, w: 460, h: 50, d: 1.04, rot: -4 });
      decor.push({ el: mkDecor('decor--ring', '', { width: 'calc(var(--S) * 240px)', height: 'calc(var(--S) * 240px)' }), x: c.cx + 420, y: c.cy + 380, w: 240, h: 240, d: 0.8 });
    }
    for (let k = 0; k < 3; k++) {
      const sz = 10 + Math.round(seeded(ci * 7 + k) * 16);
      decor.push({
        el: mkDecor('decor--dot', '', { width: 'calc(var(--S) * ' + sz + 'px)', height: 'calc(var(--S) * ' + sz + 'px)' }),
        x: c.cx - 800 + seeded(ci * 11 + k * 3) * 1600, y: c.cy - 500 + seeded(ci * 5 + k * 9) * 1000, w: sz, h: sz, d: 1.45 + seeded(k + ci) * 0.4,
      });
    }
  });
  const counters = {};
  S.order.forEach((id) => {
    const p = prod(id);
    counters[p.cat] = (counters[p.cat] || 0) + 1;
    items.push(makeTile(p, counters[p.cat]));
  });
  Canvas.build({ items, decor, regions, start: S.cats.length ? S.cats[0].id : '' }, opts);
  S.products.forEach((p) => syncTile(p.id));
}

/** Retira los esqueletos de tarjetas (misma geometría que las reales: no hay saltos). */
export function dropSkeleton() {
  const sk = $('#skel');
  if (!sk) return;
  sk.classList.add('is-off');
  setTimeout(() => sk.remove(), 600);
}

export function initWorld() {
  const ids = (e) => (e && e.ids) || (e && e.id ? [e.id] : []);
  bus.on('cart', (e) => (e.ids || []).forEach(syncTile));
  bus.on('favs', (e) => (e.bulk || [e.id]).forEach(syncTile));
  bus.on('cmp', (e) => ids(e).forEach(syncTile));
  bus.on('stock', (e) => (e.ids || []).forEach((id) => { const p = prod(id); if (p) updateTile(p); }));
}
