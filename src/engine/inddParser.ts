/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 *
 * Limited INDD diagnostics and content recovery. This is not a native layout parser.
 * XMP and a thumbnail may be readable; text carving is heuristic and incomplete.
 * Header/version/sector interpretations are diagnostic guesses, not layout records.
 */

import { CanvasElement, ImageElement, TextElement, ProjectState } from '../types';
import { INITIAL_STATE } from '../state/defaults';

export interface InddFontInfo {
  name: string;
  family: string;
  format?: string;
}

export interface InddSwatchInfo {
  name: string;
  mode: string;
  values?: number[];
}

export interface InddMetadata {
  isIndd: boolean;
  title?: string;
  creator?: string;
  creatorTool?: string;
  createDate?: string;
  modifyDate?: string;
  pageCount: number;
  fonts: InddFontInfo[];
  swatches: InddSwatchInfo[];
  thumbnailBase64?: string;
  thumbnailDataUrl?: string;
}

export interface InddBinaryHeader {
  guid: string;
  fileType: 'DOCUMENT' | 'BOOKBOOK' | 'LIBRARY ' | 'UNKNOWN';
  endianness: 'little-endian' | 'big-endian';
  versionNumber: number;
  versionName: string;
  sectorSize: number;
}

export interface InddAnalysisReport {
  header: InddBinaryHeader | null;
  metadata: InddMetadata;
  carvedStories: string[];
  totalBytes: number;
  sectorCount: number;
  xmpOffset: number;
  xmpLength: number;
}

export const INDD_VERSION_MAP: Record<number, string> = {
  3: 'InDesign CS (3.0)',
  4: 'InDesign CS2 (4.0)',
  5: 'InDesign CS3 (5.0)',
  6: 'InDesign CS4 (6.0)',
  7: 'InDesign CS5 (7.0)',
  8: 'InDesign CS6 (8.0)',
  9: 'InDesign CC (9.0)',
  10: 'InDesign CC 2014 (10.0)',
  11: 'InDesign CC 2015 (11.0)',
  12: 'InDesign CC 2017 (12.0)',
  13: 'InDesign CC 2018 (13.0)',
  14: 'InDesign CC 2019 (14.0)',
  15: 'InDesign CC 2020 (15.0)',
  16: 'InDesign CC 2021 (16.0)',
  17: 'InDesign CC 2022 (17.0)',
  18: 'InDesign CC 2023 (18.0)',
  19: 'InDesign CC 2024 (19.0)',
  20: 'InDesign CC 2025 (20.0)',
  21: 'InDesign CC 2026 (21.0)',
};

// InDesign Document GUID Signature Bytes
// 06 06 ED F5 D8 1D 46 E5 BD 31 EF E7 FE 74 B7 1D
const INDD_MAGIC_GUID = [
  0x06, 0x06, 0xed, 0xf5, 0xd8, 0x1d, 0x46, 0xe5,
  0xbd, 0x31, 0xef, 0xe7, 0xfe, 0x74, 0xb7, 0x1d
];

export function isInddBuffer(data: Uint8Array | ArrayBuffer): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 16) return false;

  // Plain words or an XMP snippet alone do not establish a native document.
  return INDD_MAGIC_GUID.every((byte, index) => bytes[index] === byte);
}

export function parseInddBinaryHeader(data: Uint8Array | ArrayBuffer): InddBinaryHeader | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 36) return null;

  // Verify initial GUID bytes
  if (!isInddBuffer(bytes)) return null;

  const guidHex = Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('');
  const guid = `${guidHex.slice(0, 8)}-${guidHex.slice(8, 12)}-${guidHex.slice(12, 16)}-${guidHex.slice(16, 20)}-${guidHex.slice(20, 32)}`;

  // Subtype (Bytes 16..23)
  const subtypeStr = new TextDecoder('latin1').decode(bytes.slice(16, 24));
  let fileType: InddBinaryHeader['fileType'] = 'UNKNOWN';
  if (subtypeStr.includes('DOCUMENT')) fileType = 'DOCUMENT';
  else if (subtypeStr.includes('BOOKBOOK')) fileType = 'BOOKBOOK';
  else if (subtypeStr.includes('LIBRARY')) fileType = 'LIBRARY ';

  // Endianness flag (Byte 24)
  const isLittleEndian = bytes[24] !== 0x02;
  const endianness: InddBinaryHeader['endianness'] = isLittleEndian ? 'little-endian' : 'big-endian';

  // Major Version integer (Bytes 28..31)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawVersion = view.getUint32(28, isLittleEndian);
  // Version numbers above 100 might be raw builds or bitfields, clamp to typical range
  const versionNumber = (rawVersion > 0 && rawVersion < 100) ? rawVersion : Math.max(3, (rawVersion & 0xFF));
  const versionName = INDD_VERSION_MAP[versionNumber] || `Adobe InDesign (v${versionNumber})`;

  // Sector size (Bytes 32..35)
  const rawSector = view.getUint32(32, isLittleEndian);
  const sectorSize = (rawSector === 4096 || rawSector === 8192 || rawSector === 16384) ? rawSector : 4096;

  return {
    guid,
    fileType,
    endianness,
    versionNumber,
    versionName,
    sectorSize,
  };
}

