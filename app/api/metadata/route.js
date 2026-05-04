/**
 * app/api/metadata/route.js
 *
 * GET /api/metadata
 *
 * Reads public/metadata/eoc_metadata.csv and returns:
 *   - rows: all parsed CSV rows
 *   - filterOptions: unique values per column (for populating dropdowns)
 *
 * The frontend uses rows to compute which PDF_NAMEs match the selected
 * filters, then intersects those with loaded doc_ids to build the
 * active query scope.
 */

import { NextResponse } from 'next/server';
import fs   from 'fs';
import path from 'path';

// Handles quoted fields with embedded commas:
//   All,California,Placer,...,"Sutter Senior Advantage, a SCAN Medicare Plan (HMO)"
function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text) {
  const lines   = text.trim().split('\n').filter(l => l.trim());
  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = splitCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ''; });
    return obj;
  }).filter(r => r.PDF_NAME);
}

function unique(rows, key) {
  return [...new Set(rows.map(r => r[key]).filter(Boolean))].sort();
}

export async function GET() {
  try {
    const csvPath = path.join(process.cwd(), 'public', 'metadata', 'eoc_metadata.csv');
    const text    = fs.readFileSync(csvPath, 'utf8');
    const rows    = parseCSV(text);

    return NextResponse.json({
      rows,
      filterOptions: {
        salesRegions: unique(rows, 'SALES_REGION'),
        states:       unique(rows, 'STATE'),
        planTypes:    unique(rows, 'PLAN_TYPE'),
        snpTypes:     unique(rows, 'SNP_TYPE'),
        planNames:    unique(rows, 'PLAN_NAME'),
        payors:       unique(rows, 'PAYOR'),
        // Counties are state-dependent — computed client-side from rows
      },
    });
  } catch (err) {
    console.error('[metadata] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
