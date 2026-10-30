/* ==========================================================================
   AOS · VISOR A PANTALLA COMPLETA (carrusel de imágenes y vídeos)

   Se abre al tocar la imagen en el modal del producto (o el QR de pago).
   Gestos táctiles y de ratón, todos con Pointer Events y transform GPU (translate3d/scale):
     · deslizar izquierda/derecha ........ cambiar de imagen/vídeo (con inercia y resistencia en los extremos)
     · pellizcar (2 dedos) ............... zoom anclado al punto medio · rueda / Ctrl+rueda en escritorio
     · doble toque / doble clic .......... zoom 2.6× en ese punto (y vuelve a 1×)
     · arrastrar con zoom ................ mover la imagen (con límites)
     · arrastrar hacia abajo/arriba ...... "tirar para cerrar" (el fondo se desvanece)
     · un toque .......................... mostrar / ocultar controles
     · teclado: ← → cambian · + − 0 zoom · Esc cierra
   ========================================================================== */
import { $, $$, esc, ic, clamp, anim, reduceMotion, pad2 } from '../util.js';
import { Layers } from '../ui/layers.js';
import { t } from '../store.js';
import { mediaKind } from '../media.js';

let root, stage, track, bd, capEl, thumbs, hint, prevB, nextB, resetB;
let items = [], idx = 0, W = 1, H = 1, rect = { left: 0, top: 0 };
const Z = { s: 1, x: 0, y: 0 };                 // zoom/desplazamiento del slide activo
const ptrs = new Map();
let g = null, lastTap = null, tapTimer = 0, hintTimer = 0, wheelAt = 0, ready = false;

const MAX_ZOOM = 6, DOUBLE_ZOOM = 2.6;
const isImg = () => items[idx] && items[idx].k === 'img';
const paneEl = (i) => { const s = track.children[i]; return s ? s.firstElementChild : null; };

/* --------------------------------- posición / zoom --------------------------------- */
function measure() {
  const r = stage.getBoundingClientRect();
  W = r.width || window.innerWidth; H = r.height || window.innerHeight; rect = { left: r.left, top: r.top };
}
function setTrack(dx, animate) {
  track.classList.toggle('is-anim', !!animate && !reduceMotion);
  track.style.transform = 'translate3d(' + (-idx * W + (dx || 0)) + 'px,0,0)';
}
function applyZoom(animate) {
  const p = paneEl(idx);
  if (!p) return;
  p.classList.toggle('is-anim', !!animate && !reduceMotion);
  p.style.transform = (Z.s === 1 && !Z.x && !Z.y) ? '' : 'translate3d(' + Z.x.toFixed(1) + 'px,' + Z.y.toFixed(1) + 'px,0) scale(' + Z.s.toFixed(4) + ')';
  resetB.disabled = Z.s <= 1.01;
  root.classList.toggle('is-zoomed', Z.s > 1.01);
}
function clampPan() {
  if (Z.s <= 1) { Z.x = 0; Z.y = 0; return; }
  const mx = W * (Z.s - 1) / 2, my = H * (Z.s - 1) / 2;
  Z.x = clamp(Z.x, -mx, mx); Z.y = clamp(Z.y, -my, my);
}
function resetZoom(animate) { Z.s = 1; Z.x = 0; Z.y = 0; applyZoom(animate); }
/** Zoom manteniendo fijo el punto (px,py), medido desde el centro del visor. */
function zoomAt(px, py, ns, animate) {
  ns = clamp(ns, 1, MAX_ZOOM);
  const cx = (px - Z.x) / Z.s, cy = (py - Z.y) / Z.s;
  Z.s = ns; Z.x = px - ns * cx; Z.y = py - ns * cy;
  clampPan(); applyZoom(animate);
}

