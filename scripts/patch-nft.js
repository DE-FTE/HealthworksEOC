/**
 * scripts/patch-nft.js
 *
 * Post-build script: patches every .nft.json file in .next/server/ to
 * explicitly include pdf-parse's pdf.worker.mjs.
 *
 * WHY: pdfjs-dist (bundled inside pdf-parse's CJS bundle) dynamically imports
 * its worker via a runtime string — `import(workerSrc)` where `workerSrc` is
 * assigned via `||=`. Vercel's file tracer (nft) cannot statically follow
 * runtime-constructed paths, so pdf.worker.mjs is absent from /var/task/ and
 * every /api/index-pdf request fails with "Cannot find module .../pdf.worker.mjs".
 *
 * The .nft.json files are what Vercel reads to decide which files to copy into
 * the serverless function. Adding the worker file here guarantees it lands in
 * /var/task/node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs.
 */

const fs   = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const serverDir   = path.join(projectRoot, '.next', 'server');
const workerAbs   = path.join(
  projectRoot,
  'node_modules', 'pdf-parse', 'dist', 'pdf-parse', 'cjs', 'pdf.worker.mjs'
);

if (!fs.existsSync(workerAbs)) {
  console.warn('[patch-nft] Worker file not found at:', workerAbs);
  process.exit(0);
}

if (!fs.existsSync(serverDir)) {
  console.warn('[patch-nft] .next/server not found — skipping.');
  process.exit(0);
}

let patched = 0;
let skipped = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!entry.name.endsWith('.nft.json')) continue;

    try {
      const trace   = JSON.parse(fs.readFileSync(full, 'utf8'));
      const nftDir  = path.dirname(full);
      // Relative path from this .nft.json's directory to the worker file
      const rel = path.relative(nftDir, workerAbs).replace(/\\/g, '/');

      if (trace.files && !trace.files.includes(rel)) {
        trace.files.push(rel);
        fs.writeFileSync(full, JSON.stringify(trace));
        console.log('[patch-nft] Added worker to:', path.relative(projectRoot, full));
        patched++;
      } else {
        skipped++;
      }
    } catch (e) {
      console.warn('[patch-nft] Failed to patch', full, ':', e.message);
    }
  }
}

walk(serverDir);
console.log(`[patch-nft] Done — ${patched} file(s) patched, ${skipped} already had the entry.`);
