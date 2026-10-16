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
import { readZip } from './zip';
import { DEFAULT_PARAGRAPH_STYLES, DEFAULT_MASTER_SPREADS } from './state';

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

export function parseGeometricBounds(xmlOrBoundsStr: string | null): { x: number; y: number; width: number; height: number } {
  if (!xmlOrBoundsStr) return { x: 20, y: 20, width: 60, height: 40 };

  let boundsStr = xmlOrBoundsStr;
  if (xmlOrBoundsStr.includes('<')) {
    const attr = extractXmlAttr(xmlOrBoundsStr, 'GeometricBounds');
    if (attr) {
      boundsStr = attr;
    } else {
      const tagMatch = xmlOrBoundsStr.match(/<GeometricBounds\b[^>]*>([\s\S]*?)<\/GeometricBounds>/i);
      if (tagMatch) {
        const inner = tagMatch[1];
        if (inner.includes('<ListItem')) {
          const listMatches = inner.match(/<ListItem\b[^>]*>([^<]+)<\/ListItem>/gi);
          if (listMatches && listMatches.length >= 4) {
            boundsStr = listMatches.map(m => m.replace(/<[^>]+>/g, '').trim()).join(' ');
          } else {
            boundsStr = inner.replace(/<[^>]+>/g, ' ').trim();
          }
        } else {
          boundsStr = inner.trim();
        }
      }
    }
  }

  const parts = boundsStr.trim().split(/\s+/).map(Number);
  if (parts.length >= 4 && !parts.some(isNaN)) {
    const [y1Pt, x1Pt, y2Pt, x2Pt] = parts;
    const yMm = Math.max(0, y1Pt * PT_TO_MM);
    const xMm = Math.max(0, x1Pt * PT_TO_MM);
    const widthMm = Math.max(5, (x2Pt - x1Pt) * PT_TO_MM);
    const heightMm = Math.max(5, (y2Pt - y1Pt) * PT_TO_MM);
    return {
      x: Math.round(xMm * 10) / 10,
      y: Math.round(yMm * 10) / 10,
      width: Math.round(widthMm * 10) / 10,
      height: Math.round(heightMm * 10) / 10,
    };
  }
  return { x: 20, y: 20, width: 60, height: 40 };
}

