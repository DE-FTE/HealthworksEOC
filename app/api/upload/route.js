/**
 * app/api/upload/route.js
 *
 * POST /api/upload
 *
 * ─── Why fromPdf() was slow — and what we changed ────────────────────────────
 *
 * PageIndex.fromPdf() runs this SEQUENTIAL LLM call chain internally:
 *
 *   checkToc()                          → 1  LLM call
 *   processNoToc() / processToc*()      → 1–5 LLM calls
 *   checkTitleAppearanceInStartConcurrent → N  LLM calls (1 per section)
 *     └─ MISLEADING NAME: it uses for...of + await = fully sequential
 *   verifyToc()                         → N  LLM calls (1 per section)
 *   fixIncorrectToc() (if needed)       → 2M LLM calls (2 per bad item)
 *   ─────────────────────────────────────────────────────────────────
 *   TOTAL for 9 sections ≈ 20–30 sequential calls × ~2s = 40–60 seconds
 *
 * None of these can be disabled via PageIndex options — they are hardwired
 * into the library's core pipeline.
 *
 * ─── The fix: use parsePdf() instead of fromPdf() ────────────────────────────
 *
 *   parsePdf(buffer)  — exported from 'pageindex', used standalone
 *                     — pure local PDF text extraction via pdf-parse
 *                     — ZERO LLM calls, runs in < 1 second
 *                     — returns { title, numPages, pages: [{text, tokenCount}] }
 *
 * We then build the section structure ourselves by grouping consecutive pages
 * into fixed-size chunks (PAGES_PER_NODE, default 3). This produces the same
 * TreeNode[] format used by the rest of the pipeline.
 *
 * ─── Speed comparison ────────────────────────────────────────────────────────
 *
 *   Before (PageIndex.fromPdf):  40–60 seconds for a 9-page PDF
 *   After  (parsePdf + grouping):  < 1 second for any PDF
 *
 * ─── What we KEEP from pageindex library ─────────────────────────────────────
 *
 *   parsePdf(buffer)   — PDF text extraction with per-page tokenCount
 *   getPdfName(path)   — filename utility
 *   getNodes()         — tree flattening at query time (in treeIndex.js)
 *   getLeafNodes()     — leaf-node flattening at query time (in treeIndex.js)
 *
 * ─── Query pipeline: unchanged ───────────────────────────────────────────────
 *
 *   Step 1: gpt-4o-mini selects relevant section nodeIds from text previews
 *   Step 2: gpt-4o generates a streamed, cited answer from section text
 *
 * ─── Environment variables ───────────────────────────────────────────────────
 *
 *   PAGEINDEX_API_KEY    PageIndex platform key — currently unused at upload (parsePdf needs no key)
 *   PAGES_PER_NODE       Pages grouped per section node (default: 3)
 */

import { parsePdf }      from 'pageindex';
import { v4 as uuidv4 }  from 'uuid';
import { saveTreeIndex } from '@/lib/treeIndex';

const PAGES_PER_NODE = parseInt(process.env.PAGES_PER_NODE || '3', 10);

