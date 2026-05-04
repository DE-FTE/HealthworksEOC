/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfjs-dist (inside pdf-parse) loads its worker via a dynamic string
  // ("./pdf.worker.mjs") that Vercel's static file tracer cannot follow.
  // Explicitly include the worker bundles so they land in /var/task/.
  outputFileTracingIncludes: {
    '/api/index-pdf': [
      './node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs',
      './node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs',
    ],
  },
  experimental: {
    instrumentationHook: true,
    // Tell Next.js to treat pageindex and its deps as server-side only
    // (they use Node.js APIs like fs, Buffer, child_process)
    serverComponentsExternalPackages: ['pageindex', 'pdf-parse', 'pdf-poppler'],
  },
};

module.exports = nextConfig;
