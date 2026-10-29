import {
  ProjectState,
  Spread,
  Page,
  TextElement,
  ImageElement,
  ShapeElement,
  ParagraphStyle,
  DocumentSettings,
  CanvasElement,
  DEFAULT_LAYERS,
} from './types';
import { readZip, uint8ArrayToBase64 } from './zip';
import { DEFAULT_PARAGRAPH_STYLES, DEFAULT_MASTER_SPREADS } from './state';
import { isInddBuffer, parseInddToProjectState } from './engine/inddParser';

const PT_TO_MM = 25.4 / 72; // 1 point = 0.352778 mm

export function extractXmlAttr(xml: string, attr: string): string | null {
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}

export function extractXmlTags(xml: string, tagName: string): string[] {
  const results: string[] = [];
  const openTag = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = openTag.exec(xml)) !== null) {
    const start = match.index;
    const tagHeader = match[0];
    if (tagHeader.endsWith('/>')) {
      results.push(tagHeader);
    } else {
      const closeTagStr = `</${tagName}>`;
      const endIdx = xml.indexOf(closeTagStr, start);
      if (endIdx !== -1) {
        results.push(xml.slice(start, endIdx + closeTagStr.length));
      } else {
        results.push(tagHeader);
      }
    }
  }
  return results;
}

export function parseTransform(str: string | null | undefined): [number, number, number, number, number, number] {
  if (!str) return [1, 0, 0, 1, 0, 0];
  const parts = str.trim().split(/\s+/).map(Number);
  if (parts.length >= 6 && !parts.some(isNaN)) {
    return parts as [number, number, number, number, number, number];
  }
  return [1, 0, 0, 1, 0, 0];
}

export interface PageSpreadBox {
  id: string;
  name: string;
  pageNumber: number;
  spreadLeft: number;
  spreadTop: number;
  spreadRight: number;
  spreadBottom: number;
  widthMm: number;
  heightMm: number;
  side: 'left' | 'right' | 'single';
}

export function parseSpreadPages(
  spreadXml: string,
  startPageNumber: number,
  facingPages: boolean,
  defaultWidthMm: number,
  defaultHeightMm: number
): PageSpreadBox[] {
  const pageMatches = spreadXml.match(/<Page\b[\s\S]*?<\/Page>/gi) || spreadXml.match(/<Page\b[^>]*\/>/gi) || [];
  const pages: PageSpreadBox[] = [];

  let pNum = startPageNumber;
  for (let idx = 0; idx < pageMatches.length; idx++) {
    const pXml = pageMatches[idx];
    const id = extractXmlAttr(pXml, 'Self') || `idml-p-${pNum}`;
    const name = extractXmlAttr(pXml, 'Name') || `${pNum}`;
    const geomStr = extractXmlAttr(pXml, 'GeometricBounds');
    const transStr = extractXmlAttr(pXml, 'ItemTransform');

    const defaultHPt = defaultHeightMm / PT_TO_MM;
    const defaultWPt = defaultWidthMm / PT_TO_MM;
    const geomParts = (geomStr || `0 0 ${defaultHPt} ${defaultWPt}`).trim().split(/\s+/).map(Number);
    const [y1, x1, y2, x2] = geomParts.length >= 4 && !geomParts.some(isNaN) ? geomParts : [0, 0, defaultHPt, defaultWPt];
    const [a, b, c, d, tx, ty] = parseTransform(transStr);

    const left = x1 + tx;
    const top = y1 + ty;
    const right = x2 + tx;
    const bottom = y2 + ty;

    const wPt = Math.abs(x2 - x1) || defaultWPt;
    const hPt = Math.abs(y2 - y1) || defaultHPt;

    let side: 'left' | 'right' | 'single' = 'single';
    if (facingPages) {
      if (pageMatches.length === 1) {
        side = pNum % 2 === 0 ? 'left' : 'right';
      } else {
        side = idx === 0 ? 'left' : 'right';
      }
    }

    pages.push({
      id,
      name,
      pageNumber: pNum,
      spreadLeft: Math.min(left, right),
      spreadTop: Math.min(top, bottom),
      spreadRight: Math.max(left, right),
      spreadBottom: Math.max(top, bottom),
      widthMm: Math.round(wPt * PT_TO_MM * 10) / 10,
      heightMm: Math.round(hPt * PT_TO_MM * 10) / 10,
      side,
    });
    pNum++;
  }

  if (pages.length === 0) {
    pages.push({
      id: `idml-p-${startPageNumber}`,
      name: `${startPageNumber}`,
      pageNumber: startPageNumber,
      spreadLeft: 0,
      spreadTop: 0,
      spreadRight: defaultWidthMm / PT_TO_MM,
      spreadBottom: defaultHeightMm / PT_TO_MM,
      widthMm: defaultWidthMm,
      heightMm: defaultHeightMm,
      side: facingPages ? 'right' : 'single',
    });
  }

  return pages;
}

