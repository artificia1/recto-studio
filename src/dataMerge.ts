import { Spread, Page, CanvasElement, TextElement, ImageElement, TableElement } from './types';

export interface DataMergeResult {
  headers: string[];
  records: Record<string, string>[];
}

/**
 * RFC 4180 compliant CSV parser supporting quoted values, commas, and newlines inside quotes.
 */
export function parseCsv(csvText: string): DataMergeResult {
  const records: string[][] = [];
  let currentRecord: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  const len = csvText.length;
  while (i < len) {
    const char = csvText[i];
    const nextChar = i + 1 < len ? csvText[i + 1] : '';

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRecord.push(currentField.trim());
        currentField = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (nextChar === '\n') i++;
        currentRecord.push(currentField.trim());
        records.push(currentRecord);
        currentRecord = [];
        currentField = '';
        i++;
        continue;
      } else if (char === '\n') {
        currentRecord.push(currentField.trim());
        records.push(currentRecord);
        currentRecord = [];
        currentField = '';
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (currentField.length > 0 || currentRecord.length > 0) {
    currentRecord.push(currentField.trim());
    records.push(currentRecord);
  }

  const validRows = records.filter(row => row.some(col => col.trim().length > 0));
  if (validRows.length === 0) {
    return { headers: [], records: [] };
  }

  const headers = validRows[0].map(h => h.trim());
  const dataRecords: Record<string, string>[] = [];

  for (let r = 1; r < validRows.length; r++) {
    const row = validRows[r];
    const rec: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      rec[header] = row[c] !== undefined ? row[c] : '';
    }
    dataRecords.push(rec);
  }

  return { headers, records: dataRecords };
}

/**
 * Replaces {{Token}} and {{ Token }} patterns using key/value records.
 */
export function substituteTokens(templateStr: string, record: Record<string, string>): string {
  if (!templateStr || typeof templateStr !== 'string') return templateStr;

  return templateStr.replace(/\{\{\s*([a-zA-Z0-9_.[\]-]+)\s*\}\}/g, (match, key) => {
    // Exact match
    if (record[key] !== undefined) {
      return record[key];
    }
    // Case-insensitive fallback
    const lowerKey = key.toLowerCase();
    for (const [rKey, rVal] of Object.entries(record)) {
      if (rKey.toLowerCase() === lowerKey) {
        return rVal;
      }
    }
    return match; // Keep token if not in record
  });
}

/**
 * Clones a CanvasElement, substituting tokens across text, image URLs, and table cells.
 */
export function substituteElementTokens(element: CanvasElement, record: Record<string, string>): CanvasElement {
  if (element.type === 'text') {
    const textEl = element as TextElement;
    return {
      ...textEl,
      text: substituteTokens(textEl.text, record),
      rawStoryText: textEl.rawStoryText ? substituteTokens(textEl.rawStoryText, record) : undefined,
    };
  }

  if (element.type === 'image') {
    const imgEl = element as ImageElement;
    return {
      ...imgEl,
      src: substituteTokens(imgEl.src, record),
      caption: imgEl.caption ? substituteTokens(imgEl.caption, record) : undefined,
    };
  }

  if (element.type === 'table') {
    const tableEl = element as TableElement;
    const newCells = tableEl.cells.map(row =>
      row.map(cell => ({
        ...cell,
        text: substituteTokens(cell.text, record),
      }))
    );
    return {
      ...tableEl,
      cells: newCells,
    };
  }

  return { ...element };
}

/**
 * Generates publication spreads from a template spread by duplicating and substituting tokens for each record.
 */
export function generateMergedSpreads(
  templateSpread: Spread,
  records: Record<string, string>[],
  startSpreadIndex: number = 0,
  startPageNumber: number = 1
): Spread[] {
  const mergedSpreads: Spread[] = [];
  let pageCounter = startPageNumber;

  for (let rIdx = 0; rIdx < records.length; rIdx++) {
    const record = records[rIdx];
    const spreadIndex = startSpreadIndex + rIdx;
    const spreadId = `merged-spread-${spreadIndex}-${Date.now()}`;

    // Map new pages with progressive page numbers
    const pageIdMap = new Map<string, string>();
    const newPages: Page[] = templateSpread.pages.map(oldP => {
      const newPageId = `merged-page-${pageCounter}`;
      pageIdMap.set(oldP.id, newPageId);
      const page: Page = {
        id: newPageId,
        pageNumber: pageCounter,
        side: oldP.side,
      };
      pageCounter++;
      return page;
    });

    // Clone and substitute tokens on each element
    const newElements: CanvasElement[] = templateSpread.elements.map((el, elIdx) => {
      const cloned = substituteElementTokens(el, record);
      cloned.id = `merged-el-${spreadIndex}-${elIdx}`;
      cloned.pageId = pageIdMap.get(el.pageId) || newPages[0].id;
      return cloned;
    });

    mergedSpreads.push({
      id: spreadId,
      spreadIndex,
      pages: newPages,
      elements: newElements,
      masterSpreadId: templateSpread.masterSpreadId,
    });
  }

  return mergedSpreads;
}

/**
 * Ingests either JSON dataset (array of objects or envelope) or CSV text.
 */