export function extractInddXmp(data: Uint8Array | ArrayBuffer): string | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const rawText = decoder.decode(bytes);

  const startIdx = rawText.indexOf('<?xpacket begin');
  if (startIdx === -1) {
    const altStart = rawText.indexOf('<x:xmpmeta');
    if (altStart === -1) return null;
    const altEnd = rawText.indexOf('</x:xmpmeta>', altStart);
    return altEnd !== -1 ? rawText.substring(altStart, altEnd + 12) : null;
  }

  const endMarker = '<?xpacket end';
  const endIdx = rawText.indexOf(endMarker, startIdx);
  if (endIdx === -1) return null;

  const closeTagEnd = rawText.indexOf('>', endIdx);
  if (closeTagEnd === -1) return null;

  return rawText.substring(startIdx, closeTagEnd + 1);
}

export function parseInddMetadata(data: Uint8Array | ArrayBuffer): InddMetadata {
  const isIndd = isInddBuffer(data);
  const xmp = extractInddXmp(data);

  const result: InddMetadata = {
    isIndd,
    pageCount: 0,
    fonts: [],
    swatches: [],
  };

  if (!xmp) {
    return result;
  }

  // 1. Document Title
  const titleMatch = xmp.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]+)<\/rdf:li>[\s\S]*?<\/dc:title>/)
    || xmp.match(/<dc:title>([^<]+)<\/dc:title>/);
  if (titleMatch) {
    result.title = titleMatch[1].trim();
  }

  // 2. Creator & CreatorTool
  const creatorMatch = xmp.match(/<dc:creator>[\s\S]*?<rdf:li>([^<]+)<\/rdf:li>[\s\S]*?<\/dc:creator>/);
  if (creatorMatch) result.creator = creatorMatch[1].trim();

  const toolMatch = xmp.match(/<xmp:CreatorTool>([^<]+)<\/xmp:CreatorTool>/);
  if (toolMatch) result.creatorTool = toolMatch[1].trim();

  // 3. Timestamps
  const createDateMatch = xmp.match(/<xmp:CreateDate>([^<]+)<\/xmp:CreateDate>/);
  if (createDateMatch) result.createDate = createDateMatch[1].trim();

  const modDateMatch = xmp.match(/<xmp:ModifyDate>([^<]+)<\/xmp:ModifyDate>/);
  if (modDateMatch) result.modifyDate = modDateMatch[1].trim();

  // 4. Page Count (xmpTPg:NPages)
  const pageMatch = xmp.match(/<xmpTPg:NPages>(\d+)<\/xmpTPg:NPages>/);
  if (pageMatch) {
    result.pageCount = parseInt(pageMatch[1], 10) || 1;
  }

  // 5. Fonts (xmpTPg:Fonts)
  const fontMatches = xmp.matchAll(/<stFnt:fontName>([^<]+)<\/stFnt:fontName>[\s\S]*?<stFnt:fontFamily>([^<]+)<\/stFnt:fontFamily>/g);
  const fontSet = new Set<string>();
  for (const match of fontMatches) {
    const name = match[1].trim();
    const family = match[2].trim();
    if (!fontSet.has(name)) {
      fontSet.add(name);
      result.fonts.push({ name, family });
    }
  }
  if (result.fonts.length === 0) {
    const simpleFonts = xmp.matchAll(/<stFnt:fontName>([^<]+)<\/stFnt:fontName>/g);
    for (const sf of simpleFonts) {
      const name = sf[1].trim();
      if (!fontSet.has(name)) {
        fontSet.add(name);
        result.fonts.push({ name, family: name.split('-')[0] || name });
      }
    }
  }

  // 6. Swatches (xmpTPg:Colorants / SwatchGroups)
  const swatchMatches = xmp.matchAll(/<xmpG:swatchName>([^<]+)<\/xmpG:swatchName>[\s\S]*?<xmpG:mode>([^<]+)<\/xmpG:mode>/g);
  const swatchSet = new Set<string>();
  for (const match of swatchMatches) {
    const name = match[1].trim();
    const mode = match[2].trim();
    if (!swatchSet.has(name)) {
      swatchSet.add(name);
      result.swatches.push({ name, mode });
    }
  }

  // 7. Embedded High-Res Thumbnail (<xmpGImg:image>)
  const thumbMatch = xmp.match(/<xmpGImg:image>([\s\S]*?)<\/xmpGImg:image>/);
  if (thumbMatch) {
    const cleanB64 = thumbMatch[1].replace(/\s+/g, '');
    if (cleanB64.length > 20) {
      result.thumbnailBase64 = cleanB64;
      result.thumbnailDataUrl = `data:image/jpeg;base64,${cleanB64}`;
    }
  }

  return result;
}

