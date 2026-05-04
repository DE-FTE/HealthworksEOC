/**
 * lib/indexRegistry.js
 *
 * Persistent registry that maps PDF filenames to their docIds.
 *
 * ─── Why this exists ──────────────────────────────────────────────────────────
 *
 * Without this, every app restart re-indexes all PDFs and generates new UUIDs.
 * That means:
 *   - Wasted time re-parsing files that haven't changed
 *   - New docIds on every boot (tree indices in /tmp get orphaned)
 *   - No way to know if a PDF was already indexed
 *
 * With the registry:
 *   - First startup   → index all PDFs, save { filename: docId } here
 *   - Every startup   → read registry → docIds instantly available
 *   - New PDF added   → only that file gets indexed, registry updated
 *   - Nothing changed → zero indexing work, app is ready immediately
 *
 * ─── Storage ─────────────────────────────────────────────────────────────────
 *
 *   Local dev:   ./pdfs/.registry.json   (in project folder — survives restarts)
 *   Vercel prod: ./pdfs/.registry.json   (ephemeral per deployment, but Blob PDFs
 *                                         re-index on cold start — still fast since
 *                                         parsePdf has zero API calls)
 *
 *   For fully persistent Vercel production, swap readRegistry/writeRegistry
 *   to use @vercel/kv:
 *     import { kv } from '@vercel/kv';
 *     const reg = await kv.get('pdf-registry') || {};
 *     await kv.set('pdf-registry', reg);
 *
 * ─── Schema ───────────────────────────────────────────────────────────────────
 *
 *   {
 *     "H0976-001-000.pdf": {
 *       "docId":    "f3a2b1c4-9e8d-4f1a-b2c3-d4e5f6a7b8c9",
 *       "indexedAt": "2026-04-28T17:00:00.000Z",
 *       "nodeCount": 343
 *     },
 *     "H0978-002-000.pdf": {
 *       "docId":    "a1b2c3d4-...",
 *       "indexedAt": "2026-04-28T17:00:05.000Z",
 *       "nodeCount": 167
 *     }
 *   }
 */

import fs   from 'fs';
import path from 'path';

// On Vercel, /var/task/ is read-only — use /tmp/ instead.
// In local dev (PDF_SOURCE=local), keep the registry next to the PDFs so it
// persists across restarts (zero re-indexing on dev server reload).
const REGISTRY_PATH = process.env.PDF_SOURCE === 'vercel-blob'
  ? '/tmp/hw-pdf-registry.json'
  : path.join(process.cwd(), 'pdfs', '.registry.json');

// ─── Read ──────────────────────────────────────────────────────────────────────

/**
 * Load the full registry.
 * @returns {{ [filename: string]: { docId: string, indexedAt: string, nodeCount: number } }}
 */
export function readRegistry() {
  try {
    if (!fs.existsSync(REGISTRY_PATH)) return {};
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// ─── Write ─────────────────────────────────────────────────────────────────────

/**
 * Persist the full registry to disk.
 */
function writeRegistry(reg) {
  const dir = path.dirname(REGISTRY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2), 'utf8');
}

// ─── Register a newly-indexed document ────────────────────────────────────────

/**
 * Save a filename → docId mapping after successful indexing.
 * Called by /api/index-pdf once parsePdf + saveTreeIndex complete.
 *
 * @param {string} filename
 * @param {string} docId
 * @param {number} nodeCount
 */
export function registerDoc(filename, docId, nodeCount) {
  const reg = readRegistry();
  reg[filename] = {
    docId,
    indexedAt: new Date().toISOString(),
    nodeCount,
  };
  writeRegistry(reg);
}

// ─── Look up a single file ─────────────────────────────────────────────────────

/**
 * Get the registered docId for a filename, or null if not indexed.
 *
 * @param {string} filename
 * @returns {{ docId: string, nodeCount: number, indexedAt: string } | null}
 */
export function getRegistered(filename) {
  const reg = readRegistry();
  return reg[filename] || null;
}

// ─── Remove a document from the registry ──────────────────────────────────────

/**
 * Remove a filename from the registry (e.g. when PDF is deleted).
 * @param {string} filename
 */
export function unregisterDoc(filename) {
  const reg = readRegistry();
  delete reg[filename];
  writeRegistry(reg);
}