export function parseElementSpreadBounds(
  elXml: string,
  defaultXPt: number = 56.7,
  defaultYPt: number = 56.7
): { spreadLeft: number; spreadTop: number; widthPt: number; heightPt: number } {
  const transStr = extractXmlAttr(elXml, 'ItemTransform');
  const [a, b, c, d, tx, ty] = parseTransform(transStr);

  let geomBoundsParsed: { spreadLeft: number; spreadTop: number; widthPt: number; heightPt: number } | null = null;
  let geomStr = extractXmlAttr(elXml, 'GeometricBounds');
  if (!geomStr) {
    const tagMatch = elXml.match(/<GeometricBounds\b[^>]*>([\s\S]*?)<\/GeometricBounds>/i);
    if (tagMatch) {
      geomStr = tagMatch[1].replace(/<[^>]+>/g, ' ').trim();
    }
  }

  if (geomStr) {
    const parts = geomStr.trim().split(/\s+/).map(Number);
    if (parts.length >= 4 && !parts.some(isNaN)) {
      const [y1, x1, y2, x2] = parts;
      const wx1 = a * x1 + c * y1 + tx;
      const wy1 = b * x1 + d * y1 + ty;
      const wx2 = a * x2 + c * y2 + tx;
      const wy2 = b * x2 + d * y2 + ty;
      const minX = Math.min(wx1, wx2);
      const maxX = Math.max(wx1, wx2);
      const minY = Math.min(wy1, wy2);
      const maxY = Math.max(wy1, wy2);
      geomBoundsParsed = {
        spreadLeft: minX,
        spreadTop: minY,
        widthPt: Math.max(10, maxX - minX),
        heightPt: Math.max(10, maxY - minY),
      };
    }
  }

  // Check PathGeometry anchors
  const pathMatches = elXml.match(/<PathPointType\b[^>]*Anchor="([^"]+)"/gi);
  if (pathMatches && pathMatches.length > 0) {
    const worldXs: number[] = [];
    const worldYs: number[] = [];

    for (const pm of pathMatches) {
      const anchor = pm.match(/Anchor="([^"]+)"/)?.[1];
      if (anchor) {
        const [ax, ay] = anchor.trim().split(/\s+/).map(Number);
        if (!isNaN(ax) && !isNaN(ay)) {
          const wx = a * ax + c * ay + tx;
          const wy = b * ax + d * ay + ty;
          worldXs.push(wx);
          worldYs.push(wy);
        }
      }
    }

    if (worldXs.length > 0) {
      const minX = Math.min(...worldXs);
      const maxX = Math.max(...worldXs);
      const minY = Math.min(...worldYs);
      const maxY = Math.max(...worldYs);
      const pathW = Math.max(10, maxX - minX);
      const pathH = Math.max(10, maxY - minY);

      if (geomBoundsParsed) {
        return {
          spreadLeft: minX,
          spreadTop: minY,
          widthPt: Math.max(pathW, geomBoundsParsed.widthPt),
          heightPt: Math.max(pathH, geomBoundsParsed.heightPt),
        };
      }

      return {
        spreadLeft: minX,
        spreadTop: minY,
        widthPt: pathW,
        heightPt: pathH,
      };
    }
  }

  if (geomBoundsParsed) {
    return geomBoundsParsed;
  }

  return {
    spreadLeft: defaultXPt,
    spreadTop: defaultYPt,
    widthPt: 200,
    heightPt: 100,
  };
}

export function parseGeometricBounds(xmlOrBoundsStr: string | null): { x: number; y: number; width: number; height: number } {
  if (!xmlOrBoundsStr) return { x: 20, y: 20, width: 60, height: 40 };
  const bounds = parseElementSpreadBounds(xmlOrBoundsStr, 56.7, 56.7);
  return {
    x: Math.round(Math.max(0, bounds.spreadLeft * PT_TO_MM) * 10) / 10,
    y: Math.round(Math.max(0, bounds.spreadTop * PT_TO_MM) * 10) / 10,
    width: Math.round(bounds.widthPt * PT_TO_MM * 10) / 10,
    height: Math.round(bounds.heightPt * PT_TO_MM * 10) / 10,
  };
}

function distributeStoryAcrossFrames(chain: TextElement[], fullStoryText: string) {
  if (chain.length === 0) return;
  const headFrame = chain[0];
  headFrame.rawStoryText = fullStoryText;

  if (chain.length === 1) {
    headFrame.text = fullStoryText;
    return;
  }

  const words = fullStoryText.split(/\s+/).filter(Boolean);
  let wordIdx = 0;

  for (let i = 0; i < chain.length; i++) {
    const frame = chain[i];
    if (wordIdx >= words.length) {
      frame.text = '';
      continue;
    }

    const isLastFrame = (i === chain.length - 1);
    if (isLastFrame) {
      frame.text = words.slice(wordIdx).join(' ');
      wordIdx = words.length;
    } else {
      const padding = frame.paddingMm || 0;
      const availHeightMm = Math.max(10, frame.height - (padding * 2));
      const availWidthMm = Math.max(10, frame.width - (padding * 2));
      const fontSizeMm = (frame.fontSizePt * 25.4) / 72;
      const lineSpacingMm = fontSizeMm * (frame.lineHeight || 1.3);
      const colCount = Math.max(1, frame.columns || 1);
      const gutterMm = frame.columnGutterMm || 4;
      const singleColWidthMm = Math.max(10, (availWidthMm - (gutterMm * (colCount - 1))) / colCount);

      const linesPerCol = Math.max(1, Math.floor(availHeightMm / lineSpacingMm));
      const totalLines = linesPerCol * colCount;

      const avgCharWidthMm = Math.max(1.2, fontSizeMm * 0.48);
      const charsPerLine = Math.max(15, Math.floor(singleColWidthMm / avgCharWidthMm));
      const wordsPerLine = Math.max(3, Math.floor(charsPerLine / 5.2));
      const frameWordCapacity = Math.max(5, totalLines * wordsPerLine);

      const frameWords = words.slice(wordIdx, wordIdx + frameWordCapacity);
      frame.text = frameWords.join(' ');
      wordIdx += frameWordCapacity;
    }
  }
}

