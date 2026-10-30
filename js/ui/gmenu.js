/* ==========================================================================
   AOS · MENÚ FAB "GOOEY" (arriba-izquierda, apertura radial)

   - Botón principal fijo en top:20px / left:20px. Al abrir gira 45° y se vuelve una "×".
   - Botones secundarios: buscar · [S-M] · [L-XL] · [PLUS-SIZE] · [CONTACTO] · ubicación (solo ícono).
     Salen en un CUARTO DE CÍRCULO hacia la derecha y hacia abajo.
   - Efecto viscoso: las burbujas (formas planas, capa #gmGoo) pasan por el filtro SVG #gooey
     (feGaussianBlur stdDeviation=10 + feColorMatrix 1 0 0 0 0 … 0 0 0 18 -7). Los íconos y textos van
     en OTRA capa (#gmUi), sin filtro, para que se vean nítidos.
   - Todo el movimiento es transform: translate3d + scale (GPU), con la curva de la tienda.
   ========================================================================== */
import { $, esc, ic, reduceMotion } from '../util.js';
import { S, t } from '../store.js';

const MAIN_R = 28;          // radio del botón principal
const GAP = 7;              // separación mínima entre burbujas
const ICON = 50;            // tamaño de las burbujas con solo ícono
const PILL_H = 42;          // alto de las burbujas con texto

let nav, goo, ui, main, veil, onSearch = () => {}, onCat = () => {};
let items = [];             // [{el, blob, kind, id}]
let open = false;

/** Ancho de una burbuja con texto, medido con la fuente real. */
function measure(label) {
  const probe = document.createElement('span');
  probe.className = 'gm-btn gm-btn--label';
  // transform:none → el botón cerrado vive con scale(.35); getBoundingClientRect() mediría el texto encogido
  probe.style.cssText = 'position:absolute;visibility:hidden;width:auto;height:auto;left:-999px;top:0;margin:0;opacity:0;transition:none;transform:none;padding:0 16px';
  probe.textContent = label;
  ui.appendChild(probe);
  const w = Math.ceil(probe.offsetWidth);
  probe.remove();
  return Math.max(ICON + 12, w + 6);
}

/**
 * Coloca las burbujas a lo largo de un cuarto de círculo (0° = derecha, 90° = abajo).
 * Voraz: para cada radio R recorre el arco y pone cada burbuja en el primer ángulo donde no choca con
 * las anteriores ni con el botón principal ni se sale de la pantalla. Si no caben, prueba un R mayor.
 */
export function arrange(sizes, margin) {
  margin = margin === undefined ? 40 : margin;          // distancia del centro del botón principal al borde de la pantalla (menos 8px)
  const rad = Math.PI / 180;
  for (let R = 88; R <= 300; R += 4) {
    const pos = [];
    let th = 0, ok = true;
    for (let i = 0; i < sizes.length && ok; i++) {
      const s = sizes[i];
      let placed = false;
      for (; th <= 90.001; th += 0.5) {
        const x = R * Math.cos(th * rad), y = R * Math.sin(th * rad);
        if (x < s.w / 2 - margin || y < s.h / 2 - margin) break;       // se saldría de la pantalla: este R no sirve
        const nx = Math.max(Math.abs(x) - s.w / 2, 0), ny = Math.max(Math.abs(y) - s.h / 2, 0);
        if (Math.hypot(nx, ny) < MAIN_R + GAP) continue;                // pisa el botón principal
        let clash = false;
        for (let j = 0; j < pos.length; j++) {
          const p = pos[j];
          if (Math.abs(x - p.x) < (s.w + p.w) / 2 + GAP && Math.abs(y - p.y) < (s.h + p.h) / 2 + GAP) { clash = true; break; }
        }
        if (clash) continue;
        pos.push({ x, y, w: s.w, h: s.h, th });
        placed = true; th += 0.5;
        break;
      }
      if (!placed) ok = false;
    }
    if (ok) return { R, pos };
  }
  // último recurso (pantallas diminutas): una columna hacia abajo
  return { R: 0, pos: sizes.map((s, i) => ({ x: Math.max(0, s.w / 2 - margin), y: 62 + i * (s.h + GAP), w: s.w, h: s.h, th: 90 })) };
}

function mkItem(spec, i, n) {
  const isLink = spec.kind === 'loc';
  const el = document.createElement(isLink ? 'a' : 'button');
  el.className = 'gm-btn' + (spec.label ? ' gm-btn--label' : '');
  if (isLink) { el.href = spec.href || '#'; el.target = '_blank'; el.rel = 'noopener'; } else el.type = 'button';
  el.dataset.kind = spec.kind;
  if (spec.id) el.dataset.cat = spec.id;
  el.tabIndex = -1;                                          // se activa al abrir
  if (spec.aria) el.setAttribute('aria-label', spec.aria);
  el.innerHTML = spec.icon ? ic(spec.icon) : esc(spec.label);
  if (spec.title) el.title = spec.title;
  const blob = document.createElement('span');
  blob.className = 'gm-blob';
  return { el, blob, kind: spec.kind, id: spec.id, spec, i, n };
}

