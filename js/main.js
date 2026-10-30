/* ==========================================================================
   AOS · ARRANQUE (punto de entrada). Orquesta los módulos; no contiene lógica de negocio.

   Capas (cada una en su archivo):
     api.js ........ red: habla con Google Apps Script (doGet / doPost)
     store.js ...... estado: catálogo, carrito, favoritos, cupón, envío (sin DOM)
     theme.js ...... hoja `Configuracion` → variables CSS en :root + textos del DOM
     views/*.js .... DOM: tarjetas, dock, producto, visor, carrito, listas, checkout
     canvas.js ..... cámara 2D, parallax en rAF, WebGL
     offline.js .... Service Worker, copia del catálogo y cola de pedidos

   Flujo: DOMContentLoaded → se pintan esqueletos (HTML) → fetch del catálogo (o copia local) →
   se reemplazan los esqueletos por los nodos reales (misma geometría: CLS = 0).
   ========================================================================== */
import { APP } from './config.js';
import { api } from './api.js';
import { S, bus, t, loadLocal, setCatalog, patchCatalog, prod } from './store.js';
import { applyConfig, revealHero } from './theme.js';
import { Canvas } from './canvas.js';
import { CatalogCache, registerSW, initNet, flushQueue } from './offline.js';
import { Log, initRemote, mergeServerFavorites } from './remote.js';
import { Layers, onBlock } from './ui/layers.js';
import * as Gmenu from './ui/gmenu.js';
import * as Search from './ui/search.js';
import { toast } from './ui/toast.js';
import { initWorld, buildWorld, dropSkeleton, updateTile } from './views/world.js';
import { initDock, build as buildDock, refreshChip } from './views/dock.js';
import { initProduct } from './views/product.js';
import { initViewer } from './views/viewer.js';
import { initCart } from './views/cart.js';
import { initLists } from './views/lists.js';
import { initCheckout } from './views/checkout.js';
import { bindGlobalClicks, ui, addToCart, favToggle, cmpToggle } from './actions.js';
import { startDrag, bindChipDrag } from './dragcart.js';
import { $, esc, clamp, isTouch, reduceMotion } from './util.js';

let presented = false, fetching = false, lastFetch = 0, canvasReady = false, hintTimer = 0;

/* ------------------------------------- contadores ------------------------------------- */
function refreshCounts() {
  let n = 0; S.cart.forEach((q) => { n += q; });
  const set = (id, v) => { const el = $(id); if (el) { el.textContent = v; el.dataset.n = v; } };
  set('#fabN', n); set('#favN', S.favs.size); set('#cmpN', S.compare.length);
  const fab = $('#fab'); if (fab) fab.setAttribute('aria-label', t('texto_carrito') + ' (' + n + ')');
  const df = $('#dockFav'); if (df) df.classList.toggle('has-n', S.favs.size > 0);
}

/* --------------------------------------- pista --------------------------------------- */
function hideHint() { const h = $('#hint'); if (h) h.classList.remove('is-show'); clearTimeout(hintTimer); }
function showHint() {
  const h = $('#hint');
  h.textContent = t(isTouch ? 'texto_hint_tactil' : 'texto_hint_escritorio');
  h.classList.add('is-show');
  clearTimeout(hintTimer); hintTimer = setTimeout(hideHint, 14000);
}

/* ------------------------------ parallax de la portada (rAF) ------------------------------ */
function heroParallax(cam) {
  if (reduceMotion) return;
  const card = $('#heroCard');
  if (!card || $('#hero').hidden) return;
  const x = clamp(-cam.x * 0.02, -36, 36), y = clamp(-cam.y * 0.045, -52, 52);
  card.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
}

/* ----------------------------------- presentar catálogo ----------------------------------- */
function initCanvasOnce() {
  if (canvasReady) return;
  canvasReady = true;
  Canvas.init({
    onAction(act, id) {
      if (act === 'open') ui.product(id);
      else if (act === 'fav') favToggle(id);
      else if (act === 'cmp') cmpToggle(id);
      else if (act === 'cart') addToCart(id, 1, { src: 'tile' });
    },
    onLongPress: (info) => startDrag(info),
    onActiveRegion: (id) => Gmenu.setActive(id),
    onFirstInteract: hideHint,
    onFrame: heroParallax,
  });
  onBlock((b) => Canvas.setBlocked(b));
}

/** Primera vez: reemplaza los esqueletos por los nodos reales. */
function present(res) {
  setCatalog(res);
  applyConfig(S.cfg);
  revealHero(S.cfg);
  Gmenu.build(S.cats);
  initCanvasOnce();
  buildWorld();
  buildDock();
  dropSkeleton();
  refreshCounts();
  showHint();
  if (S.demo && !$('#demoTag')) {
    const tag = document.createElement('div');
    tag.id = 'demoTag'; tag.className = 'demo-tag'; tag.textContent = t('texto_demo');
    document.body.appendChild(tag);
  }
  const f = $('#fatal'); if (f) f.remove();
  presented = true;
  Log.push('session', '', JSON.stringify({ ua: navigator.userAgent, lang: navigator.language, w: window.innerWidth, demo: S.demo }));
  mergeServerFavorites();
}