/* ------------------------------------- slides ------------------------------------- */
function slideHtml(it, i) {
  let inner;
  if (it.k === 'iframe') {
    inner = '<iframe data-src="' + esc(it.src) + '" allow="autoplay; fullscreen; encrypted-media" allowfullscreen title="' + esc(it.title) + '"></iframe>' +
      '<span class="vw__edge vw__edge--l"></span><span class="vw__edge vw__edge--r"></span>';
  } else if (it.k === 'video') {
    inner = '<video data-src="' + esc(it.src) + '" poster="' + esc(it.poster) + '" controls playsinline preload="none"></video>';
  } else {
    inner = '<img data-src="' + esc(it.src) + '" alt="' + esc(it.title) + ' — ' + (i + 1) + '" draggable="false" decoding="async">';
  }
  return '<div class="vw__slide" data-i="' + i + '"><div class="vw__pane skel' + (it.k === 'img' ? '' : ' is-media') + '">' + inner + '</div></div>';
}
function ensure(i) {
  const pane = paneEl(i);
  if (!pane || pane.dataset.ready) return;
  const it = items[i], el = pane.firstElementChild;
  if (it.k === 'img') {
    const done = () => pane.classList.remove('skel');
    el.addEventListener('load', done, { once: true }); el.addEventListener('error', done, { once: true });
    el.src = el.dataset.src;
    if (el.complete) done();
    pane.dataset.ready = '1';
  } else if (it.k === 'video') {
    el.src = el.dataset.src; el.preload = 'metadata'; pane.classList.remove('skel'); pane.dataset.ready = '1';
  } else {
    pane.classList.remove('skel');                 // el iframe se carga solo cuando es el activo
    pane.dataset.ready = '1';
  }
}
function activate() {
  [idx - 1, idx, idx + 1].forEach((j) => { if (j >= 0 && j < items.length) ensure(j); });
  items.forEach((it, j) => {
    const pane = paneEl(j); if (!pane) return;
    if (it.k === 'iframe') {
      const f = pane.querySelector('iframe');
      if (j === idx) { if (!f.src || f.src === 'about:blank') f.src = f.dataset.src; } else if (f.getAttribute('src')) f.removeAttribute('src');
    } else if (it.k === 'video' && j !== idx) { const v = pane.querySelector('video'); if (v && !v.paused) v.pause(); }
  });
}
function updateChrome() {
  const it = items[idx];
  capEl.innerHTML = esc(it.title) + '<small>' + pad2(idx + 1) + ' / ' + pad2(items.length) + (it.k === 'img' ? '' : ' · VIDEO') + '</small>';
  $$('button', thumbs).forEach((b, i) => b.classList.toggle('is-on', i === idx));
  prevB.disabled = idx <= 0; nextB.disabled = idx >= items.length - 1;
  prevB.style.opacity = idx <= 0 ? '.25' : ''; nextB.style.opacity = idx >= items.length - 1 ? '.25' : '';
  const on = $('button.is-on', thumbs);
  if (on && on.scrollIntoView) { try { on.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }); } catch (e) { /* noop */ } }
}

export function go(i, animate) {
  i = clamp(i, 0, items.length - 1);
  if (i !== idx) { resetZoom(false); }
  idx = i;
  Z.s = 1; Z.x = 0; Z.y = 0; resetB.disabled = true; root.classList.remove('is-zoomed');
  setTrack(0, animate !== false);
  activate(); updateChrome();
}

/* ------------------------------------ gestos ------------------------------------ */
function inVideoControls(e) {
  const v = e.target;
  if (!v || v.tagName !== 'VIDEO') return false;
  const r = v.getBoundingClientRect();
  return e.clientY > r.bottom - 56;
}
function toggleChrome() { root.classList.toggle('is-chrome-off'); }