/**
 * Heuristically carves human-readable UTF-16LE text streams
 * from raw InDesign binary database sectors.
 */
export function carveUtf16Stories(data: Uint8Array | ArrayBuffer): string[] {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const stories: string[] = [];
  const minCharLength = 12;
  const decodeChars = (chars: number[]) => {
    let result = '';
    for (let index = 0; index < chars.length; index += 8192) result += String.fromCharCode(...chars.slice(index, index + 8192));
    return result.trim();
  };

  // Scan both even and odd phase offsets to catch unaligned streams
  for (const startOffset of [0, 1]) {
    let currentChars: number[] = [];
    let inString = false;

    for (let i = startOffset; i < bytes.length - 1; i += 2) {
      const lo = bytes[i];
      const hi = bytes[i + 1];

      // Standard ASCII/Latin printable range in UTF-16LE: hi === 0, lo between 32 and 126
      const isPrintable = hi === 0 && (
        (lo >= 32 && lo <= 126) ||
        lo === 10 || lo === 13 || lo === 9 ||
        (lo >= 160 && lo <= 255)
      );

      if (isPrintable) {
        currentChars.push(lo);
        inString = true;
      } else {
        if (inString && currentChars.length >= minCharLength) {
          const str = decodeChars(currentChars);
          if (str.length >= minCharLength && !str.startsWith('<?xml') && !str.startsWith('<x:') && !str.includes('xmlns:')) {
            if (/\b[a-zA-Z]{3,}\b/.test(str)) {
              stories.push(str);
            }
          }
        }
        currentChars = [];
        inString = false;
      }
    }

    if (currentChars.length >= minCharLength) {
      const str = decodeChars(currentChars);
      if (str.length >= minCharLength && !str.startsWith('<') && /\b[a-zA-Z]{3,}\b/.test(str)) {
        stories.push(str);
      }
    }
  }

  // Deduplicate and filter overlapping fragments
  const uniqueStories: string[] = [];
  const seen = new Set<string>();
  for (const s of stories) {
    if (!seen.has(s)) {
      seen.add(s);
      uniqueStories.push(s);
    }
  }

  return uniqueStories;
}

/**
 * Generates an architectural reverse engineering diagnostic report
 * analyzing the low-level database sectors of any .indd file.
 */
export function analyzeInddBinaryStructure(data: Uint8Array | ArrayBuffer): InddAnalysisReport {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const header = parseInddBinaryHeader(bytes);
  const metadata = parseInddMetadata(bytes);
  const carvedStories = carveUtf16Stories(bytes);

  const rawText = new TextDecoder('latin1').decode(bytes);
  const xmpIdx = rawText.indexOf('<?xpacket begin');
  const xmpEndIdx = rawText.indexOf('<?xpacket end', xmpIdx);
  const xmpOffset = xmpIdx !== -1 ? xmpIdx : 0;
  const xmpLength = (xmpIdx !== -1 && xmpEndIdx !== -1) ? (xmpEndIdx - xmpIdx + 20) : 0;

  const sectorSize = header?.sectorSize || 4096;
  const sectorCount = Math.ceil(bytes.length / sectorSize);

  return {
    header,
    metadata,
    carvedStories,
    totalBytes: bytes.length,
    sectorCount,
    xmpOffset,
    xmpLength,
  };
}

