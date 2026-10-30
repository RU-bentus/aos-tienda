/* ==========================================================================
   AOS · VISTA "PRODUCTO": modal con galería de 3 secciones, descripción, escasez y navegación.
   Al tocar una imagen se abre el VISOR a pantalla completa (viewer.js).
   En móvil la galería es un carrusel con deslizamiento táctil.
   ========================================================================== */
import {
  S, bus, t, cfgNum, money, cover, prod, catName, isOut, isScarce, scarceText, discountPct, maxFor,
} from '../store.js';
import { $, $$, esc, ic, pad2, clamp, anim, fmt } from '../util.js';
import { Layers } from '../ui/layers.js';
import { mediaKind } from '../media.js';
import { openViewer } from './viewer.js';
import { addToCart, favToggle, cmpToggle } from '../actions.js';
import { Log } from '../remote.js';

const mq = window.matchMedia('(max-width: 820px)');
const st = { id: null, qty: 1, slide: 0, n: 0, flashT: 0 };
let track, dots;

/* ------------------------------------ galería ------------------------------------ */
function galHtml(p, m, i, more) {
  const k = mediaKind(m);
  let body;
  if (k.k === 'img' || k.thumb) body = '<img src="' + esc(k.thumb) + '" alt="' + esc(p.nombre) + ' — ' + (i + 1) + '" draggable="false" decoding="async">';
  else if (k.k === 'video') body = '<video src="' + esc(k.src) + '#t=0.1" muted playsinline preload="metadata"></video>';
  else body = '';
  return '<button type="button" class="gal" data-i="' + i + '" aria-label="' + esc(p.nombre) + ' — pantalla completa">' + body +
    '<span class="gal__tag">' + pad2(i + 1) + (k.k === 'img' ? '' : ' · VIDEO') + '</span>' +
    (k.k === 'img' ? '' : '<span class="gal__play"><span>' + ic('play') + '</span></span>') +
    (more > 0 ? '<span class="gal__more">+' + more + '</span>' : '') +
    '<span class="gal__zoom">' + ic('expand') + '</span></button>';
}

function renderGallery(p) {
  const media = p.media.length ? p.media : [{ tipo: 'imagen', url: '', poster: '' }];
  st.n = media.length;
  const mobile = mq.matches;
  const shown = mobile ? media : media.slice(0, 3);
  track.dataset.n = shown.length;
  track.classList.remove('is-dragging');
  track.innerHTML = shown.map((m, i) => galHtml(p, m, i, !mobile && i === 2 ? media.length - 3 : 0)).join('');
  $$('.gal', track).forEach((g) => {
    const el = $('img, video', g);
    if (!el) { g.classList.add('is-loaded'); return; }
    const done = () => g.classList.add('is-loaded');
    el.addEventListener(el.tagName === 'VIDEO' ? 'loadeddata' : 'load', done, { once: true });
    el.addEventListener('error', done, { once: true });
    if (el.complete) done();
  });
  dots.innerHTML = shown.map((_, i) => '<i class="' + (i === st.slide ? 'is-on' : '') + '"></i>').join('');
  setSlide(clamp(st.slide, 0, shown.length - 1), false);
}

function setSlide(i, animate) {
  st.slide = i;
  track.style.setProperty('--i', i);
  $$('i', dots).forEach((d, k) => d.classList.toggle('is-on', k === i));
  void animate;
}