function down(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (inVideoControls(e)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { stage.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
  clearTimeout(tapTimer);
  if (ptrs.size === 1) {
    g = { mode: null, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, lx: e.clientX, ly: e.clientY, lt: e.timeStamp, vx: 0, vy: 0, dx: 0, dy: 0, sx: Z.x, sy: Z.y };
  } else if (ptrs.size === 2 && isImg()) {
    const [a, b] = Array.from(ptrs.values());
    const mx = (a.x + b.x) / 2 - rect.left - W / 2, my = (a.y + b.y) / 2 - rect.top - H / 2;
    g = { mode: 'pinch', d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), s0: Z.s, cx: (mx - Z.x) / Z.s, cy: (my - Z.y) / Z.s };
    lastTap = null;
  }
}

function move(e) {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (!g) return;
  if (g.mode === 'pinch') {
    if (ptrs.size < 2) return;
    const [a, b] = Array.from(ptrs.values());
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2 - rect.left - W / 2, my = (a.y + b.y) / 2 - rect.top - H / 2;
    const s = clamp(g.s0 * d / g.d0, 0.75, MAX_ZOOM);
    Z.s = s; Z.x = mx - s * g.cx; Z.y = my - s * g.cy;
    if (s >= 1) clampPan();
    applyZoom(false);
    return;
  }
  if (ptrs.size > 1) return;
  const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
  if (!g.mode) {
    if (Math.hypot(dx, dy) < 8) return;
    g.mode = Z.s > 1.02 ? 'pan' : (Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'pull');
    if (g.mode === 'pull' && !isImg()) g.mode = 'swipe';
  }
  const dt = e.timeStamp - g.lt;
  if (dt > 0) { g.vx = (e.clientX - g.lx) / dt; g.vy = (e.clientY - g.ly) / dt; g.lx = e.clientX; g.ly = e.clientY; g.lt = e.timeStamp; }
  if (g.mode === 'pan') {
    Z.x = g.sx + dx; Z.y = g.sy + dy;
    const mx = W * (Z.s - 1) / 2, my = H * (Z.s - 1) / 2;       // un poco de elasticidad más allá del borde
    const soft = (v, m) => (v > m ? m + (v - m) * 0.25 : v < -m ? -m + (v + m) * 0.25 : v);
    Z.x = soft(Z.x, mx); Z.y = soft(Z.y, my);
    applyZoom(false);
  } else if (g.mode === 'swipe') {
    let d = dx;
    if ((idx === 0 && d > 0) || (idx === items.length - 1 && d < 0)) d *= 0.3;     // resistencia en los extremos
    g.dx = d; setTrack(d, false);
  } else if (g.mode === 'pull') {
    g.dy = dy;
    const pane = paneEl(idx);
    pane.classList.remove('is-anim');
    pane.style.transform = 'translate3d(0,' + dy + 'px,0) scale(' + Math.max(0.6, 1 - Math.abs(dy) / 1400).toFixed(3) + ')';
    bd.style.opacity = String(Math.max(0, 1 - Math.abs(dy) / 360));
    root.classList.add('is-chrome-off');
  }
}

function tap(e) {
  if (items[idx].k === 'video') {                               // el ratón/dedo está "capturado" por el visor: reproducir/pausar a mano
    const v = paneEl(idx).querySelector('video');
    if (v) { if (v.paused) v.play().catch(() => {}); else v.pause(); }
    return;
  }
  if (!isImg()) return;                                         // iframe: sus controles se encargan
  const px = e.clientX - rect.left - W / 2, py = e.clientY - rect.top - H / 2;
  if (lastTap && e.timeStamp - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 32) {
    clearTimeout(tapTimer); lastTap = null;
    if (Z.s > 1.05) resetZoom(true); else zoomAt(px, py, DOUBLE_ZOOM, true);
    return;
  }
  lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  tapTimer = setTimeout(() => { lastTap = null; toggleChrome(); }, 280);
}

function up(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
  if (!g) return;
  if (g.mode === 'pinch') {
    if (ptrs.size >= 1) {                                       // queda un dedo: sigue como arrastre
      const r = Array.from(ptrs.values())[0];
      g = { mode: 'pan', x0: r.x, y0: r.y, t0: e.timeStamp, lx: r.x, ly: r.y, lt: e.timeStamp, vx: 0, vy: 0, dx: 0, dy: 0, sx: Z.x, sy: Z.y };
    } else {
      g = null;
      if (Z.s < 1.04) resetZoom(true); else { clampPan(); applyZoom(true); }
    }
    return;
  }
  if (ptrs.size > 0) return;
  const gg = g; g = null;
  if (!gg.mode) { if (e.type === 'pointerup' && e.timeStamp - gg.t0 < 400) tap(e); return; }
  if (gg.mode === 'swipe') {
    let next = idx;
    if ((gg.dx < -W * 0.18 || gg.vx < -0.45) && idx < items.length - 1) next = idx + 1;
    else if ((gg.dx > W * 0.18 || gg.vx > 0.45) && idx > 0) next = idx - 1;
    go(next, true);
  } else if (gg.mode === 'pull') {
    if (Math.abs(gg.dy) > 120 || Math.abs(gg.vy) > 0.7) { Layers.close('viewer'); }
    else {
      const pane = paneEl(idx);
      pane.classList.add('is-anim'); pane.style.transform = '';
      bd.style.transition = 'opacity .3s'; bd.style.opacity = '1';
      setTimeout(() => { bd.style.transition = ''; }, 320);
      root.classList.remove('is-chrome-off');
    }
  } else if (gg.mode === 'pan') { clampPan(); applyZoom(true); }
}

function wheel(e) {
  e.preventDefault();
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Z.s <= 1.01) {          // trackpad: deslizar de lado cambia de imagen
    if (Math.abs(e.deltaX) > 30 && e.timeStamp - wheelAt > 450) { wheelAt = e.timeStamp; go(idx + (e.deltaX > 0 ? 1 : -1), true); }
    return;
  }
  if (!isImg()) return;
  const px = e.clientX - rect.left - W / 2, py = e.clientY - rect.top - H / 2;
  const ns = clamp(Z.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018)), 1, MAX_ZOOM);
  zoomAt(px, py, ns < 1.03 ? 1 : ns, false);
}

