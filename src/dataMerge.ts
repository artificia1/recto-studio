import { Spread, Page, CanvasElement, TextElement, ImageElement, TableElement } from './types';
import { editStory, storyText } from './engine/storyContent';
import { parseDelimited } from './engine/delimitedText';

export function parseMergeData(text: string): DataMergeResult {
  if (!text.trimStart().startsWith('[')) return parseCsv(text);
  if (text.length > 4 * 1024 * 1024) throw new Error('Data input must be smaller than 4 MB.');
  const rows: unknown = JSON.parse(text);
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('Choose a JSON array of at most 10,000 records.');
  const headers = new Set<string>();
  const records = rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length > 256) throw new Error('Each record needs an object with at most 256 scalar fields.');
    const record = Object.create(null) as Record<string, string>;
    for (const [key, value] of Object.entries(row)) {
      if (!key.trim() || !['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('JSON fields must have names and string, number or boolean values.');
      headers.add(key); record[key] = String(value);
    }
    return record;
  });
  if (headers.size > 256) throw new Error('Use at most 256 unique fields.');
  return { headers: [...headers], records };
}

export interface DataMergeResult {
  headers: string[];
  records: Record<string, string>[];
}

/**
 * RFC 4180 compliant CSV parser supporting quoted values, commas, and newlines inside quotes.
 */
export function parseCsv(csvText: string): DataMergeResult {
  const rows = parseDelimited(csvText).filter(row => row.some(value => value.trim()));
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map(value => value.trim());
  if (headers.some(header => !header) || new Set(headers).size !== headers.length) throw new Error('Column names must be nonempty and unique.');
  const records = rows.slice(1).map(row => {
    if (row.length !== headers.length) throw new Error('Every data row must match the header column count.');
    return Object.fromEntries(headers.map((header, index) => [header, row[index]]));
  });
  return { headers, records };
}

/**
 * Replaces {{Token}} and {{ Token }} patterns using key/value records.
 */
export function substituteTokens(templateStr: string, record: Record<string, string>): string {
  if (!templateStr || typeof templateStr !== 'string') return templateStr;

  return templateStr.replace(/\{\{\s*([a-zA-Z0-9_.[\]-]+)\s*\}\}/g, (match, key) => {
    // Exact match
    if (Object.hasOwn(record, key)) {
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
      storyContent: textEl.storyContent ? editStory(textEl.storyContent, substituteTokens(storyText(textEl.storyContent), record)) : undefined,
      textContent: textEl.textContent ? editStory(textEl.textContent, substituteTokens(storyText(textEl.textContent), record)) : undefined,
    };
  }

  if (element.type === 'image') {
    const imgEl = element as ImageElement;
    const src = substituteTokens(imgEl.src, record);
    return {
      ...imgEl,
      src,
      ...(src !== imgEl.src ? { assetId: undefined, proxySrc: undefined, originalWidth: undefined, originalHeight: undefined, actualDpi: undefined } : {}),
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
    const elementIds = new Map(templateSpread.elements.map((element, idx) => [element.id, `${spreadId}-el-${idx}`]));
    const newElements: CanvasElement[] = templateSpread.elements.map(el => {
      const cloned = substituteElementTokens(structuredClone(el), record);
      cloned.id = elementIds.get(el.id)!;
      cloned.pageId = pageIdMap.get(el.pageId) || newPages[0].id;
      if (cloned.groupId) cloned.groupId = `${spreadId}-group-${cloned.groupId}`;
      if (cloned.anchor) cloned.anchor.parentTextId = elementIds.get(cloned.anchor.parentTextId) || cloned.anchor.parentTextId;
      if (cloned.type === 'text' || cloned.type === 'table') {
        cloned.prevFrameId = cloned.prevFrameId ? elementIds.get(cloned.prevFrameId) : undefined;
        cloned.nextFrameId = cloned.nextFrameId ? elementIds.get(cloned.nextFrameId) : undefined;
      }
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