/** (Re)construye las burbujas con las categorías actuales. */
export function build(cats) {
  items.forEach((it) => { it.el.remove(); it.blob.remove(); });
  items = [];
  const specs = [{ kind: 'search', icon: 'search', aria: t('texto_menu_buscar'), title: t('texto_menu_buscar') }];
  (cats || []).forEach((c) => specs.push({ kind: 'cat', id: c.id, label: '[' + c.nombre + ']', aria: c.nombre }));
  specs.push({ kind: 'loc', icon: 'pin', href: S.cfg.url_ubicacion, aria: t('texto_menu_ubicacion'), title: t('texto_menu_ubicacion') });

  items = specs.map((sp, i) => mkItem(sp, i, specs.length));
  items.forEach((it) => { goo.appendChild(it.blob); ui.appendChild(it.el); });
  place();
}

function place() {
  const sizes = items.map((it) => (it.spec.label ? { w: measure(it.spec.label), h: PILL_H } : { w: ICON, h: ICON }));
  // el margen real: posición del botón principal respecto al borde de la pantalla
  const r = main.getBoundingClientRect();
  const margin = Math.max(20, r.left + MAIN_R - 8);
  const { pos } = arrange(sizes, margin);
  let maxX = 0, maxY = 0;
  const n = items.length;
  items.forEach((it, i) => {
    const p = pos[i];
    maxX = Math.max(maxX, p.x + p.w / 2); maxY = Math.max(maxY, p.y + p.h / 2);
    [it.el, it.blob].forEach((e) => {
      e.style.setProperty('--w', p.w + 'px'); e.style.setProperty('--h', p.h + 'px');
      e.style.setProperty('--tx', p.x.toFixed(1) + 'px'); e.style.setProperty('--ty', p.y.toFixed(1) + 'px');
      e.style.setProperty('--od', (reduceMotion ? 0 : 40 + i * 55) + 'ms');          // retardo al abrir (escalonado)
      e.style.setProperty('--rd', (reduceMotion ? 0 : (n - 1 - i) * 35) + 'ms');       // retardo al cerrar (inverso)
    });
  });
  // la capa filtrada debe cubrir todas las burbujas + el desenfoque del filtro (≈3σ = 30px)
  const W = 40 + MAIN_R + maxX + 50, H = 40 + MAIN_R + maxY + 50;
  nav.style.setProperty('--gm-w', Math.ceil(W) + 'px');
  nav.style.setProperty('--gm-h', Math.ceil(H) + 'px');
}

export function isOpen() { return open; }

export function setOpen(on, opt) {
  on = !!on;
  if (on === open) return;
  open = on;
  nav.classList.toggle('is-open', on);
  veil.classList.toggle('is-on', on);
  main.setAttribute('aria-expanded', String(on));
  main.setAttribute('aria-label', t(on ? 'texto_menu_cerrar' : 'texto_menu_abrir'));
  items.forEach((it) => { it.el.tabIndex = on ? 0 : -1; });
  if (!on && opt && opt.focus) { try { main.focus({ preventScroll: true }); } catch (e) { /* noop */ } }
}
export const toggle = () => setOpen(!open);
export const close = () => setOpen(false);

export function setActive(id) {
  items.forEach((it) => {
    const on = it.kind === 'cat' && it.id === id;
    it.el.setAttribute('aria-current', on ? 'true' : 'false');
    it.blob.classList.toggle('is-hot', on);
  });
}

export function init(opts) {
  opts = opts || {};
  onSearch = opts.onSearch || onSearch; onCat = opts.onCat || onCat;
  nav = $('#gmenu'); goo = $('#gmGoo'); ui = $('#gmUi'); main = $('#gmMain'); veil = $('#gmVeil');

  main.addEventListener('click', () => toggle());
  veil.addEventListener('click', () => setOpen(false));
  ui.addEventListener('click', (e) => {
    const b = e.target.closest('.gm-btn');
    if (!b || b === main) return;
    const kind = b.dataset.kind;
    if (kind === 'search') { setOpen(false); onSearch(); }
    else if (kind === 'cat') { setOpen(false); onCat(b.dataset.cat); }
    else if (kind === 'loc') { setOpen(false); }          // el enlace abre Google Maps por sí mismo
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false, { focus: true }); } }, true);
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(place, 150); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (items.length) place(); });
}