/** Actualización silenciosa: conserva la vista, el carrito y los modales abiertos. */
function revalidate(res) {
  const r = patchCatalog(res);
  if (r.configChanged) { applyConfig(S.cfg); Gmenu.build(S.cats); }
  if (r.structural) { buildWorld({ keepCamera: true }); buildDock(); }
  refreshCounts();
}

function showFatal(err) {
  if ($('#fatal')) return;
  const offline = navigator.onLine === false || (err && err.kind === 'network');
  const el = document.createElement('div');
  el.id = 'fatal'; el.className = 'fatal'; el.setAttribute('role', 'alert');
  el.innerHTML = '<h3>' + (offline ? 'Sin conexión' : 'No pudimos cargar el catálogo') + '</h3>' +
    '<p>' + esc(offline ? 'Conéctate a internet una vez para descargar el catálogo; después podrás explorarlo sin conexión.' : (err && err.message) || 'Inténtalo de nuevo.') + '</p>' +
    '<button type="button" class="btn btn--ink">Reintentar</button>';
  $('button', el).addEventListener('click', () => { el.remove(); loadFresh(); });
  document.body.appendChild(el);
}

/** Si la lectura fresca falla estando ya la copia guardada en pantalla, se reintenta sola (4 s, 12 s, 30 s, 90 s). */
const RETRY_MS = [4000, 12000, 30000, 90000];
let retryTimer = 0, retries = 0;

async function loadFresh() {
  if (fetching) return;
  clearTimeout(retryTimer);
  fetching = true;
  try {
    // con la copia local ya visible no hay prisa: se da más margen (un equipo lento puede tardar en procesar la respuesta)
    const res = await api.catalog(presented ? { timeout: 30000 } : undefined);
    lastFetch = Date.now(); retries = 0;
    if (!api.demo) CatalogCache.write(res);
    if (presented) revalidate(res); else present(res);
  } catch (e) {
    if (!presented) showFatal(e);
    else if (retries < RETRY_MS.length && navigator.onLine !== false) retryTimer = setTimeout(loadFresh, RETRY_MS[retries++]);
  } finally { fetching = false; }
}

/* ------------------------------------------ red ------------------------------------------ */
function initNetwork() {
  const net = $('#net'), span = $('span', net);
  let okTimer = 0;
  const say = (key, ok) => { span.dataset.cfg = key; span.textContent = t(key); net.classList.toggle('is-ok', !!ok); };
  initNet({
    onChange(on) {
      clearTimeout(okTimer);
      if (!on) { say('texto_offline', false); net.classList.add('is-on'); }
      else if (net.classList.contains('is-on')) {
        say('texto_online_ok', true);
        okTimer = setTimeout(() => { net.classList.remove('is-on'); }, 2400);
      }
    },
    onOnline() { loadFresh(); Log.flush(); },
  });
  bus.on('queue:failed', ({ error }) => toast(error, { err: true, ttl: 6000 }));
}

/* ----------------------------------------- arranque ----------------------------------------- */
async function boot() {
  loadLocal();
  applyConfig(S.cfg);                     // valores de fábrica: idénticos al CSS, así no hay parpadeo

  // Vistas y eventos que no dependen de los datos
  initWorld(); initDock(); initProduct(); initViewer(); initCart(); initLists(); initCheckout(); initRemote();
  bindGlobalClicks(); bindChipDrag();
  ['cart', 'favs', 'cmp', 'catalog'].forEach((ev) => bus.on(ev, refreshCounts));
  bus.on('catalog', (e) => {
    if (e && !e.fresh) (e.changed || []).forEach((id) => { const p = prod(id); if (p) { updateTile(p); refreshChip(p); } });
  });
  bus.on('ui:refresh', () => loadFresh());
  Gmenu.init({ onSearch: () => Search.toggle(), onCat: (id) => { Canvas.flyToRegion(id); hideHint(); } });
  Gmenu.build([]);                        // el menú ya responde (buscar + ubicación) mientras llega el catálogo
  Search.init({
    onFilter: (ids) => Canvas.setFilter(ids),
    onPick: (id, o) => { Canvas.flyToItem(id); hideHint(); if (o && o.open) setTimeout(() => ui.product(id), 380); },
    onSearched: (q, n) => Log.push('search', q, String(n)),
  });
  initNetwork();

  await api.init();
  S.demo = api.demo;
  registerSW();

  // Catálogo: primero la copia guardada (si existe) y después la versión fresca (stale-while-revalidate)
  const cached = api.demo ? null : await CatalogCache.read();
  if (cached) present(cached.data);
  loadFresh();
  flushQueue();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && presented && Date.now() - lastFetch > 10 * 60 * 1000) loadFresh();
  });
  window.AOS = { S, bus, api, Canvas, Layers, Search, Gmenu, ui, version: 2, APP };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
