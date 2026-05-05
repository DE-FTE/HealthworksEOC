/**
 * lib/indexRegistry.js
 *
 * Persistent registry that maps PDF filenames to their docIds.
 *
 * ─── Storage strategy ────────────────────────────────────────────────────────
 *
 *   Local dev (PDF_SOURCE=local):
 *     ./pdfs/.registry.json — persists across server restarts
 *
 *   Vercel prod (PDF_SOURCE=vercel-blob):
 *     One blob file per document: hw-pdf-registry/{filename}.json
 *     Each registerDoc() writes its OWN blob — no read-modify-write race condition.
 *     readRegistry() lists all blobs under the prefix and fetches them in parallel.
 *
 *     WHY per-document blobs:
 *       With a single monolithic hw-pdf-registry.json, 12 concurrent index-pdf
 *       calls each read the same empty state, add one entry, and overwrite the blob.
 *       Only the last writer survives → most documents lose their registry entry.
 *       Per-document blobs avoid this entirely — concurrent writes go to different URLs.
 *
 * ─── Schema ───────────────────────────────────────────────────────────────────
 *
 *   {
 *     "H0976-001-000.pdf": {
 *       "docId":    "f3a2b1c4-9e8d-4f1a-b2c3-d4e5f6a7b8c9",
 *       "indexedAt": "2026-04-28T17:00:00.000Z",
 *       "nodeCount": 343
 *     }
 *   }
 */

import fs   from 'fs';
import path from 'path';

const ON_VERCEL    = process.env.PDF_SOURCE === 'vercel-blob';
const BLOB_PREFIX  = 'hw-pdf-registry/';         // one blob per doc under this prefix
const LOCAL_PATH   = path.join(process.cwd(), 'pdfs', '.registry.json');

// ─── Read ──────────────────────────────────────────────────────────────────────

/**
 * Load the full registry.
 * @returns {Promise<{ [filename: string]: { docId: string, indexedAt: string, nodeCount: number } }>}
 */
export async function readRegistry() {
  if (ON_VERCEL) {
    try {
      const { list } = await import('@vercel/blob');
      const { blobs } = await list({ prefix: BLOB_PREFIX });
      const pdfBlobs = blobs.filter(b => b.pathname.endsWith('.json'));
      if (pdfBlobs.length === 0) return {};

      // Fetch all per-document entries in parallel
      const entries = await Promise.all(
        pdfBlobs.map(async b => {
          try {
            const res = await fetch(b.url, { cache: 'no-store' });
            if (!res.ok) return null;
            const entry = await res.json();
            // pathname: "hw-pdf-registry/H0976-001-000.pdf.json" → "H0976-001-000.pdf"
            const filename = b.pathname.slice(BLOB_PREFIX.length).replace(/\.json$/, '');
            return [filename, entry];
          } catch {
            return null;
          }
        })
      );

      return Object.fromEntries(entries.filter(Boolean));
    } catch (err) {
      console.warn('[registry] Blob read failed:', err.message);
      return {};
    }
  }
  try {
    if (!fs.existsSync(LOCAL_PATH)) return {};
    return JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// ─── Write ─────────────────────────────────────────────────────────────────────

async function writeLocalRegistry(reg) {
  const dir = path.dirname(LOCAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(reg, null, 2), 'utf8');
}

// ─── Register a newly-indexed document ────────────────────────────────────────

/**
 * Save a filename → docId mapping after successful indexing.
 * On Vercel: writes a separate blob per document (no race condition).
 * Locally: updates the shared .registry.json file.
 *
 * @param {string} filename
 * @param {string} docId
 * @param {number} nodeCount
 */
export async function registerDoc(filename, docId, nodeCount) {
  const entry = {
    docId,
    indexedAt: new Date().toISOString(),
    nodeCount,
  };

  if (ON_VERCEL) {
    try {
      const { put } = await import('@vercel/blob');
      // Each document gets its own blob: hw-pdf-registry/H0976-001-000.pdf.json
      // Concurrent registerDoc calls write to DIFFERENT URLs — no overwrite conflict.
      await put(`${BLOB_PREFIX}${filename}.json`, JSON.stringify(entry), {
        access:           'public',
        contentType:      'application/json',
        addRandomSuffix:  false,
      });
    } catch (err) {
      console.warn('[registry] Blob write failed:', err.message);
    }
    return;
  }

  // Local: update shared JSON file
  const reg = await readRegistry();
  reg[filename] = entry;
  await writeLocalRegistry(reg);
}

// ─── Look up a single file ─────────────────────────────────────────────────────

/**
 * Get the registered entry for a filename, or null if not indexed.
 *
 * @param {string} filename
 * @returns {Promise<{ docId: string, nodeCount: number, indexedAt: string } | null>}
 */
export async function getRegistered(filename) {
  if (ON_VERCEL) {
    try {
      const { list } = await import('@vercel/blob');
      const blobName = `${BLOB_PREFIX}${filename}.json`;
      const { blobs } = await list({ prefix: blobName });
      const entry = blobs.find(b => b.pathname === blobName);
      if (!entry) return null;
      const res = await fetch(entry.url, { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }
  const reg = await readRegistry();
  return reg[filename] || null;
}

// ─── Remove a document from the registry ──────────────────────────────────────

/**
 * Remove a filename from the registry (e.g. when PDF is deleted).
 * @param {string} filename
 */
export async function unregisterDoc(filename) {
  if (ON_VERCEL) {
    try {
      const { del, list } = await import('@vercel/blob');
      const blobName = `${BLOB_PREFIX}${filename}.json`;
      const { blobs } = await list({ prefix: blobName });
      const entry = blobs.find(b => b.pathname === blobName);
      if (entry) await del(entry.url);
    } catch (err) {
      console.warn('[registry] Blob delete failed:', err.message);
    }
    return;
  }
  const reg = await readRegistry();
  delete reg[filename];
  await writeLocalRegistry(reg);
}
