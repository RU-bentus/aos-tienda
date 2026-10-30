/* ==========================================================================
   AOS · Configuración del FRONTEND (lo único que tienes que editar aquí)
   ========================================================================== */

export const APP = {
  // 👉 COMPLETA AQUÍ: la URL de tu Web App de Apps Script (termina en /exec).
  //    La obtienes en Apps Script → Implementar → Administrar implementaciones → "URL de la aplicación web".
  //    Ejemplo: 'https://script.google.com/macros/s/AKfycb.../exec'
  //    Si la dejas vacía, la tienda arranca en MODO DEMO con productos de ejemplo
  //    (sirve para ver el diseño antes de conectar Google Sheets; no registra pedidos reales).
  API_URL: '',

  // Tiempo máximo (ms) que espera la lectura del catálogo antes de quedarse con la copia guardada en el dispositivo.
  CATALOG_TIMEOUT_MS: 12000,

  // Archivo del Service Worker (PWA). Debe estar en la misma carpeta que index.html.
  SERVICE_WORKER: 'sw.js',

  // Prefijo de lo que se guarda en el dispositivo (localStorage / IndexedDB).
  STORAGE_PREFIX: 'aos.',
};
