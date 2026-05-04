# HealthworksAI — PageIndex Edition

A production-ready RAG chatbot powered by the **`pageindex` npm library** — vectorless, reasoning-based document intelligence.

---

## How it works

```
┌─────────────────────────────────────────────────────────────────────────┐
│  UPLOAD TIME  (once per document)                                       │
│                                                                         │
│  PDF buffer                                                             │
│      │                                                                  │
│      ▼                                                                  │
│  PageIndex.fromPdf(buffer)        ← pageindex npm library              │
│      │  internally calls:                                               │
│      │   parsePdf()               ← pdf-parse: extract per-page text   │
│      │   chatGPT() × N            ← detect TOC, extract structure      │
│      │   chatGPT() × nodes        ← generate section summaries         │
│      ▼                                                                  │
│  PageIndexResult {                                                      │
│    structure: TreeNode[]          ← hierarchical chapters/sections     │
│    docDescription: string         ← AI-written document overview       │
│  }                                                                      │
│      │                                                                  │
│      ▼                                                                  │
│  saveTreeIndex(docId, filename, result)                                 │
│      └─ /tmp/hw-tree-index/<uuid>.json                                 │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  QUERY TIME  (every chat message)                                       │
│                                                                         │
│  User question                                                          │
│      │                                                                  │
│      ▼                                                                  │
│  loadTreeIndex(docId)                                                   │
│  flattenAllNodes(structure)       ← getNodes() from pageindex          │
│  buildNodeDirectory(nodes)        ← "[1.2] pp.4-6 | Title — Summary"  │
│      │                                                                  │
│      ▼                                                                  │
│  STEP 1: gpt-4o-mini                                                    │
│    Input:  question + node directory                                    │
│    Output: ["1.2", "3", "4.1"]   ← relevant section IDs               │
│      │                                                                  │
│      ▼                                                                  │
│  getNodeContents(nodes, ids)      ← full text of selected sections     │
│      │                                                                  │
│      ▼                                                                  │
│  STEP 2: gpt-4o (streamed)                                              │
│    Input:  question + section texts                                     │
│    Output: grounded answer → streamed to browser                       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## PageIndex library functions used

| Location | Function | What it does |
|---|---|---|
| `upload/route.js` | `new PageIndex(options)` | Create indexer instance |
| `upload/route.js` | `pageIndex.fromPdf(buffer)` | Build tree from PDF |
| `lib/treeIndex.js` | `getNodes(structure)` | Flatten tree to all nodes |
| `lib/treeIndex.js` | `getLeafNodes(structure)` | Flatten to leaf nodes only |

---

## Project structure

```
healthworks-rag/
├── app/
│   ├── api/
│   │   ├── chat/route.js       ← 2-step tree-node RAG + streaming
│   │   └── upload/route.js     ← PageIndex.fromPdf() ingestion
│   ├── globals.css
│   ├── layout.js
│   └── page.jsx                ← full chat UI with chart engine
├── lib/
│   └── treeIndex.js            ← save/load tree + getNodes/getLeafNodes wrappers
├── .env.example
├── jsconfig.json
├── next.config.js
├── package.json
└── tailwind.config.js
```

---

## Setup

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env.local
# PAGEINDEX_API_KEY is already pre-filled in .env.example

# 3. Create jsconfig.json (for @/ path alias)
# Contents:
# { "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] } } }

# 4. Run
npm run dev
# → http://localhost:3000
```

---

## Deploy to Vercel

```bash
vercel --prod
# Add PAGEINDEX_API_KEY in Vercel dashboard → Project → Settings → Environment Variables
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PAGEINDEX_API_KEY` | — | **Required.** Used by pageindex library + our OpenAI calls |
| `INDEXING_MODEL` | `gpt-4o-mini` | Model for TOC extraction + summaries (upload time) |
| `SELECTION_MODEL` | `gpt-4o-mini` | Model for section selection (query time) |
| `ANSWER_MODEL` | `gpt-4o` | Model for answer generation (query time) |
| `MAX_NODES_PER_QUERY` | `4` | Max sections included in answer context |
