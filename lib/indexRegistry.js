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
 *     Vercel Blob — stores hw-pdf-registry.json in the existing Blob store.
 *     Survives cold starts and is shared across all function instances.
 *     Requires BLOB_READ_WRITE_TOKEN (already set when Blob store is connected).
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

const ON_VERCEL     = process.env.PDF_SOURCE === 'vercel-blob';
const REGISTRY_BLOB = 'hw-pdf-registry.json';
const LOCAL_PATH    = path.join(process.cwd(), 'pdfs', '.registry.json');

// ─── Read ──────────────────────────────────────────────────────────────────────

/**
 * Load the full registry.
 * @returns {Promise<{ [filename: string]: { docId: string, indexedAt: string, nodeCount: number } }>}
 */
export async function readRegistry() {
  if (ON_VERCEL) {
    try {
      const { list } = await import('@vercel/blob');
      const { blobs } = await list({ prefix: REGISTRY_BLOB });
      const entry = blobs.find(b => b.pathname === REGISTRY_BLOB);
      if (!entry) return {};
      const res = await fetch(entry.url, { cache: 'no-store' });
      if (!res.ok) return {};
      return await res.json();
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

async function writeRegistry(reg) {
  if (ON_VERCEL) {
    try {
      const { put } = await import('@vercel/blob');
      await put(REGISTRY_BLOB, JSON.stringify(reg, null, 2), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });
      return;
    } catch (err) {
      console.warn('[registry] Blob write failed:', err.message);
    }
    return;
  }
  const dir = path.dirname(LOCAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(reg, null, 2), 'utf8');
}

// ─── Register a newly-indexed document ────────────────────────────────────────

/**
 * Save a filename → docId mapping after successful indexing.
 *
 * @param {string} filename
 * @param {string} docId
 * @param {number} nodeCount
 */
export async function registerDoc(filename, docId, nodeCount) {
  const reg = await readRegistry();
  reg[filename] = {
    docId,
    indexedAt: new Date().toISOString(),
    nodeCount,
  };
  await writeRegistry(reg);
}

// ─── Look up a single file ─────────────────────────────────────────────────────

/**
 * Get the registered entry for a filename, or null if not indexed.
 *
 * @param {string} filename
 * @returns {Promise<{ docId: string, nodeCount: number, indexedAt: string } | null>}
 */
export async function getRegistered(filename) {
  const reg = await readRegistry();
  return reg[filename] || null;
}

// ─── Remove a document from the registry ──────────────────────────────────────

/**
 * Remove a filename from the registry (e.g. when PDF is deleted).
 * @param {string} filename
 */
export async function unregisterDoc(filename) {
  const reg = await readRegistry();
  delete reg[filename];
  await writeRegistry(reg);
}
