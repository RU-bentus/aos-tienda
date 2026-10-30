/* ==========================================================================
   AOS · TEMA. Traduce la hoja `Configuracion` a:
     1) variables CSS en :root  (--cta-color, --modal-width, --font-size-base, --hero-bg-url …)
     2) textos, placeholders y etiquetas del DOM ([data-cfg], [data-cfg-ph], [data-cfg-aria])
     3) hero (posición, imagen), título de la pestaña y fuentes de Google
   No cambia la maquetación: solo reemplaza valores. El diseño de fábrica sale de styles.css.
   ========================================================================== */
import { DEFAULTS } from './defaults.js';
import { $, $$, rgbOf } from './util.js';

/** clave de la hoja → variable CSS de :root (valores "tal cual") */
const VAR_MAP = {
  color_primario: '--ink',
  color_secundario: '--acc',
  color_cta: '--cta-color',
  color_texto_cta: '--cta-ink',
  color_fondo: '--paper',
  color_fondo_alt: '--paper-2',
  color_texto_suave: '--mute',
  color_exito: '--ok',
  color_whatsapp: '--wa',
  tamano_letra_base: '--font-size-base',
  tamano_letra_titulos: '--font-size-title',
  tamano_letra_botones: '--font-size-btn',
  tamano_letra_menu: '--font-size-menu',
  curva_animacion: '--ease',
  duracion_transicion: '--dur',
  dimension_modal_ancho: '--modal-width',
  dimension_modal_alto: '--modal-height',
  dimension_modal_producto_margen: '--pm-margin',
  dimension_carrito_ancho: '--panel-width',
  dimension_boton_alto: '--btn-height',
  dimension_boton_padding: '--btn-padding',
};

/** nombre de fuente + pila de respaldo */
const FONT_MAP = {
  fuente_principal: ['--font-sans', "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"],
  fuente_titulos: ['--font-serif', "Georgia, 'Times New Roman', serif"],
  fuente_manuscrita: ['--font-hand', "'Marker Felt', 'Segoe Print', 'Comic Sans MS', cursive"],
};

function get(cfg, k) {
  const v = cfg[k];
  return v === undefined || v === null || v === '' ? DEFAULTS[k] : v;
}

/** Luminancia relativa (0 negro … 1 blanco) de "r, g, b". */
function luminance(rgb) {
  const [r, g, b] = String(rgb).split(',').map((x) => Number(x) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

let lastFontsHref = '';

export function applyConfig(cfg) {
  cfg = cfg || {};
  const root = document.documentElement.style;
  const set = (k, v) => { if (root.getPropertyValue(k) !== v) root.setProperty(k, v); };

  // 1) variables CSS ---------------------------------------------------------
  Object.keys(VAR_MAP).forEach((k) => set(VAR_MAP[k], String(get(cfg, k))));
  Object.keys(FONT_MAP).forEach((k) => {
    const f = String(get(cfg, k)).replace(/['"\\;{}]/g, '');
    set(FONT_MAP[k][0], "'" + f + "', " + FONT_MAP[k][1]);
  });

  // derivados RGB (para sombras translúcidas) y contraste automático del texto del CTA
  const inkRgb = rgbOf(get(cfg, 'color_primario'), '13, 13, 13');
  const accRgb = rgbOf(get(cfg, 'color_secundario'), '218, 83, 44');
  const ctaRgb = rgbOf(get(cfg, 'color_cta'), '218, 83, 44');
  set('--ink-rgb', inkRgb); set('--acc-rgb', accRgb); set('--cta-rgb', ctaRgb);
  // si el dueño no tocó el color del texto del botón y el fondo del CTA es claro, se usa tinta oscura (legibilidad)
  const ctaInk = String(get(cfg, 'color_texto_cta')).toLowerCase() === String(DEFAULTS.color_texto_cta).toLowerCase() && luminance(ctaRgb) > 0.55
    ? get(cfg, 'color_primario') : get(cfg, 'color_texto_cta');
  set('--cta-ink', String(ctaInk));

  // imágenes de fondo ----------------------------------------------------------
  const safeUrl = (u) => (/^https:\/\/[^\s"'<>()\\]+$/i.test(String(u || '')) ? String(u) : '');
  const heroBg = safeUrl(cfg.link_fondo_hero), catBg = safeUrl(cfg.link_fondo_catalogo);
  set('--hero-bg-url', heroBg ? 'url("' + heroBg + '")' : 'none');
  set('--catalog-bg-url', catBg ? 'url("' + catBg + '")' : 'none');

  // 2) fuentes de Google ------------------------------------------------------
  const fonts = String(get(cfg, 'fuentes_google_url'));
  if (fonts && fonts !== lastFontsHref && /^https:\/\/fonts\.googleapis\.com\//.test(fonts)) {
    const link = $('#gfonts');
    if (link && link.getAttribute('href') !== fonts) { link.href = fonts; link.media = 'all'; }
    lastFontsHref = fonts;
  }

  // 3) hero ------------------------------------------------------------------
  const pos = String(get(cfg, 'ubicacion_banner_hero'));
  const on = String(get(cfg, 'hero_activo')).toUpperCase() !== 'NO';
  $$('.hero').forEach((h) => {
    h.dataset.pos = pos;
    h.classList.toggle('has-bg', !!heroBg);
  });
  const hero = $('#hero'), skel = $('#heroSkel');
  if (hero) hero.hidden = !on || !hero.dataset.ready;
  if (skel && !on) skel.remove();

  // 4) título, color de la barra del navegador ---------------------------------
  const store = String(get(cfg, 'titulo_tienda'));
  document.title = store + ' — ' + String(get(cfg, 'texto_titulo_pestana'));
  const m = $('meta[name="theme-color"]'); if (m) m.setAttribute('content', String(get(cfg, 'color_fondo')));
  const a = $('meta[name="apple-mobile-web-app-title"]'); if (a) a.setAttribute('content', store);

  applyTexts(document, cfg);
}

/** Pone los textos de la hoja en los nodos marcados con data-cfg*. Solo escribe si cambió (sin parpadeo ni reflujo). */
export function applyTexts(scope, cfg) {
  scope = scope || document;
  const val = (k) => String(get(cfg || {}, k));
  $$('[data-cfg]', scope).forEach((el) => {
    const v = val(el.dataset.cfg);
    if (el.textContent !== v) el.textContent = v;
  });
  $$('[data-cfg-ph]', scope).forEach((el) => { const v = val(el.dataset.cfgPh); if (el.placeholder !== v) el.placeholder = v; });
  $$('[data-cfg-aria]', scope).forEach((el) => { const v = val(el.dataset.cfgAria); if (el.getAttribute('aria-label') !== v) el.setAttribute('aria-label', v); });
  $$('[data-cfg-title]', scope).forEach((el) => { const v = val(el.dataset.cfgTitle); if (el.title !== v) el.title = v; });
}

/** Muestra la portada real y retira el esqueleto (misma geometría: CLS 0). */
export function revealHero(cfg) {
  const hero = $('#hero'), skel = $('#heroSkel');
  if (hero) hero.dataset.ready = '1';
  applyConfig(cfg);
  if (!hero || hero.hidden) { if (skel) skel.remove(); return; }
  const card = $('.hero__card', hero);
  card.style.opacity = '0';
  void card.offsetWidth;
  card.style.opacity = '';
  if (skel) {
    skel.classList.add('is-off');
    setTimeout(() => skel.remove(), 620);
  }
}