function isDarkColor(hex: string): boolean {
  if (!hex || hex === 'transparent') return false;
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return false;
  const num = parseInt(clean, 16);
  if (isNaN(num)) return false;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return (r * 0.299 + g * 0.587 + b * 0.114) < 135;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseIdmlColors(files: Map<string, Uint8Array>): Map<string, string> {
  const colorsMap = new Map<string, string>();
  colorsMap.set('Color/Black', '#000000');
  colorsMap.set('Color/Paper', '#ffffff');
  colorsMap.set('Color/None', 'transparent');
  colorsMap.set('Swatch/None', 'transparent');
  colorsMap.set('None', 'transparent');
  colorsMap.set('n', 'transparent');
  colorsMap.set('kInvalidRef', 'transparent');

  for (const [filename, content] of files.entries()) {
    if (filename.toLowerCase().includes('graphic.xml') || filename.toLowerCase().includes('colors.xml')) {
      const xml = new TextDecoder().decode(content);
      const colorTags = extractXmlTags(xml, 'Color');
      for (const cTag of colorTags) {
        const self = extractXmlAttr(cTag, 'Self');
        const space = (extractXmlAttr(cTag, 'Space') || 'CMYK').toUpperCase();
        const valStr = extractXmlAttr(cTag, 'ColorValue') || '';
        let vals = valStr.trim().split(/\s+/).map(Number).filter((n) => !isNaN(n));
        if (vals.length < 3) {
          const itemMatches = cTag.match(/<ListItem\b[^>]*>([\d\.\-]+)<\/ListItem>/gi);
          if (itemMatches) {
            vals = itemMatches.map((m) => parseFloat(m.replace(/<[^>]+>/g, '').trim())).filter((n) => !isNaN(n));
          }
        }
        if (self && vals.length >= 3) {
          if (space === 'RGB') {
            const r = Math.min(255, Math.max(0, Math.round(vals[0])));
            const g = Math.min(255, Math.max(0, Math.round(vals[1])));
            const b = Math.min(255, Math.max(0, Math.round(vals[2])));
            const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
            colorsMap.set(self, hex);
            colorsMap.set(self.replace(/^(Color|Swatch)\//, ''), hex);
          } else {
            const c = (vals[0] || 0) / 100;
            const m = (vals[1] || 0) / 100;
            const y = (vals[2] || 0) / 100;
            const k = (vals[3] || 0) / 100;
            const r = Math.round(255 * (1 - c) * (1 - k));
            const g = Math.round(255 * (1 - m) * (1 - k));
            const b = Math.round(255 * (1 - y) * (1 - k));
            const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
            colorsMap.set(self, hex);
            colorsMap.set(self.replace(/^(Color|Swatch)\//, ''), hex);
          }
        }
      }

      const tintTags = extractXmlTags(xml, 'Tint');
      for (const tTag of tintTags) {
        const self = extractXmlAttr(tTag, 'Self');
        const baseColor = extractXmlAttr(tTag, 'BaseColor');
        const tintVal = parseFloat(extractXmlAttr(tTag, 'TintValue') || '100');
        if (self && baseColor) {
          const baseHex = colorsMap.get(baseColor) || colorsMap.get(baseColor.replace(/^(Color|Swatch)\//, ''));
          if (baseHex && baseHex !== 'transparent') {
            const tinted = resolveIdmlColor(baseColor, tintVal, colorsMap);
            colorsMap.set(self, tinted);
            colorsMap.set(self.replace(/^(Color|Swatch)\//, ''), tinted);
          }
        }
      }
    }
  }
  return colorsMap;
}

export function resolveIdmlColor(
  colorRef: string | null | undefined,
  tint: number | null | undefined,
  colorsMap: Map<string, string>
): string {
  if (!colorRef || colorRef === 'n' || colorRef === 'None' || colorRef === 'Swatch/None' || colorRef === 'Color/None' || colorRef === 'kInvalidRef') {
    return 'transparent';
  }
  const cleanRef = colorRef.replace(/^(Color|Swatch)\//, '');
  let hex = colorsMap.get(colorRef) || colorsMap.get(cleanRef) || colorsMap.get(`Color/${cleanRef}`) || colorsMap.get(`Swatch/${cleanRef}`);
  if (!hex) {
    if (cleanRef.toLowerCase() === 'paper') return '#ffffff';
    if (cleanRef.toLowerCase() === 'black') return '#000000';
    const cmykMatch = colorRef.match(/C=(\d+)\s*M=(\d+)\s*Y=(\d+)\s*K=(\d+)/i);
    if (cmykMatch) {
      const c = Number(cmykMatch[1]) / 100;
      const m = Number(cmykMatch[2]) / 100;
      const y = Number(cmykMatch[3]) / 100;
      const k = Number(cmykMatch[4]) / 100;
      const r = Math.round(255 * (1 - c) * (1 - k));
      const g = Math.round(255 * (1 - m) * (1 - k));
      const b = Math.round(255 * (1 - y) * (1 - k));
      hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    } else {
      hex = '#1a1a1a';
    }
  }

  if (hex === 'transparent') return 'transparent';

  if (tint !== undefined && tint !== null && tint >= 0 && tint < 100) {
    const cleanHex = hex.replace('#', '');
    const num = parseInt(cleanHex, 16);
    if (!isNaN(num) && cleanHex.length === 6) {
      const r = (num >> 16) & 255;
      const g = (num >> 8) & 255;
      const b = num & 255;
      const t = Math.max(0, Math.min(100, tint)) / 100;
      const tr = Math.round(255 - (255 - r) * t);
      const tg = Math.round(255 - (255 - g) * t);
      const tb = Math.round(255 - (255 - b) * t);
      return '#' + ((1 << 24) + (tr << 16) + (tg << 8) + tb).toString(16).slice(1);
    }
  }
  return hex;
}

export async function parseIdmlPackage(idmlBuffer: ArrayBuffer | Uint8Array, fileName?: string): Promise<ProjectState> {
  if (isInddBuffer(idmlBuffer)) {
    return parseInddToProjectState(idmlBuffer, fileName);
  }
  const files = await readZip(idmlBuffer);
  const textDecoder = new TextDecoder();
  const colorsMap = parseIdmlColors(files);

  // 1. Parse Preferences & Document Settings
  let pageWidthMm = 210; // Default A4
  let pageHeightMm = 297;
  let facingPages = true;
  let bleedMm = 3;
  let topMarginMm = 20;
  let bottomMarginMm = 20;
  let insideMarginMm = 25;
  let outsideMarginMm = 18;
  let columnCount = 2;
  let columnGutterMm = 5;
  let docTitle = 'Imported InDesign Project';

  const prefFile = files.get('Resources/Preferences.xml') || files.get('designmap.xml');
  if (prefFile) {
    const xml = textDecoder.decode(prefFile);
    const pwPt = parseFloat(extractXmlAttr(xml, 'PageWidth') || '595.276');
    const phPt = parseFloat(extractXmlAttr(xml, 'PageHeight') || '841.89');
    if (!isNaN(pwPt) && pwPt > 0) pageWidthMm = Math.round(pwPt * PT_TO_MM * 10) / 10;
    if (!isNaN(phPt) && phPt > 0) pageHeightMm = Math.round(phPt * PT_TO_MM * 10) / 10;

    const fpAttr = extractXmlAttr(xml, 'FacingPages');
    const ppsAttr = extractXmlAttr(xml, 'PagesPerSpread');
    if (fpAttr !== null) facingPages = fpAttr.toLowerCase() === 'true';
    else if (ppsAttr !== null) facingPages = parseInt(ppsAttr) > 1;

    const bleedPt = parseFloat(extractXmlAttr(xml, 'DocumentBleedTopOffset') || '8.5');
    if (!isNaN(bleedPt) && bleedPt > 0) bleedMm = Math.round(bleedPt * PT_TO_MM * 10) / 10;

    const topPt = parseFloat(extractXmlAttr(xml, 'Top') || '56.7');
    const btmPt = parseFloat(extractXmlAttr(xml, 'Bottom') || '56.7');
    const leftPt = parseFloat(extractXmlAttr(xml, 'Left') || '70.8');
    const rightPt = parseFloat(extractXmlAttr(xml, 'Right') || '51.0');
    if (!isNaN(topPt)) topMarginMm = Math.round(topPt * PT_TO_MM);
    if (!isNaN(btmPt)) bottomMarginMm = Math.round(btmPt * PT_TO_MM);
    if (!isNaN(leftPt)) insideMarginMm = Math.round(leftPt * PT_TO_MM);
    if (!isNaN(rightPt)) outsideMarginMm = Math.round(rightPt * PT_TO_MM);

    const cols = parseInt(extractXmlAttr(xml, 'ColumnCount') || '2');
    if (!isNaN(cols) && cols >= 1) columnCount = cols;
    const gutterPt = parseFloat(extractXmlAttr(xml, 'ColumnGutter') || '14.17');
    if (!isNaN(gutterPt)) columnGutterMm = Math.round(gutterPt * PT_TO_MM);
  }

  // 2. Parse Paragraph Styles from Resources/Styles.xml
  const parsedStyles: ParagraphStyle[] = [...DEFAULT_PARAGRAPH_STYLES];
  const stylesFile = files.get('Resources/Styles.xml');
  if (stylesFile) {
    const xml = textDecoder.decode(stylesFile);
    const pStyleTags = extractXmlTags(xml, 'ParagraphStyle');

    for (const tag of pStyleTags) {
      const name = extractXmlAttr(tag, 'Name');
      if (!name || name.startsWith('$ID') || name === 'NormalParagraphStyle') continue;

      const ptSize = parseFloat(extractXmlAttr(tag, 'PointSize') || '10');
      const leadingPt = parseFloat(extractXmlAttr(tag, 'Leading') || '13');
      const just = extractXmlAttr(tag, 'Justification') || 'LeftAlign';

      let alignment: 'left' | 'center' | 'right' | 'justify' = 'left';
      if (just.includes('Center')) alignment = 'center';
      else if (just.includes('Right')) alignment = 'right';
      else if (just.includes('Just')) alignment = 'justify';

      const styleId = `idml-style-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      if (!parsedStyles.some((s) => s.id === styleId)) {
        parsedStyles.push({
          id: styleId,
          name,
          fontFamily: extractXmlAttr(tag, 'AppliedFont') || 'serif',
          fontSizePt: !isNaN(ptSize) ? ptSize : 10,
          lineHeight: !isNaN(leadingPt) && !isNaN(ptSize) && ptSize > 0 ? Math.round((leadingPt / ptSize) * 100) / 100 : 1.3,
          letterSpacingPt: 0,
          color: '#1a1a1a',
          alignment,
          snapToBaseline: true,
          dropCapLines: parseInt(extractXmlAttr(tag, 'DropCapLines') || '0') || 0,
        });
      }
    }
  }

  // 3. Parse Stories from Stories/Story_*.xml
  const storiesMap = new Map<
    string,
    {
      text: string;
      styleId?: string;
      fontSizePt?: number;
      fontFamily?: string;
      lineHeight?: number;
      alignment?: 'left' | 'center' | 'right' | 'justify';
      color?: string;
      grepStyles?: { pattern: string; color: string; bold?: boolean; italic?: boolean }[];
    }
  >();

  for (const [filename, content] of files.entries()) {
    if (filename.startsWith('Stories/Story_') && filename.endsWith('.xml')) {
      const xml = textDecoder.decode(content);
      const storyId = extractXmlAttr(xml, 'Self') || filename.replace('Stories/', '').replace('.xml', '');

      const pRanges = extractXmlTags(xml, 'ParagraphStyleRange');
      const paragraphs: string[] = [];
      let detectedStyleId: string | undefined;
      let detectedFontSize: number | undefined;
      let detectedFontFamily: string | undefined;
      let detectedLineHeight: number | undefined;
      let detectedAlignment: 'left' | 'center' | 'right' | 'justify' | undefined;
      let detectedColor: string | undefined;
      const storyGrepRules: { pattern: string; color: string; bold?: boolean; italic?: boolean }[] = [];

      for (const pr of pRanges) {
        const applied = extractXmlAttr(pr, 'AppliedParagraphStyle');
        if (applied) {
          const cleanName = applied.replace('ParagraphStyle/', '');
          const match = parsedStyles.find((s) => s.name.toLowerCase() === cleanName.toLowerCase());
          if (match && !detectedStyleId) detectedStyleId = match.id;
        }

        const just = extractXmlAttr(pr, 'Justification') || '';
        if (just.includes('Center')) detectedAlignment = 'center';
        else if (just.includes('Right')) detectedAlignment = 'right';
        else if (just.includes('Just')) detectedAlignment = 'justify';
        else if (just.includes('Left')) detectedAlignment = 'left';

        // Extract content and breaks within paragraph
        const cRanges = extractXmlTags(pr, 'CharacterStyleRange');
        const paraTokens: string[] = [];

        for (const cr of cRanges) {
          const ptSize = parseFloat(extractXmlAttr(cr, 'PointSize') || '');
          if (!isNaN(ptSize) && ptSize > 0 && !detectedFontSize) detectedFontSize = ptSize;

          const appliedFont = extractXmlAttr(cr, 'AppliedFont') || cr.match(/<AppliedFont[^>]*>([^<]+)<\/AppliedFont>/)?.[1];
          if (appliedFont && !detectedFontFamily) detectedFontFamily = appliedFont.trim();

          const leading = parseFloat(cr.match(/<Leading[^>]*>([^<]+)<\/Leading>/)?.[1] || '');
          if (!isNaN(leading) && detectedFontSize && !detectedLineHeight) {
            detectedLineHeight = Math.round((leading / detectedFontSize) * 100) / 100;
          }

          const crFillColorAttr = extractXmlAttr(cr, 'FillColor');
          const crFillTintAttr = parseFloat(extractXmlAttr(cr, 'FillTint') || '100');
          let crResolvedColor: string | undefined = undefined;
          if (crFillColorAttr) {
            crResolvedColor = resolveIdmlColor(crFillColorAttr, isNaN(crFillTintAttr) ? undefined : crFillTintAttr, colorsMap);
          }

          if (crResolvedColor && crResolvedColor !== 'transparent' && !detectedColor) {
            detectedColor = crResolvedColor;
          }

          // Read Content and Br
          const tokens = cr.match(/<Content[^>]*>([\s\S]*?)<\/Content>|<Br\s*\/?>/gi) || [];
          const rangeTokens: string[] = [];
          for (const tok of tokens) {
            if (tok.toLowerCase().startsWith('<br')) {
              paraTokens.push('\n');
              rangeTokens.push('\n');
            } else {
              const textContent = tok.replace(/<Content[^>]*>/, '').replace(/<\/Content>/, '');
              paraTokens.push(textContent);
              rangeTokens.push(textContent);
            }
          }

          const rangeText = rangeTokens.join('').trim();
          if (crResolvedColor && crResolvedColor !== 'transparent' && rangeText.length > 0 && rangeText.length <= 80 && !/[\r\n]/.test(rangeText)) {
            const fontStyle = (extractXmlAttr(cr, 'FontStyle') || '').toLowerCase();
            storyGrepRules.push({
              pattern: escapeRegex(rangeText),
              color: crResolvedColor,
              bold: fontStyle.includes('bold'),
              italic: fontStyle.includes('italic'),
            });
          }
        }

        const paraStr = paraTokens.join('');
        if (paraStr.length > 0) {
          paragraphs.push(paraStr);
        }
      }

      let fullText = paragraphs.join('\n');
      // Entity decoding
      fullText = fullText
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");

      if (!fullText.trim()) {
        fullText = 'Imported text frame content';
      }

      const uniqueGrepRules: { pattern: string; color: string; bold?: boolean; italic?: boolean }[] = [];
      const seenPatterns = new Set<string>();
      for (const rule of storyGrepRules) {
        const key = `${rule.pattern}:${rule.color}:${rule.bold}:${rule.italic}`;
        if (!seenPatterns.has(key)) {
          seenPatterns.add(key);
          uniqueGrepRules.push(rule);
        }
      }

      storiesMap.set(storyId, {
        text: fullText,
        styleId: detectedStyleId,
        fontSizePt: detectedFontSize,
        fontFamily: detectedFontFamily,
        lineHeight: detectedLineHeight,
        alignment: detectedAlignment,
        color: detectedColor,
        grepStyles: uniqueGrepRules.length > 0 ? uniqueGrepRules : undefined,
      });
    }
  }

  // 4. Determine Spread Sequence from designmap.xml
  let spreadFileOrder: string[] = [];
  const designmapFile = files.get('designmap.xml');
  if (designmapFile) {
    const dmXml = textDecoder.decode(designmapFile);
    const spreadSrcMatches = Array.from(dmXml.matchAll(/<idPkg:Spread\s+src="([^"]+)"/gi)).map((m) => m[1]);
    if (spreadSrcMatches.length > 0) {
      spreadFileOrder = spreadSrcMatches;
    }
  }

  if (spreadFileOrder.length === 0) {
    spreadFileOrder = Array.from(files.keys())
      .filter((f) => f.startsWith('Spreads/Spread_') && f.endsWith('.xml'))
      .sort();
  }

  // 5. Parse Spreads and Elements
  const spreads: Spread[] = [];
  let globalPageCounter = 1;

  for (let sIdx = 0; sIdx < spreadFileOrder.length; sIdx++) {
    const sFile = spreadFileOrder[sIdx];
    const sContent = files.get(sFile);
    if (!sContent) continue;

    const xml = textDecoder.decode(sContent);
    const parsedPages = parseSpreadPages(xml, globalPageCounter, facingPages, pageWidthMm, pageHeightMm);
    globalPageCounter += parsedPages.length;

    // Adopt document width/height from the first parsed page if appropriate
    if (sIdx === 0 && parsedPages[0]) {
      pageWidthMm = parsedPages[0].widthMm;
      pageHeightMm = parsedPages[0].heightMm;
    }

    const pages: Page[] = parsedPages.map((p) => ({
      id: p.id,
      pageNumber: p.pageNumber,
      side: p.side,
    }));

    const spreadElements: CanvasElement[] = [];

    // Helper to find target page for an element in spread coordinates
    const findTargetPage = (b: { spreadLeft: number; spreadTop: number; widthPt: number; heightPt: number }): { page: PageSpreadBox; localX: number; localY: number } => {
      const centerSpreadX = b.spreadLeft + b.widthPt / 2;
      let target = parsedPages[0];
      for (const p of parsedPages) {
        if (centerSpreadX >= p.spreadLeft && centerSpreadX <= p.spreadRight) {
          target = p;
          break;
        }
      }
      const localX = Math.round((b.spreadLeft - target.spreadLeft) * PT_TO_MM * 10) / 10;
      const localY = Math.round((b.spreadTop - target.spreadTop) * PT_TO_MM * 10) / 10;
      return { page: target, localX, localY };
    };

    // Parse Text Frames
    const textFrameTags = extractXmlTags(xml, 'TextFrame');
    for (let tfIdx = 0; tfIdx < textFrameTags.length; tfIdx++) {
      const tfXml = textFrameTags[tfIdx];
      const b = parseElementSpreadBounds(tfXml);
      const { page: targetPage, localX, localY } = findTargetPage(b);

      const parentStory = extractXmlAttr(tfXml, 'ParentStory');
      const storyData = parentStory ? storiesMap.get(parentStory) : null;

      const cols = parseInt(extractXmlAttr(tfXml, 'TextColumnCount') || '1') || 1;
      const colGutterPt = parseFloat(extractXmlAttr(tfXml, 'TextColumnGutter') || '12');
      const colGutterMm = !isNaN(colGutterPt) ? Math.round(colGutterPt * PT_TO_MM) : 4;

      const widthMm = Math.max(5, Math.round(b.widthPt * PT_TO_MM * 10) / 10);
      const heightMm = Math.max(5, Math.round(b.heightPt * PT_TO_MM * 10) / 10);

      const selfId = extractXmlAttr(tfXml, 'Self');
      const elId = selfId ? `idml-${selfId}` : `idml-text-${sIdx}-${tfIdx}`;

      let paddingMm = 0;
      const insetMatch = tfXml.match(/(?:TextInset|InsetSpacing)="([^"]+)"/i);
      if (insetMatch) {
        const insetVals = insetMatch[1].trim().split(/\s+/).map(Number);
        if (insetVals.length > 0 && !isNaN(insetVals[0])) {
          paddingMm = Math.round(insetVals[0] * PT_TO_MM * 10) / 10;
        }
      }

      const tfFillColorAttr = extractXmlAttr(tfXml, 'FillColor');
      const tfFillTintAttr = parseFloat(extractXmlAttr(tfXml, 'FillTint') || '100');
      const tfBgColor = tfFillColorAttr
        ? resolveIdmlColor(tfFillColorAttr, isNaN(tfFillTintAttr) ? undefined : tfFillTintAttr, colorsMap)
        : 'transparent';

      const tfStrokeColorAttr = extractXmlAttr(tfXml, 'StrokeColor');
      const tfStrokeTintAttr = parseFloat(extractXmlAttr(tfXml, 'StrokeTint') || '100');
      const tfStrokeWeightPt = parseFloat(extractXmlAttr(tfXml, 'StrokeWeight') || '0');
      const tfBorderColor = (!isNaN(tfStrokeWeightPt) && tfStrokeWeightPt > 0 && tfStrokeColorAttr)
        ? resolveIdmlColor(tfStrokeColorAttr, isNaN(tfStrokeTintAttr) ? undefined : tfStrokeTintAttr, colorsMap)
        : 'transparent';
      const tfBorderWidthMm = (!isNaN(tfStrokeWeightPt) && tfStrokeWeightPt > 0 && tfBorderColor !== 'transparent')
        ? Math.round(tfStrokeWeightPt * PT_TO_MM * 10) / 10
        : 0;

      let vj = extractXmlAttr(tfXml, 'VerticalJustification');
      if (!vj) {
        const tfPrefMatch = tfXml.match(/<TextFramePreference\b[^>]*>/i);
        if (tfPrefMatch) {
          vj = extractXmlAttr(tfPrefMatch[0], 'VerticalJustification');
        }
      }
      let verticalAlign: 'top' | 'middle' | 'bottom' | undefined = undefined;
      if (vj?.includes('Center')) verticalAlign = 'middle';
      else if (vj?.includes('Bottom')) verticalAlign = 'bottom';
      else if (vj?.includes('Top')) verticalAlign = 'top';

      let textColor = storyData?.color || '#1a1a1a';
      if (!storyData?.color || storyData.color === '#1a1a1a' || storyData.color === '#000000') {
        if (tfBgColor !== 'transparent' && isDarkColor(tfBgColor)) {
          textColor = '#ffffff';
        }
      }

      const textEl: TextElement & { parentStoryId?: string } = {
        id: elId,
        type: 'text',
        pageId: targetPage.id,
        x: localX,
        y: localY,
        width: widthMm,
        height: heightMm,
        rotation: 0,
        opacity: 1,
        zIndex: 10 + tfIdx,
        locked: false,
        text: storyData ? storyData.text : 'Text Frame',
        fontFamily: storyData?.fontFamily || 'serif',
        fontSizePt: storyData?.fontSizePt || 10,
        lineHeight: storyData?.lineHeight || 1.3,
        letterSpacingPt: 0,
        color: textColor,
        alignment: storyData?.alignment || 'left',
        columns: cols,
        columnGutterMm,
        backgroundColor: tfBgColor,
        borderColor: tfBorderColor,
        borderWidthMm: tfBorderWidthMm,
        verticalAlign,
        paddingMm,
        paragraphStyleId: storyData?.styleId,
      };

      if (storyData?.grepStyles && storyData.grepStyles.length > 0) {
        (textEl as any).grepStyles = storyData.grepStyles;
      }

      if (parentStory) {
        (textEl as any).parentStoryId = parentStory;
      }

      const nextFrame = extractXmlAttr(tfXml, 'NextTextFrame');
      const prevFrame = extractXmlAttr(tfXml, 'PreviousTextFrame');
      if (nextFrame && nextFrame !== 'kInvalidRef') textEl.nextFrameId = `idml-${nextFrame}`;
      if (prevFrame && prevFrame !== 'kInvalidRef') textEl.prevFrameId = `idml-${prevFrame}`;

      spreadElements.push(textEl);
    }

    // Parse Rectangles (Shapes & Images)
    const rectTags = extractXmlTags(xml, 'Rectangle');
    for (let rIdx = 0; rIdx < rectTags.length; rIdx++) {
      const rXml = rectTags[rIdx];
      const b = parseElementSpreadBounds(rXml);
      const { page: targetPage, localX, localY } = findTargetPage(b);

      const widthMm = Math.max(5, Math.round(b.widthPt * PT_TO_MM * 10) / 10);
      const heightMm = Math.max(5, Math.round(b.heightPt * PT_TO_MM * 10) / 10);

      const rFillColorAttr = extractXmlAttr(rXml, 'FillColor');
      const rFillTintAttr = parseFloat(extractXmlAttr(rXml, 'FillTint') || '100');
      const rFillColor = rFillColorAttr
        ? resolveIdmlColor(rFillColorAttr, isNaN(rFillTintAttr) ? undefined : rFillTintAttr, colorsMap)
        : 'transparent';

      const rStrokeColorAttr = extractXmlAttr(rXml, 'StrokeColor');
      const rStrokeTintAttr = parseFloat(extractXmlAttr(rXml, 'StrokeTint') || '100');
      const rStrokeWeightPt = parseFloat(extractXmlAttr(rXml, 'StrokeWeight') || '0');
      const rStrokeColor = (!isNaN(rStrokeWeightPt) && rStrokeWeightPt > 0 && rStrokeColorAttr)
        ? resolveIdmlColor(rStrokeColorAttr, isNaN(rStrokeTintAttr) ? undefined : rStrokeTintAttr, colorsMap)
        : 'transparent';
      const rStrokeWidthMm = (!isNaN(rStrokeWeightPt) && rStrokeWeightPt > 0 && rStrokeColor !== 'transparent')
        ? Math.round(rStrokeWeightPt * PT_TO_MM * 10) / 10
        : 0;

      const isImage = rXml.includes('<Image') || rXml.includes('Image/');
      if (isImage) {
        let imageSrc = '';
        const rawAssetUrl = extractXmlAttr(rXml, 'AssetURL') || extractXmlAttr(rXml, 'LinkResourceURI') || '';
        const cleanName = rawAssetUrl.replace(/\\/g, '/');
        const baseName = cleanName.split('/').pop() || '';

        // 1. Check for embedded <Contents> in XML
        const contentsMatch = rXml.match(/<Contents[^>]*>([\s\S]*?)<\/Contents>/i);
        if (contentsMatch && contentsMatch[1].trim()) {
          const rawB64 = contentsMatch[1].trim().replace(/\s+/g, '');
          const lower = baseName.toLowerCase();
          const mime = lower.endsWith('.png') || rawB64.startsWith('iVBORw0KGgo') ? 'image/png' : lower.endsWith('.svg') || rawB64.startsWith('PHN2Zy') ? 'image/svg+xml' : lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
          imageSrc = `data:${mime};base64,${rawB64}`;
        }

        // 2. Check for linked image in IDML package archive (Links/ or direct filename)
        if (!imageSrc && baseName) {
          let fileBytes: Uint8Array | undefined;
          if (files.has(cleanName)) fileBytes = files.get(cleanName);
          else if (files.has(`Links/${baseName}`)) fileBytes = files.get(`Links/${baseName}`);
          else if (files.has(`Resources/${baseName}`)) fileBytes = files.get(`Resources/${baseName}`);
          else if (files.has(`Resources/Links/${baseName}`)) fileBytes = files.get(`Resources/Links/${baseName}`);
          else {
            for (const [k, v] of files.entries()) {
              if (k.toLowerCase().endsWith(baseName.toLowerCase())) {
                fileBytes = v;
                break;
              }
            }
          }

          if (fileBytes && fileBytes.length > 0) {
            const lower = baseName.toLowerCase();
            const mime = lower.endsWith('.png') ? 'image/png' : lower.endsWith('.svg') ? 'image/svg+xml' : lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
            imageSrc = `data:${mime};base64,${uint8ArrayToBase64(fileBytes)}`;
          }
        }

        const imgEl: ImageElement = {
          id: `idml-img-${sIdx}-${rIdx}`,
          type: 'image',
          pageId: targetPage.id,
          x: localX,
          y: localY,
          width: widthMm,
          height: heightMm,
          rotation: 0,
          opacity: 1,
          zIndex: 5 + rIdx,
          locked: false,
          src: imageSrc,
          fitMode: 'fill',
          borderColor: rStrokeColor !== 'transparent' ? rStrokeColor : '#111111',
          borderWidthMm: rStrokeWidthMm,
          name: baseName || undefined,
          caption: baseName || (imageSrc ? 'Photo Frame' : 'Imported InDesign Photo Frame'),
        };
        spreadElements.push(imgEl);
      } else {
        const shapeEl: ShapeElement = {
          id: `idml-rect-${sIdx}-${rIdx}`,
          type: 'shape',
          pageId: targetPage.id,
          x: localX,
          y: localY,
          width: widthMm,
          height: heightMm,
          rotation: 0,
          opacity: 1,
          zIndex: 4 + rIdx,
          locked: false,
          shapeKind: 'rectangle',
          fillColor: rFillColor === 'transparent' ? '#f0f0f0' : rFillColor,
          strokeColor: rStrokeColor === 'transparent' ? '#111111' : rStrokeColor,
          strokeWidthMm: rStrokeWidthMm || 0.3,
          strokeDash: 'solid',
        };
        spreadElements.push(shapeEl);
      }
    }

    // Parse Ovals
    const ovalTags = extractXmlTags(xml, 'Oval');
    for (let oIdx = 0; oIdx < ovalTags.length; oIdx++) {
      const oXml = ovalTags[oIdx];
      const b = parseElementSpreadBounds(oXml);
      const { page: targetPage, localX, localY } = findTargetPage(b);

      const widthMm = Math.max(5, Math.round(b.widthPt * PT_TO_MM * 10) / 10);
      const heightMm = Math.max(5, Math.round(b.heightPt * PT_TO_MM * 10) / 10);

      const oFillColorAttr = extractXmlAttr(oXml, 'FillColor');
      const oFillTintAttr = parseFloat(extractXmlAttr(oXml, 'FillTint') || '100');
      const oFillColor = oFillColorAttr
        ? resolveIdmlColor(oFillColorAttr, isNaN(oFillTintAttr) ? undefined : oFillTintAttr, colorsMap)
        : 'transparent';

      const oStrokeColorAttr = extractXmlAttr(oXml, 'StrokeColor');
      const oStrokeTintAttr = parseFloat(extractXmlAttr(oXml, 'StrokeTint') || '100');
      const oStrokeWeightPt = parseFloat(extractXmlAttr(oXml, 'StrokeWeight') || '0');
      const oStrokeColor = (!isNaN(oStrokeWeightPt) && oStrokeWeightPt > 0 && oStrokeColorAttr)
        ? resolveIdmlColor(oStrokeColorAttr, isNaN(oStrokeTintAttr) ? undefined : oStrokeTintAttr, colorsMap)
        : 'transparent';
      const oStrokeWidthMm = (!isNaN(oStrokeWeightPt) && oStrokeWeightPt > 0 && oStrokeColor !== 'transparent')
        ? Math.round(oStrokeWeightPt * PT_TO_MM * 10) / 10
        : 0;

      const ovalEl: ShapeElement = {
        id: `idml-oval-${sIdx}-${oIdx}`,
        type: 'shape',
        pageId: targetPage.id,
        x: localX,
        y: localY,
        width: widthMm,
        height: heightMm,
        rotation: 0,
        opacity: 1,
        zIndex: 4 + oIdx,
        locked: false,
        shapeKind: 'ellipse',
        fillColor: oFillColor === 'transparent' ? '#f0f0f0' : oFillColor,
        strokeColor: oStrokeColor === 'transparent' ? '#111111' : oStrokeColor,
        strokeWidthMm: oStrokeWidthMm || 0.3,
        strokeDash: 'solid',
      };
      spreadElements.push(ovalEl);
    }

    spreads.push({
      id: `idml-spread-${sIdx}`,
      spreadIndex: sIdx,
      pages,
      elements: spreadElements,
    });
  }

  // Post-Process Story Flow and Text Threading across Spreads
  const allTextElements: (TextElement & { parentStoryId?: string })[] = [];
  for (const sp of spreads) {
    for (const el of sp.elements) {
      if (el.type === 'text') allTextElements.push(el as TextElement & { parentStoryId?: string });
    }
  }

  const textElementMap = new Map<string, TextElement & { parentStoryId?: string }>();
  for (const el of allTextElements) {
    textElementMap.set(el.id, el);
  }

  const processedFrameIds = new Set<string>();

  // 1. Process explicitly threaded chains (NextTextFrame / PreviousTextFrame)
  for (const el of allTextElements) {
    if (processedFrameIds.has(el.id)) continue;
    const isHead = !el.prevFrameId || !textElementMap.has(el.prevFrameId);
    if (isHead && el.nextFrameId && textElementMap.has(el.nextFrameId)) {
      const chain: TextElement[] = [el];
      processedFrameIds.add(el.id);
      let curr = el;
      while (curr.nextFrameId && textElementMap.has(curr.nextFrameId)) {
        const next = textElementMap.get(curr.nextFrameId)!;
        if (processedFrameIds.has(next.id)) break;
        processedFrameIds.add(next.id);
        chain.push(next);
        curr = next;
      }

      const fullStory = el.rawStoryText || el.text;
      distributeStoryAcrossFrames(chain, fullStory);
    }
  }

  // 2. Group frames that share parentStoryId if not already chained
  const storyToElements = new Map<string, (TextElement & { parentStoryId?: string })[]>();
  for (const el of allTextElements) {
    if (processedFrameIds.has(el.id)) continue;
    const storyId = el.parentStoryId;
    if (storyId) {
      if (!storyToElements.has(storyId)) storyToElements.set(storyId, []);
      storyToElements.get(storyId)!.push(el);
    }
  }

  for (const [storyId, frames] of storyToElements.entries()) {
    if (frames.length > 1) {
      for (let i = 0; i < frames.length; i++) {
        processedFrameIds.add(frames[i].id);
        if (i < frames.length - 1) frames[i].nextFrameId = frames[i + 1].id;
        if (i > 0) frames[i].prevFrameId = frames[i - 1].id;
      }
      const fullStory = frames[0].rawStoryText || frames[0].text;
      distributeStoryAcrossFrames(frames, fullStory);
    }
  }

  if (spreads.length === 0) {
    spreads.push({
      id: 'idml-spread-0',
      spreadIndex: 0,
      pages: [{ id: 'idml-p-1', pageNumber: 1, side: facingPages ? 'right' : 'single' }],
      elements: [],
    });
  }

  const settings: DocumentSettings = {
    title: docTitle,
    preset: 'Custom',
    widthMm: pageWidthMm,
    heightMm: pageHeightMm,
    facingPages,
    bleedMm,
    margins: {
      topMm: topMarginMm,
      bottomMm: bottomMarginMm,
      insideMm: insideMarginMm,
      outsideMm: outsideMarginMm,
    },
    columnCount,
    columnGutterMm,
    baselineGrid: {
      enabled: true,
      incrementPt: 12,
      startMm: topMarginMm,
    },
  };

  return {
    settings,
    spreads,
    activeSpreadIndex: 0,
    selectedElementId: null,
    selectedElementIds: [],
    activeTool: 'select',
    zoom: 1.0,
    panX: 0,
    panY: 0,
    showGuides: true,
    showBleed: true,
    showBaselineGrid: true,
    snapToGuides: true,
    displayQuality: 'typical',
    paragraphStyles: parsedStyles,
    masterSpreads: DEFAULT_MASTER_SPREADS,
    linkingFromFrameId: null,
    layers: DEFAULT_LAYERS,
    activeLayerId: 'layer-1',
  };
}
