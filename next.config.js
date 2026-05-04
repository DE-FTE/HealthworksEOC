/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
    // Tell Next.js to treat pageindex and its deps as server-side only
    // (they use Node.js APIs like fs, Buffer, child_process)
    serverComponentsExternalPackages: ['pageindex', 'pdf-parse', 'pdf-poppler'],
  },
};

module.exports = nextConfig;