export function parseDataset(rawInput: string): DataMergeResult {
  if (!rawInput || typeof rawInput !== 'string') {
    return { headers: [], records: [] };
  }

  const trimmed = rawInput.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      let items: any[] = [];
      if (Array.isArray(parsed)) {
        items = parsed;
      } else if (parsed && typeof parsed === 'object') {
        const candidateKey = ['products', 'data', 'records', 'items', 'rows', 'catalog', 'users', 'entries'].find(
          (k) => Array.isArray(parsed[k])
        );
        if (candidateKey) {
          items = parsed[candidateKey];
        } else {
          const arrVal = Object.values(parsed).find((v) => Array.isArray(v));
          items = arrVal ? (arrVal as any[]) : [parsed];
        }
      }

      if (items.length === 0) {
        return { headers: [], records: [] };
      }

      const headerSet = new Set<string>();
      items.forEach((item) => {
        if (item && typeof item === 'object') {
          Object.keys(item).forEach((k) => headerSet.add(k));
        }
      });

      const headers = Array.from(headerSet);
      const records: Record<string, string>[] = items.map((item) => {
        const rec: Record<string, string> = {};
        for (const h of headers) {
          const val = item ? item[h] : '';
          rec[h] = val !== undefined && val !== null ? String(val) : '';
        }
        return rec;
      });

      return { headers, records };
    } catch {
      return parseCsv(rawInput);
    }
  }

  return parseCsv(rawInput);
}

/**
 * Enhanced Spread Repeater with N-Up multi-card pagination.
 * If templateSpread has N product slots (e.g. 4 cards per spread) or if recordsPerPage is specified,
 * batches records and continuously generates spreads.
 */
export function generateRepeaterSpreads(
  templateSpread: Spread,
  records: Record<string, string>[],
  options: {
    startSpreadIndex?: number;
    startPageNumber?: number;
    recordsPerSpread?: number;
  } = {}
): Spread[] {
  if (!templateSpread || !records || records.length === 0) {
    return [];
  }

  const startSpreadIndex = options.startSpreadIndex || 0;
  let pageCounter = options.startPageNumber || 1;

  let itemsPerSpread = options.recordsPerSpread || 1;
  if (!options.recordsPerSpread) {
    let maxDetectedIndex = 0;
    const tokenRegex = /\{\{\s*(?:items|records|products|item|product)?\[?(\d+)\]?[._]([a-zA-Z0-9_.-]+)\s*\}\}/gi;
    for (const el of templateSpread.elements) {
      const textToScan = (el as any).text || (el as any).src || '';
      let m: RegExpExecArray | null;
      while ((m = tokenRegex.exec(textToScan)) !== null) {
        const idx = parseInt(m[1], 10);
        if (!isNaN(idx) && idx + 1 > maxDetectedIndex) {
          maxDetectedIndex = idx + 1;
        }
      }
    }
    if (maxDetectedIndex > 1) {
      itemsPerSpread = maxDetectedIndex;
    }
  }

  const mergedSpreads: Spread[] = [];
  const totalSpreadsNeeded = Math.ceil(records.length / itemsPerSpread);

  for (let sIdx = 0; sIdx < totalSpreadsNeeded; sIdx++) {
    const spreadIndex = startSpreadIndex + sIdx;
    const spreadId = `repeater-spread-${spreadIndex}-${Date.now()}`;
    const batchStart = sIdx * itemsPerSpread;
    const batch = records.slice(batchStart, batchStart + itemsPerSpread);

    const pageIdMap = new Map<string, string>();
    const newPages: Page[] = templateSpread.pages.map((oldP) => {
      const newPageId = `repeater-page-${pageCounter}`;
      pageIdMap.set(oldP.id, newPageId);
      const page: Page = {
        id: newPageId,
        pageNumber: pageCounter,
        side: oldP.side,
      };
      pageCounter++;
      return page;
    });

    const spreadRecord: Record<string, string> = {};

    if (batch[0]) {
      Object.assign(spreadRecord, batch[0]);
    }

    batch.forEach((rec, slotIdx) => {
      for (const [k, v] of Object.entries(rec)) {
        spreadRecord[`[${slotIdx}].${k}`] = v;
        spreadRecord[`${slotIdx}.${k}`] = v;
        spreadRecord[`item[${slotIdx}].${k}`] = v;
        spreadRecord[`items[${slotIdx}].${k}`] = v;
        spreadRecord[`product[${slotIdx}].${k}`] = v;
        spreadRecord[`products[${slotIdx}].${k}`] = v;
        spreadRecord[`${k}_${slotIdx}`] = v;
        spreadRecord[`${k}_${slotIdx + 1}`] = v;
      }
    });

    const newElements: CanvasElement[] = templateSpread.elements.map((el, elIdx) => {
      const cloned = substituteElementTokens(el, spreadRecord);
      cloned.id = `repeater-el-${spreadIndex}-${elIdx}`;
      cloned.pageId = pageIdMap.get(el.pageId) || newPages[0].id;
      return cloned;
    });

    mergedSpreads.push({
      id: spreadId,
      spreadIndex,
      pages: newPages,
      elements: newElements,
      masterSpreadId: templateSpread.masterSpreadId,
    });
  }

  return mergedSpreads;
}

/**
 * Fetches dataset from a remote URL (Google Sheets CSV or REST API endpoint).
 */
export async function fetchRemoteDataset(url: string): Promise<DataMergeResult> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch dataset from ${url} (HTTP ${resp.status})`);
  }
  const text = await resp.text();
  return parseDataset(text);
}
