/**
 * lib/pdfStorage.js
 *
 * Storage abstraction for pre-stored PDFs.
 * Supports two backends, configured via PDF_SOURCE in .env.local:
 *
 * ─── LOCAL (default) ──────────────────────────────────────────────────────────
 *
 *   PDF_SOURCE=local
 *   PDF_LOCAL_DIR=./pdfs          (optional, defaults to <project-root>/pdfs)
 *
 *   Just drop PDF files into the /pdfs folder in your project root.
 *   The app will auto-discover them on page load.
 *
 *   Example:
 *     healthworks-rag-pageindex/
 *       pdfs/
 *         DEN002_2026pdf.pdf
 *         H0976-001-000.pdf
 *         H0978-002-000.pdf
 *
 * ─── VERCEL BLOB (production) ─────────────────────────────────────────────────
 *
 *   PDF_SOURCE=vercel-blob
 *   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...   (from Vercel dashboard)
 *
 *   Upload PDFs to Vercel Blob using the CLI:
 *     npx vercel blob put my-document.pdf ./my-document.pdf
 *   Or via the Vercel dashboard → Storage → Blob → Upload.
 *
 *   The app fetches the list and downloads on demand.
 *
 * ─── What is NOT changed ──────────────────────────────────────────────────────
 *
 *   Everything after the PDF buffer is obtained stays exactly the same:
 *   parsePdf() → buildPageGroups() → saveTreeIndex() → keywordSearch() → answers
 */

import fs   from 'fs';
import path from 'path';

const SOURCE      = process.env.PDF_SOURCE    || 'local';
const LOCAL_DIR   = process.env.PDF_LOCAL_DIR
  ? path.resolve(process.env.PDF_LOCAL_DIR)
  : path.join(process.cwd(), 'pdfs');
// Blob folder prefix, e.g. "Demo/" — must end with "/" if set, or be empty string
const BLOB_FOLDER = process.env.BLOB_FOLDER
  ? process.env.BLOB_FOLDER.replace(/\/?$/, '/')   // ensure trailing slash
  : '';

// ─── List all PDFs in storage ─────────────────────────────────────────────────

/**
 * Returns all available PDFs from the configured storage.
 *
 * @returns {Promise<Array<{name: string, size: number, lastModified: string}>>}
 */
export async function listPdfs() {
  if (SOURCE === 'vercel-blob') {
    return listFromBlob();
  }
  return listFromLocal();
}

async function listFromLocal() {
  if (!fs.existsSync(LOCAL_DIR)) {
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    return [];
  }
  return fs.readdirSync(LOCAL_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => {
      const stats = fs.statSync(path.join(LOCAL_DIR, f));
      return {
        name:         f,
        size:         stats.size,
        lastModified: stats.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listFromBlob() {
  const { list } = await import('@vercel/blob');
  const { blobs } = await list({ prefix: BLOB_FOLDER });
  return blobs
    .filter(b => b.pathname.toLowerCase().endsWith('.pdf'))
    .map(b => ({
      // Strip the folder prefix so the rest of the system sees bare filenames
      // e.g. "Demo/H0976-001-000.pdf" → "H0976-001-000.pdf"
      name:         b.pathname.slice(BLOB_FOLDER.length),
      size:         b.size,
      lastModified: b.uploadedAt,
      url:          b.url,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Fetch a specific PDF as a Buffer ────────────────────────────────────────

/**
 * Download / read a specific PDF and return it as a Node.js Buffer.
 * This buffer is then passed directly to parsePdf() from the pageindex library.
 *
 * @param {string} filename  — exactly as returned by listPdfs()[n].name
 * @returns {Promise<Buffer>}
 */
export async function fetchPdfBuffer(filename) {
  if (SOURCE === 'vercel-blob') {
    return fetchFromBlob(filename);
  }
  return fetchFromLocal(filename);
}

async function fetchFromLocal(filename) {
  // Sanitise: strip any path traversal
  const safe = path.basename(filename);
  const full  = path.join(LOCAL_DIR, safe);
  if (!fs.existsSync(full)) {
    throw new Error(`PDF not found in local storage: ${safe}`);
  }
  return fs.readFileSync(full);
}

async function fetchFromBlob(filename) {
  const { list } = await import('@vercel/blob');
  // Reconstruct full pathname with folder prefix for lookup
  const pathname = `${BLOB_FOLDER}${path.basename(filename)}`;
  const { blobs } = await list({ prefix: pathname });
  const blob = blobs.find(b => b.pathname === pathname);
  if (!blob) throw new Error(`PDF not found in Vercel Blob: ${pathname}`);
  const res = await fetch(blob.url);
  if (!res.ok) throw new Error(`Failed to download from Blob: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ─── Storage source info (for display) ───────────────────────────────────────

export function getStorageInfo() {
  if (SOURCE === 'vercel-blob') {
    return { type: 'Vercel Blob', label: 'Cloud Storage' };
  }
  return { type: 'local', label: `Local · /pdfs/` };
}