function bindSwipe() {
  let sw = null, block = false;
  track.addEventListener('pointerdown', (e) => {
    if (!mq.matches || track.children.length < 2) return;
    sw = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, w: Math.max(1, track.clientWidth) };
  });
  track.addEventListener('pointermove', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (!sw.moved) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) { sw.moved = true; track.classList.add('is-dragging'); try { track.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } }
      else { if (Math.abs(dy) > 14) sw = null; return; }
    }
    track.style.setProperty('--i', clamp(st.slide - dx / sw.w, -0.25, track.children.length - 0.75).toFixed(3));
  });
  const end = (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const s = sw; sw = null;
    track.classList.remove('is-dragging');
    if (!s.moved) return;
    const dx = e.clientX - s.x;
    const target = clamp(st.slide + (dx < -s.w * 0.2 ? 1 : dx > s.w * 0.2 ? -1 : 0), 0, track.children.length - 1);
    setSlide(target, true);
    block = true; setTimeout(() => { block = false; }, 80);       // el "clic" que cierra el arrastre no abre el visor
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  track.addEventListener('click', (e) => {
    if (block) { e.preventDefault(); e.stopPropagation(); return; }
    const g = e.target.closest('.gal');
    if (!g) return;
    const p = prod(st.id); if (!p || !p.media.length) return;
    Log.push('gallery_open', st.id, g.dataset.i);
    openViewer(p.media, Number(g.dataset.i), { title: p.nombre });
  }, true);
  $('#pmDots').addEventListener('click', (e) => { const i = $$('i', dots).indexOf(e.target); if (i >= 0) setSlide(i, true); });
}

/* ------------------------------------- ficha ------------------------------------- */
function renderInfo(p) {
  const out = isOut(p), low = isScarce(p), disc = discountPct(p), min = cfgNum('prueba_social_minimo', 3);
  let badges = '';
  if (out) badges += '<span class="badge badge--out">' + esc(t('texto_agotado')) + '</span>';
  if (p.favs >= min) badges += '<span class="badge">' + ic('heart') + p.favs + ' personas lo guardaron</span>';
  if (p.sold7 >= min) badges += '<span class="badge">' + ic('users') + p.sold7 + ' pedidas esta semana</span>';
  if (disc) badges += '<span class="badge badge--save">Ahorras ' + money(p.precioAnt - p.precio) + '</span>';
  const rel = S.order.filter((x) => x !== p.id).sort((a, b) => (prod(b).cat === p.cat) - (prod(a).cat === p.cat)).slice(0, 5);
  $('#pmBody').innerHTML =
    '<p class="pm__cat">' + esc(catName(p.cat)) + (p.etiqueta ? ' · ' + esc(p.etiqueta) : '') + '</p>' +
    '<h2 class="pm__title" id="pmTitle">' + esc(p.nombre) + '</h2>' +
    '<div class="pm__price"><b>' + money(p.precio) + '</b>' + (disc ? '<s>' + money(p.precioAnt) + '</s><span class="pill2">−' + disc + '%</span>' : '') + '</div>' +
    '<div class="pm__badges">' + badges + '</div>' +
    (low ? '<div class="pm__scarce"><span class="scarce" data-scarce role="status">' + esc(scarceText(p)) + '</span></div>' +
      '<div class="stockbar" aria-hidden="true"><i style="width:' + clamp(p.stock / Math.max(1, cfgNum('umbral_escasez', 2) + 1) * 100, 10, 100) + '%"></i></div>' : '') +
    '<p class="pm__desc">' + esc(p.desc) + '</p>' +
    '<dl class="pm__facts"><dt>Sección</dt><dd>' + esc(catName(p.cat)) + '</dd><dt>Disponible</dt><dd>' + (out ? esc(t('texto_agotado')) : p.stock + ' unidades') + '</dd><dt>Código</dt><dd>' + esc(p.id) + '</dd></dl>' +
    (rel.length ? '<div class="pm__rel"><h4>También te puede gustar</h4><div>' + rel.map((x) =>
      '<img src="' + esc(cover(prod(x))) + '" alt="' + esc(prod(x).nombre) + '" title="' + esc(prod(x).nombre) + '" data-open-product="' + esc(x) + '" decoding="async">').join('') + '</div></div>' : '');
}

