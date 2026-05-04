/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfjs-dist (inside pdf-parse) dynamically imports its worker via a runtime
  // string ("./pdf.worker.mjs"). Vercel's static file tracer (nft) cannot follow
  // runtime-constructed paths, so the file is absent from /var/task/ at runtime.
  //
  // outputFileTracingIncludes adds files to the nft trace explicitly.
  // We include both keying formats ('/api/...' and 'api/...') because
  // different Next.js versions pass the page key with or without a leading slash.
  outputFileTracingIncludes: {
    '/api/index-pdf': ['./node_modules/pdf-parse/dist/**/*.mjs'],
    'api/index-pdf':  ['./node_modules/pdf-parse/dist/**/*.mjs'],
  },
  experimental: {
    instrumentationHook: true,
    // Tell Next.js to treat pageindex and its deps as server-side only
    // (they use Node.js APIs like fs, Buffer, child_process)
    serverComponentsExternalPackages: ['pageindex', 'pdf-parse', 'pdf-poppler'],
  },
};

module.exports = nextConfig;
