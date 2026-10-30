/* ==========================================================================
   AOS · BUSCADOR FLOTANTE
   - Un botón (ícono de lupa, en el menú FAB) muestra/oculta una caja de texto flotante.
   - En móvil la caja se coloca EXACTAMENTE encima del teclado virtual: se mide con
     window.visualViewport (alto visible − teclado) y se desplaza con translate3d.
   - Micrófono: SpeechRecognition / webkitSpeechRecognition del propio navegador (voz → texto, es-BO).
   - Filtrado nativo y local: Array.prototype.filter() + String.prototype.includes() sobre el
     catálogo ya descargado (sin llamar al servidor). Normaliza mayúsculas y tildes.
   ========================================================================== */
import { $, esc, debounce, fold } from '../util.js';
import { S, t, money, cover, catName } from '../store.js';
import { toast } from './toast.js';
import { Layers } from './layers.js';

let box, input, list, count, mic, form;
let opts = {};
let isOn = false;
let results = null;
let rec = null, listening = false;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

const SHOW = 8;

/** Normaliza lo escrito en palabras sueltas: "camisa  LINO" → ["camisa","lino"]. */
export const tokens = (q) => fold(q).split(/\s+/).filter(Boolean);

/** Filtro del catálogo. TODAS las palabras deben aparecer (en nombre, descripción, sección, etiqueta o código). */
export function filterProducts(q, products) {
  const tk = tokens(q);
  if (!tk.length) return null;
  return (products || S.products)
    .filter((p) => tk.every((w) => p._q.includes(w)))
    .sort((a, b) => Number(!fold(a.nombre).includes(tk[0])) - Number(!fold(b.nombre).includes(tk[0])));
}

function hl(name, tk) {
  const f = fold(name);
  if (f.length !== name.length) return esc(name);
  const mark = new Array(name.length).fill(false);
  tk.forEach((w) => { let i = f.indexOf(w); while (i >= 0) { for (let k = i; k < i + w.length; k++) mark[k] = true; i = f.indexOf(w, i + w.length); } });
  let out = '', open = false;
  for (let i = 0; i < name.length; i++) {
    if (mark[i] && !open) { out += '<mark>'; open = true; }
    if (!mark[i] && open) { out += '</mark>'; open = false; }
    out += esc(name[i]);
  }
  return out + (open ? '</mark>' : '');
}

function render(q) {
  const tk = tokens(q);
  list.innerHTML = '';
  if (!results) { count.textContent = ''; return; }
  count.textContent = t('texto_buscar_resultados', { n: results.length });
  if (!results.length) {
    list.innerHTML = '<li class="search__empty">' + esc(t('texto_buscar_vacio', { q: q.trim() })) + '</li>';
    return;
  }
  list.innerHTML = results.slice(0, SHOW).map((p) =>
    '<li role="option"><button type="button" data-id="' + esc(p.id) + '">' +
    '<img src="' + esc(cover(p)) + '" alt="" loading="lazy" decoding="async">' +
    '<span class="search__t"><b>' + hl(p.nombre, tk) + '</b><small>' + esc(catName(p.cat)) + (p.etiqueta ? ' · ' + esc(p.etiqueta) : '') + '</small></span>' +
    '<span>' + money(p.precio) + '</span></button></li>').join('');
}

function run() {
  const q = input.value;
  results = filterProducts(q);
  render(q);
  if (opts.onFilter) opts.onFilter(results ? results.map((p) => p.id) : null);
  if (results && opts.onQuery) opts.onQuery(q.trim(), results.length);
}
const runSoon = debounce(run, 70);
const logSoon = debounce(() => { if (results && opts.onSearched) opts.onSearched(input.value.trim(), results.length); }, 1200);

/* ----------------------------- teclado virtual ----------------------------- */
function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv || !box) return;
  const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  const up = kb > 80;
  box.classList.toggle('is-kb', up);
  box.style.transform = up ? 'translate3d(0,' + (-kb) + 'px,0)' : '';
  document.documentElement.style.setProperty('--kb', kb + 'px');
}

/* ------------------------------------ voz ------------------------------------ */
function setListening(on) {
  listening = on;
  mic.classList.toggle('is-listening', on);
  mic.setAttribute('aria-pressed', String(on));
  input.placeholder = on ? t('texto_buscar_voz') : t('texto_buscar_placeholder');
}
function startVoice() {
  if (!SR) return;
  if (listening) { try { rec.stop(); } catch (e) { /* noop */ } return; }
  try {
    rec = new SR();
    rec.lang = S.cfg.voz_idioma || 'es-BO';
    rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let txt = '';
      for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript;
      // acumula lo anterior de esta sesión de dictado
      input.value = txt.trim();
      run(); logSoon();
    };
    rec.onerror = (e) => {
      const err = e && e.error;
      if (err === 'not-allowed' || err === 'service-not-allowed') toast(t('texto_voz_permiso'), { err: true, ttl: 4200 });
      else if (err !== 'no-speech' && err !== 'aborted') toast(t('texto_voz_error'), { err: true });
    };
    rec.onend = () => setListening(false);
    rec.start();
    setListening(true);
  } catch (e) { setListening(false); toast(t('texto_voz_error'), { err: true }); }
}

/* --------------------------------- abrir / cerrar --------------------------------- */
export function open() {
  if (isOn) { input.focus(); return; }
  isOn = true;
  box.classList.add('is-on');
  box.setAttribute('aria-hidden', 'false');
  trackKeyboard();
  try { input.focus({ preventScroll: true }); } catch (e) { /* noop */ }
}
export function close() {
  if (!isOn) return;
  isOn = false;
  if (listening && rec) { try { rec.abort(); } catch (e) { /* noop */ } }
  setListening(false);
  box.classList.remove('is-on', 'is-kb');
  box.style.transform = '';
  box.setAttribute('aria-hidden', 'true');
  input.blur();
  input.value = ''; results = null; render('');
  if (opts.onFilter) opts.onFilter(null);
}
export const toggle = () => (isOn ? close() : open());
export const isOpen = () => isOn;

export function init(o) {
  opts = o || {};
  box = $('#search'); input = $('#searchIn'); list = $('#searchList'); count = $('#searchCount'); mic = $('#searchMic'); form = $('#searchForm');
  box.setAttribute('aria-hidden', 'true');
  mic.hidden = !SR;                                         // sin SpeechRecognition no se muestra el micrófono
  input.addEventListener('input', () => { runSoon(); logSoon(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run();
    if (results && results.length && opts.onPick) { input.blur(); opts.onPick(results[0].id, { fly: true }); }
  });
  $('#searchX').addEventListener('click', close);
  mic.addEventListener('click', startVoice);
  list.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    input.blur();
    if (opts.onPick) opts.onPick(b.dataset.id, { open: true });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOn && !Layers.top()) { e.preventDefault(); close(); }
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', trackKeyboard);
    window.visualViewport.addEventListener('scroll', trackKeyboard);
  }
  input.addEventListener('focus', () => { trackKeyboard(); setTimeout(trackKeyboard, 250); setTimeout(trackKeyboard, 600); });
  input.addEventListener('blur', () => setTimeout(trackKeyboard, 120));
}