export async function POST(request) {
  const encoder = new TextEncoder();

  const emit = (ctrl, obj) =>
    ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // ── Read file ───────────────────────────────────────────────────────
        const formData = await request.formData();
        const file     = formData.get('file');

        if (!file) {
          emit(controller, { event: 'error', message: 'No file provided.' });
          controller.close(); return;
        }

        const filename = file.name || 'document.pdf';
        const buffer   = Buffer.from(await file.arrayBuffer());

        if (buffer.length === 0) {
          emit(controller, { event: 'error', message: 'Empty file.' });
          controller.close(); return;
        }
        if (buffer.length > 20 * 1024 * 1024) {
          emit(controller, { event: 'error', message: 'File too large (max 20 MB).' });
          controller.close(); return;
        }

        // ── Stage 1: Parse PDF ──────────────────────────────────────────────
        emit(controller, { event: 'progress', stage: 1, message: 'Parsing PDF pages…' });

        // ─────────────────────────────────────────────────────────────────────
        // PAGEINDEX LIBRARY CALL: parsePdf(buffer)
        //
        // This is the ONLY pageindex function called at upload time.
        // It uses pdf-parse under the hood — local text extraction, zero network.
        //
        // Returns:
        //   {
        //     title: "document.pdf",
        //     numPages: 9,
        //     pages: [
        //       { text: "Full text of page 1...", tokenCount: 312 },
        //       { text: "Full text of page 2...", tokenCount: 289 },
        //       ...
        //     ]
        //   }
        // ─────────────────────────────────────────────────────────────────────
        const pdfInfo = await parsePdf(buffer);

        if (!pdfInfo?.pages?.length) {
          emit(controller, {
            event:   'error',
            message: 'Could not extract text from this PDF. Make sure it has selectable text (not a scanned image).',
          });
          controller.close(); return;
        }

        // ── Stage 2: Build section structure ────────────────────────────────
        emit(controller, { event: 'progress', stage: 2, message: 'Building section index…' });

        // Group consecutive pages into fixed-size chunks.
        // Each chunk becomes one TreeNode with its own nodeId, page range, and text.
        //
        // Why fixed-size grouping instead of LLM-based structure?
        //   - Zero LLM calls = instant, deterministic, no network dependency
        //   - The semantic grouping happens at QUERY time anyway (gpt-4o-mini
        //     reads the text previews and picks relevant nodes — it doesn't care
        //     whether nodes follow chapter boundaries or page boundaries)
        //   - For healthcare docs (fee schedules, coverage tables, protocols)
        //     content is typically uniform — page-based grouping works well
        //
        const structure = buildPageGroups(pdfInfo.pages, filename, PAGES_PER_NODE);

        if (!structure.length) {
          emit(controller, { event: 'error', message: 'No text content found in PDF.' });
          controller.close(); return;
        }

        // ── Stage 3: Save index ──────────────────────────────────────────────
        emit(controller, { event: 'progress', stage: 3, message: 'Saving index…' });

        const docId = uuidv4();
        const saved = saveTreeIndex(docId, filename, {
          docName:   pdfInfo.title || filename,
          structure,
        });

        emit(controller, {
          event:     'done',
          docId,
          filename,
          nodeCount: saved.nodeCount,
          leafCount: saved.leafCount,
        });

      } catch (err) {
        console.error('[upload] error:', err);
        emit(controller, { event: 'error', message: err.message || 'Failed to index document.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  });
}

/**
 * Group an array of PDF pages into fixed-size TreeNode sections.
 *
 * Each node covers PAGES_PER_NODE consecutive pages and contains:
 *   - nodeId:     "1", "2", "3" …
 *   - title:      "Pages 1–3"
 *   - startIndex: 1  (1-indexed, matches PageIndex convention)
 *   - endIndex:   3
 *   - text:       full concatenated text of those pages
 *   - nodes:      [] (flat — no children needed for page-based grouping)
 *
 * @param {Array<{text: string, tokenCount: number}>} pages
 * @param {string} docName
 * @param {number} groupSize
 * @returns {TreeNode[]}
 */
function buildPageGroups(pages, docName, groupSize) {
  const nodes = [];
  for (let i = 0; i < pages.length; i += groupSize) {
    const chunk     = pages.slice(i, i + groupSize);
    const startPage = i + 1;
    const endPage   = Math.min(i + groupSize, pages.length);
    const nodeId    = String(Math.floor(i / groupSize) + 1);
    const text      = chunk.map(p => p.text).join('\n\n').trim();

    if (!text) continue;   // skip blank pages

    nodes.push({
      title:      `Pages ${startPage}–${endPage}`,
      nodeId,
      startIndex: startPage,
      endIndex:   endPage,
      text,
      nodes:      [],      // flat structure — children not needed
    });
  }
  return nodes;
}