function key(e) {
  if (!Layers.isOpen('viewer')) return;
  const k = e.key;
  if (k === 'ArrowRight') { e.preventDefault(); go(idx + 1, true); }
  else if (k === 'ArrowLeft') { e.preventDefault(); go(idx - 1, true); }
  else if ((k === '+' || k === '=') && isImg()) { e.preventDefault(); zoomAt(0, 0, Z.s * 1.5, true); }
  else if ((k === '-' || k === '_') && isImg()) { e.preventDefault(); zoomAt(0, 0, Z.s / 1.5 < 1.05 ? 1 : Z.s / 1.5, true); }
  else if (k === '0') { e.preventDefault(); resetZoom(true); }
}

/* ------------------------------------ API pública ------------------------------------ */
/**
 * list = [{tipo:'imagen'|'video', url, poster}]  ·  o = { title, cover:true (fondo blanco, p. ej. un QR) }
 */
export function openViewer(list, index, o) {
  o = o || {};
  if (!list || !list.length || Layers.isOpen('viewer')) return;
  items = list.map((m) => Object.assign(mediaKind(m), { title: o.title || '' }));
  idx = clamp(index || 0, 0, items.length - 1);
  ptrs.clear(); g = null; lastTap = null;
  root.classList.toggle('vw--single', items.length < 2);
  root.classList.toggle('vw--cover', !!o.cover);
  root.classList.remove('is-chrome-off', 'is-zoomed');
  bd.style.opacity = '1';
  track.innerHTML = items.map(slideHtml).join('');
  thumbs.innerHTML = items.map((it, i) =>
    '<button type="button" data-i="' + i + '" aria-label="' + (i + 1) + '">' +
    (it.thumb ? '<img src="' + esc(it.thumb) + '" alt="" loading="lazy" decoding="async">' : '') +
    (it.k === 'img' ? '' : ic('play')) + '</button>').join('');
  Layers.open('viewer', { onClose: cleanup, noFocus: true });
  document.documentElement.classList.add('vw-on');          // lo que queda debajo se deja de dibujar (ver styles.css)
  measure();
  Z.s = 1; Z.x = 0; Z.y = 0;
  setTrack(0, false);
  activate(); updateChrome(); resetB.disabled = true;
  const first = track.children[idx];
  if (first) anim(first, [{ transform: 'scale(.9)', opacity: 0.2 }, { transform: 'none', opacity: 1 }], { duration: 520 });
  hint.classList.remove('is-off');
  clearTimeout(hintTimer); hintTimer = setTimeout(() => hint.classList.add('is-off'), 3800);
}

function cleanup() {
  document.documentElement.classList.remove('vw-on');
  clearTimeout(tapTimer); clearTimeout(hintTimer);
  ptrs.clear(); g = null;
  $$('video', track).forEach((v) => { try { v.pause(); } catch (e) { /* noop */ } });
  $$('iframe', track).forEach((f) => f.removeAttribute('src'));
  setTimeout(() => { if (!Layers.isOpen('viewer')) { track.innerHTML = ''; thumbs.innerHTML = ''; bd.style.opacity = '1'; } }, 450);
}

export function initViewer() {
  root = $('#viewer'); stage = $('#vwStage'); track = $('#vwTrack'); bd = $('#vwBd'); capEl = $('#vwCap');
  thumbs = $('#vwThumbs'); hint = $('#vwHint'); prevB = $('#vwPrev'); nextB = $('#vwNext'); resetB = $('#vwReset');
  stage.addEventListener('pointerdown', down);
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', wheel, { passive: false });
  stage.addEventListener('dblclick', (e) => e.preventDefault());
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  prevB.addEventListener('click', () => go(idx - 1, true));
  nextB.addEventListener('click', () => go(idx + 1, true));
  resetB.addEventListener('click', () => resetZoom(true));
  thumbs.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) go(Number(b.dataset.i), true); });
  document.addEventListener('keydown', key);
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (Layers.isOpen('viewer')) { measure(); setTrack(0, false); clampPan(); applyZoom(false); } }, 100); });
  ready = true;
}
export const viewerReady = () => ready;
void t;
