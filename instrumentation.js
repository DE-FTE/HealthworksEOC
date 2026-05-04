export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // pdfjs-dist (used by pdf-parse → pageindex) tries to load @napi-rs/canvas at module
    // initialization time to polyfill DOMMatrix. If the native binary fails to load on the
    // deployment platform (e.g. Vercel Node 24 ABI mismatch), it leaves DOMMatrix undefined
    // and immediately crashes with ReferenceError at module level.
    //
    // We pre-polyfill from geometry.js — a pure-JS file in @napi-rs/canvas with no native
    // dependencies — so the global is set before pdfjs-dist is ever imported.
    if (typeof globalThis.DOMMatrix === 'undefined') {
      try {
        const { createRequire } = await import('module');
        const req = createRequire(import.meta.url);
        const { DOMMatrix, DOMPoint, DOMRect } = req('@napi-rs/canvas/geometry');
        globalThis.DOMMatrix = DOMMatrix;
        if (typeof globalThis.DOMPoint === 'undefined') globalThis.DOMPoint = DOMPoint;
        if (typeof globalThis.DOMRect  === 'undefined') globalThis.DOMRect  = DOMRect;
        console.log('[instrumentation] DOMMatrix polyfilled from @napi-rs/canvas/geometry');
      } catch (e) {
        console.warn('[instrumentation] DOMMatrix polyfill failed:', e.message);
      }
    }
  }
}