export function buildInddElements(
  metadata: InddMetadata,
  pageId: string,
  pageWidthMm: number = 210,
  pageHeightMm: number = 297
): CanvasElement[] {
  const elements: CanvasElement[] = [];

  // If thumbnail exists, insert as reference background element
  if (metadata.thumbnailDataUrl) {
    const thumbEl: ImageElement = {
      id: `indd-thumb-${Date.now()}`,
      name: `InDesign Preview (${metadata.title || 'Page 1'})`,
      type: 'image',
      pageId,
      x: 10,
      y: 10,
      width: pageWidthMm - 20,
      height: pageHeightMm - 50,
      rotation: 0,
      opacity: 0.95,
      zIndex: 1,
      locked: false,
      src: metadata.thumbnailDataUrl,
      fitMode: 'fit',
      borderColor: 'transparent',
      borderWidthMm: 0,
    };
    elements.push(thumbEl);
  }

  // Add metadata annotation banner
  const title = metadata.title || 'InDesign Project';
  const fontsList = metadata.fonts.map(f => f.name).slice(0, 4).join(', ') || '(not listed)';
  const swatchesList = metadata.swatches.map(s => s.name).slice(0, 4).join(', ') || '(not listed)';

  const metaEl: TextElement = {
    id: `indd-meta-${Date.now()}`,
    name: 'InDesign Metadata Card',
    type: 'text',
    pageId,
    x: 10,
    y: pageHeightMm - 36,
    width: pageWidthMm - 20,
    height: 26,
    rotation: 0,
    opacity: 1,
    zIndex: 2,
    locked: false,
    text: `RECOVERED CONTENT: ${title}\nOriginal layout unavailable. XMP page count: ${metadata.pageCount || 'unknown'}. This is an A4 recovery workspace.\nFonts listed in metadata: ${fontsList}\nColours listed in metadata: ${swatchesList}`,
    fontFamily: 'sans-serif',
    fontSizePt: 8,
    lineHeight: 1.35,
    letterSpacingPt: 0,
    color: '#0d99ff',
    alignment: 'left',
    columns: 1,
    columnGutterMm: 4,
    backgroundColor: '#090d16',
    borderColor: '#1e293b',
    borderWidthMm: 0.5,
    paddingMm: 2.5,
  };
  elements.push(metaEl);

  return elements;
}

/** Build a labelled recovery workspace, never an imitation of the original layout. */
export function parseInddToProjectState(data: Uint8Array | ArrayBuffer, fileName?: string): ProjectState {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isInddBuffer(bytes) || bytes.length < 36) throw new Error('This file has no valid INDD signature.');
  if (bytes.length > 128 * 1024 * 1024) throw new Error('Recovery supports files up to 128 MB. Export IDML for larger documents.');
  const metadata = parseInddMetadata(bytes);
  const fragments = carveUtf16Stories(bytes);
  if (!fragments.length && !metadata.thumbnailDataUrl) {
    throw new Error('No readable text fragments or preview were recovered. Export IDML from InDesign to import the document.');
  }
  const state = structuredClone(INITIAL_STATE);
  state.settings = { ...state.settings, title: `${metadata.title || fileName?.replace(/\.[^/.]+$/, '') || 'InDesign document'} (Recovered content)`,
    preset: 'A4', widthMm: 210, heightMm: 297, facingPages: false,
    columnCount: 1, baselineGrid: { enabled: false, incrementPt: 12, startMm: 20 } };
  state.spreads = [];
  state.masterSpreads = [];
  state.paragraphStyles = [];
  state.characterStyles = [];
  state.embeddedFonts = [];
  state.crossReferences = [];
  state.indexEntries = [];
  state.comments = [];
  state.selectedElementId = null;
  state.selectedElementIds = [];
  state.activeSpreadIndex = 0;
  state.panX = 0; state.panY = 0; state.zoom = 0.85;
  state.showBaselineGrid = false;
  if (metadata.thumbnailDataUrl) {
    state.spreads.push({ id: 'indd-preview', spreadIndex: 0,
      pages: [{ id: 'indd-preview-page', pageNumber: 1, side: 'single' }],
      elements: buildInddElements(metadata, 'indd-preview-page') });
  }
  if (fragments.length) {
    const pageId = 'indd-fragments-page';
    const text = fragments.map((fragment, index) => `[Recovered fragment ${index + 1}]\n${fragment}`).join('\n\n');
    const frame: TextElement = {
      id: 'indd-recovered-text', name: 'Recovered fragments (original order unknown)', type: 'text', pageId,
      x: 20, y: 20, width: 170, height: 235, rotation: 0, opacity: 1, zIndex: 1, locked: false,
      text, rawStoryText: text, fontFamily: 'serif', fontSizePt: 11, lineHeight: 1.4,
      letterSpacingPt: 0, color: '#111111', alignment: 'left', columns: 1, columnGutterMm: 4,
      paddingMm: 2, backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0,
    };
    const report = buildInddElements({ ...metadata, thumbnailDataUrl: undefined }, pageId);
    state.spreads.push({ id: 'indd-fragments', spreadIndex: state.spreads.length,
      pages: [{ id: pageId, pageNumber: state.spreads.length + 1, side: 'single' }], elements: [frame, ...report] });
    state.activeSpreadIndex = state.spreads.length - 1;
    state.selectedElementId = frame.id; state.selectedElementIds = [frame.id];
  }
  return state;
}
