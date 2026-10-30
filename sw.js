/* ==========================================================================
   AOS · SERVICE WORKER (PWA / modo offline)

   ¿Por qué es un archivo y no un Blob?  Los navegadores NO permiten registrar un Service
   Worker desde una URL blob: ni data: (probado en Chromium: "The URL protocol of the script
   is not supported"). Un Service Worker debe venir de una URL real del mismo origen, así
   que vive en este archivo, junto a index.html.

   Estrategias
     · Cascarón (HTML/CSS/JS/iconos) .... precargado al instalar; se sirve del caché y se
                                          actualiza en segundo plano (stale-while-revalidate).
     · Navegación ....................... red primero; sin red, el index.html guardado.
     · Fuentes e imágenes de terceros ... caché primero + actualización en segundo plano.
     · API de Apps Script ............... NUNCA se intercepta: el catálogo y los pedidos los
                                          gestiona la app (IndexedDB + cola de pedidos).
   ========================================================================== */
const VERSION = 'aos-v2.0.0';           // ⬅ súbela cuando cambies archivos para forzar la actualización
const SHELL = VERSION + '-shell';
const MEDIA = VERSION + '-media';
const MEDIA_MAX = 160;                  // máximo de imágenes/fuentes guardadas

const PRECACHE = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'js/main.js', 'js/config.js', 'js/defaults.js', 'js/api.js', 'js/storage.js', 'js/store.js', 'js/util.js',
  'js/theme.js', 'js/canvas.js', 'js/offline.js', 'js/remote.js', 'js/demo.js', 'js/actions.js',
  'js/dragcart.js', 'js/media.js', 'js/whatsapp.js',
  'js/ui/gmenu.js', 'js/ui/layers.js', 'js/ui/search.js', 'js/ui/toast.js',
  'js/views/cart.js', 'js/views/checkout.js', 'js/views/dock.js', 'js/views/lists.js',
  'js/views/product.js', 'js/views/viewer.js', 'js/views/world.js',
];

/* Dominios de la API de Google Apps Script: no se tocan */
const API_HOSTS = /(^|\.)script\.google\.com$|(^|\.)script\.googleusercontent\.com$/;
const FONT_HOSTS = /(^|\.)fonts\.googleapis\.com$|(^|\.)fonts\.gstatic\.com$/;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // addAll falla entero si un archivo falta; se guardan uno a uno para no bloquear la instalación
    await Promise.all(PRECACHE.map(async (u) => {
      try { await cache.add(new Request(u, { cache: 'reload' })); } catch (e) { /* archivo opcional ausente */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, MEDIA]);
    for (const k of await caches.keys()) if (k.startsWith('aos-') && !keep.has(k)) await caches.delete(k);
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (e) { /* opcional */ } }
    await self.clients.claim();
  })());
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

/** Devuelve lo guardado al instante y refresca en segundo plano. */
async function staleWhileRevalidate(event, cacheName, opts) {
  opts = opts || {};
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request, { ignoreSearch: !!opts.ignoreSearch });
  const net = fetch(event.request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(event.request, res.clone()).then(() => opts.max && trim(cacheName, opts.max)).catch(() => {});
    }
    return res;
  }).catch(() => null);
  if (hit) { event.waitUntil(net); return hit; }
  return (await net) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (API_HOSTS.test(url.hostname)) return;                       // API: la gestiona la app
  if (req.headers.has('range')) return;                          // vídeo por tramos: lo sirve la red
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 1) Navegación: red primero, sin red → index.html guardado
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const pre = await event.preloadResponse;
        if (pre) return pre;
        const res = await fetch(req);
        if (res && res.ok) { const c = await caches.open(SHELL); c.put('index.html', res.clone()).catch(() => {}); }
        return res;
      } catch (e) {
        const c = await caches.open(SHELL);
        return (await c.match('index.html')) || (await c.match('./')) || Response.error();
      }
    })());
    return;
  }

  // 2) Archivos propios (cascarón)
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event, SHELL, { ignoreSearch: true }));
    return;
  }

  // 3) Fuentes de Google e imágenes/vídeos de terceros (Drive, postimg…)
  if (FONT_HOSTS.test(url.hostname) || req.destination === 'image' || req.destination === 'font' || req.destination === 'style') {
    event.respondWith(staleWhileRevalidate(event, MEDIA, { max: MEDIA_MAX }));
  }
});

/* La app puede pedir la activación inmediata de una versión nueva */
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