function syncBtns() {
  const id = st.id, p = prod(id);
  if (!p) return;
  const out = isOut(p), inCart = S.cart.get(id) || 0, max = maxFor(p);
  st.qty = clamp(st.qty, 1, Math.max(1, max - inCart));
  $('#pmQtyN').textContent = st.qty;
  const add = $('#pmAdd');
  add.disabled = out || inCart >= max;
  if (!st.flashT) {
    $('span', add).textContent = out ? t('texto_agotado') : inCart >= max ? t('texto_boton_maximo') : inCart ? t('texto_boton_comprar_otra', { n: inCart }) : t('texto_boton_comprar');
  }
  $('#pmFav').classList.toggle('is-on', S.favs.has(id));
  $('#pmCmp').classList.toggle('is-on', S.compare.indexOf(id) >= 0);
  $$('#pmQty button').forEach((b) => { b.disabled = out; });
}

function render(id, dir) {
  const p = prod(id);
  if (!p) return;
  st.id = id; st.slide = 0;
  renderGallery(p);
  renderInfo(p);
  const idx = S.order.indexOf(id);
  $('#pmIdx').textContent = pad2(idx + 1) + ' / ' + pad2(S.order.length);
  syncBtns();
  $('#pmBody').scrollTop = 0;
  if (dir) {
    $('#pm').style.setProperty('--dir', dir);
    ['#pmGal', '#pmBody'].forEach((s) => { const el = $(s); el.classList.remove('pm__swap'); void el.offsetWidth; el.classList.add('pm__swap'); });
  }
  Log.push('view', id);
}

export function openProduct(id) {
  if (!prod(id)) return;
  const wasOpen = Layers.isOpen('pm');
  st.qty = 1; clearTimeout(st.flashT); st.flashT = 0;
  render(id, 0);
  if (!wasOpen) Layers.open('pm', { onClose: () => { st.id = null; } });
}

function step(dir) {
  const i = S.order.indexOf(st.id);
  if (i < 0) return;
  const n = S.order.length;
  st.qty = 1;
  render(S.order[(i + dir + n) % n], dir);
}

export function initProduct() {
  track = $('#pmTrack'); dots = $('#pmDots');
  bindSwipe();
  bus.on('ui:product', openProduct);
  const mine = (e) => st.id && Layers.isOpen('pm') && ((e.ids || [e.id]).indexOf(st.id) >= 0 || (e.bulk || []).indexOf(st.id) >= 0);
  bus.on('cart', (e) => { if (mine(e)) syncBtns(); });
  bus.on('favs', (e) => { if (mine(e)) syncBtns(); });
  bus.on('cmp', (e) => { if (mine(e)) syncBtns(); });
  bus.on('stock', (e) => { if (mine(e)) { const p = prod(st.id); renderInfo(p); syncBtns(); } });
  bus.on('catalog', (e) => { if (Layers.isOpen('pm') && prod(st.id) && e && !e.fresh && e.changed.indexOf(st.id) >= 0) { renderInfo(prod(st.id)); syncBtns(); } });
  mq.addEventListener('change', () => { if (Layers.isOpen('pm') && prod(st.id)) renderGallery(prod(st.id)); });
  $('#pmPrev').addEventListener('click', () => step(-1));
  $('#pmNext').addEventListener('click', () => step(1));
  $('#pmQty').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    const p = prod(st.id), max = maxFor(p) - (S.cart.get(st.id) || 0);
    st.qty = clamp(st.qty + Number(b.dataset.q), 1, Math.max(1, max));
    $('#pmQtyN').textContent = st.qty;
  });
  $('#pmAdd').addEventListener('click', () => {
    if (!addToCart(st.id, st.qty, { src: 'modal' })) return;
    st.qty = 1;
    const s = $('#pmAdd span');
    s.textContent = t('texto_boton_agregado');
    clearTimeout(st.flashT);
    st.flashT = setTimeout(() => { st.flashT = 0; if (st.id) syncBtns(); }, 1400);
    anim($('#pmAdd'), [{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 400 });
    syncBtns();
  });
  $('#pmFav').addEventListener('click', () => favToggle(st.id));
  $('#pmCmp').addEventListener('click', () => cmpToggle(st.id));
  document.addEventListener('keydown', (e) => {
    if (!Layers.isOpen('pm') || Layers.isOpen('viewer') || /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  });
}
void fmt;