export async function parseIdmlPackage(idmlBuffer: ArrayBuffer | Uint8Array): Promise<ProjectState> {
  const files = await readZip(idmlBuffer);
  const textDecoder = new TextDecoder();

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

  // Search designmap.xml or Preferences.xml
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
      if (!parsedStyles.some(s => s.id === styleId)) {
        parsedStyles.push({
          id: styleId,
          name,
          fontFamily: extractXmlAttr(tag, 'AppliedFont') || 'serif',
          fontSizePt: !isNaN(ptSize) ? ptSize : 10,
          lineHeight: (!isNaN(leadingPt) && !isNaN(ptSize) && ptSize > 0) ? Math.round((leadingPt / ptSize) * 100) / 100 : 1.3,
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
  const storiesMap = new Map<string, { text: string; styleId?: string }>();
  for (const [filename, content] of files.entries()) {
    if (filename.startsWith('Stories/Story_') && filename.endsWith('.xml')) {
      const xml = textDecoder.decode(content);
      const storyId = extractXmlAttr(xml, 'Self') || filename.replace('Stories/', '').replace('.xml', '');

      // Extract all <Content> tags
      const contentTags = extractXmlTags(xml, 'Content');
      const textPieces: string[] = [];
      for (const ct of contentTags) {
        const inner = ct.replace(/<Content[^>]*>/, '').replace(/<\/Content>/, '');
        textPieces.push(inner);
      }

      // Check paragraph style ranges
      const pRangeTags = extractXmlTags(xml, 'ParagraphStyleRange');
      let detectedStyleId: string | undefined;
      for (const pr of pRangeTags) {
        const applied = extractXmlAttr(pr, 'AppliedParagraphStyle');
        if (applied) {
          const cleanName = applied.replace('ParagraphStyle/', '');
          const match = parsedStyles.find(s => s.name.toLowerCase() === cleanName.toLowerCase());
          if (match) detectedStyleId = match.id;
        }
      }

      let fullText = textPieces.join('\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
      if (!fullText.trim()) {
        fullText = 'Imported text frame content';
      }

      storiesMap.set(storyId, { text: fullText, styleId: detectedStyleId });
    }
  }

  // 4. Parse Spreads from Spreads/Spread_*.xml
  const spreads: Spread[] = [];
  const spreadFiles = Array.from(files.keys())
    .filter(f => f.startsWith('Spreads/Spread_') && f.endsWith('.xml'))
    .sort();

  let globalPageCounter = 1;

  for (let sIdx = 0; sIdx < spreadFiles.length; sIdx++) {
    const sFile = spreadFiles[sIdx];
    const xml = textDecoder.decode(files.get(sFile)!);

    // Extract pages in spread
    const pageTags = extractXmlTags(xml, 'Page');
    const pages: Page[] = [];

    if (pageTags.length > 0) {
      for (let pIdx = 0; pIdx < pageTags.length; pIdx++) {
        const side: 'left' | 'right' | 'single' = facingPages
          ? (globalPageCounter % 2 === 0 ? 'left' : 'right')
          : 'single';

        pages.push({
          id: `idml-p-${globalPageCounter}`,
          pageNumber: globalPageCounter,
          side,
        });
        globalPageCounter++;
      }
    } else {
      // Default single or facing page setup
      pages.push({
        id: `idml-p-${globalPageCounter}`,
        pageNumber: globalPageCounter,
        side: facingPages ? 'right' : 'single',
      });
      globalPageCounter++;
    }

    const spreadElements: CanvasElement[] = [];

    // Parse Text Frames
    const textFrameTags = extractXmlTags(xml, 'TextFrame');
    for (let tfIdx = 0; tfIdx < textFrameTags.length; tfIdx++) {
      const tfXml = textFrameTags[tfIdx];
      const bounds = parseGeometricBounds(tfXml);
      const parentStory = extractXmlAttr(tfXml, 'ParentStory');
      const storyData = parentStory ? storiesMap.get(parentStory) : null;

      const cols = parseInt(extractXmlAttr(tfXml, 'TextColumnCount') || '1') || 1;
      const colGutterPt = parseFloat(extractXmlAttr(tfXml, 'TextColumnGutter') || '12');
      const colGutterMm = !isNaN(colGutterPt) ? Math.round(colGutterPt * PT_TO_MM) : 4;

      // In facing spreads, normalize x coordinate to local page
      let targetPage = pages[0];
      let localX = bounds.x;
      if (pages.length > 1 && localX >= pageWidthMm) {
        targetPage = pages[1];
        localX -= pageWidthMm;
      }

      const textEl: TextElement = {
        id: `idml-text-${sIdx}-${tfIdx}`,
        type: 'text',
        pageId: targetPage.id,
        x: localX,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        rotation: 0,
        opacity: 1,
        zIndex: 10 + tfIdx,
        locked: false,
        text: storyData ? storyData.text : 'Text Frame',
        fontFamily: 'serif',
        fontSizePt: 10,
        lineHeight: 1.3,
        letterSpacingPt: 0,
        color: '#1a1a1a',
        alignment: 'left',
        columns: cols,
        columnGutterMm,
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidthMm: 0,
        paddingMm: 2,
        paragraphStyleId: storyData?.styleId,
      };

      const nextFrame = extractXmlAttr(tfXml, 'NextTextFrame');
      const prevFrame = extractXmlAttr(tfXml, 'PreviousTextFrame');
      if (nextFrame && nextFrame !== 'kInvalidRef') textEl.nextFrameId = nextFrame;
      if (prevFrame && prevFrame !== 'kInvalidRef') textEl.prevFrameId = prevFrame;

      spreadElements.push(textEl);
    }

    // Parse Rectangles (Shapes & Images)
    const rectTags = extractXmlTags(xml, 'Rectangle');
    for (let rIdx = 0; rIdx < rectTags.length; rIdx++) {
      const rXml = rectTags[rIdx];
      const bounds = parseGeometricBounds(rXml);
      let targetPage = pages[0];
      let localX = bounds.x;
      if (pages.length > 1 && localX >= pageWidthMm) {
        targetPage = pages[1];
        localX -= pageWidthMm;
      }

      const isImage = rXml.includes('<Image') || rXml.includes('Image/');
      if (isImage) {
        const imgEl: ImageElement = {
          id: `idml-img-${sIdx}-${rIdx}`,
          type: 'image',
          pageId: targetPage.id,
          x: localX,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          rotation: 0,
          opacity: 1,
          zIndex: 5 + rIdx,
          locked: false,
          src: '', // InDesign linked image placeholder
          fitMode: 'fill',
          borderColor: '#111111',
          borderWidthMm: 0,
          caption: 'Imported InDesign Photo Frame',
        };
        spreadElements.push(imgEl);
      } else {
        const shapeEl: ShapeElement = {
          id: `idml-rect-${sIdx}-${rIdx}`,
          type: 'shape',
          pageId: targetPage.id,
          x: localX,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          rotation: 0,
          opacity: 1,
          zIndex: 4 + rIdx,
          locked: false,
          shapeKind: 'rectangle',
          fillColor: '#e5e5e5',
          strokeColor: '#111111',
          strokeWidthMm: 0.3,
          strokeDash: 'solid',
        };
        spreadElements.push(shapeEl);
      }
    }

    // Parse Ovals
    const ovalTags = extractXmlTags(xml, 'Oval');
    for (let oIdx = 0; oIdx < ovalTags.length; oIdx++) {
      const oXml = ovalTags[oIdx];
      const bounds = parseGeometricBounds(oXml);
      let targetPage = pages[0];
      let localX = bounds.x;
      if (pages.length > 1 && localX >= pageWidthMm) {
        targetPage = pages[1];
        localX -= pageWidthMm;
      }

      const ovalEl: ShapeElement = {
        id: `idml-oval-${sIdx}-${oIdx}`,
        type: 'shape',
        pageId: targetPage.id,
        x: localX,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        rotation: 0,
        opacity: 1,
        zIndex: 4 + oIdx,
        locked: false,
        shapeKind: 'ellipse',
        fillColor: '#e5e5e5',
        strokeColor: '#111111',
        strokeWidthMm: 0.3,
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

  // If no spreads were found in IDML, provide clean default spread
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
