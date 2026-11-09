import { DEFAULT_LAYERS } from '../types';
import type { BaseElement, BezierNode, CanvasElement, FillGradient, Layer, MasterSpread, Page, ProjectState, Spread, StoryContent, StoryParagraph, TextElement, TextFormatting } from '../types';
import { INITIAL_STATE } from '../state/defaults';
import { storyText } from '../engine/storyContent';
import { validGradient } from '../engine/fillGradients';
import { child, children, parseManuscriptXml } from './manuscriptXml';
import type { XmlNode } from './manuscriptXml';

const MAX_BYTES = 32 * 1024 * 1024;
const mm = (points: number) => points * 25.4 / 72;
const number = (value: string | undefined, fallback = 0) => value !== undefined && value.trim() && Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const alignments = ['left', 'center', 'right', 'justify', 'justify'] as const;

export interface ScribusImport {
  project: ProjectState;
  imported: number;
  skipped: number;
  warnings: string[];
}

async function readScribus(file: Blob) {
  if (file.size > MAX_BYTES) throw new Error('Scribus import supports files up to 32 MiB.');
  const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (magic[0] !== 31 || magic[1] !== 139) return file.text();
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return chunks.join('') + decoder.decode();
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error('The expanded Scribus document exceeds 32 MiB.');
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function importScribusFile(file: File): Promise<ScribusImport> {
  return parseScribus(await readScribus(file), file.name);
}

/** Scribus 1.6 writes absolute M/L/C/Z commands. Recto paths represent one contour. */
function readPath(data: string) {
  if (!data || data.length > 200_000) return null;
  const token = /[MLCZ]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
  const tokens = data.match(token);
  if (!tokens || tokens[0] !== 'M' || data.replace(token, '').replace(/[\s,]/g, '')) return null;
  const nodes: BezierNode[] = [];
  let closed = false;
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++];
    if (command === 'Z' && i === tokens.length) { closed = true; break; }
    if (!(command === 'C' || command === 'L' || command === 'M' && !nodes.length)) return null;
    const count = command === 'C' ? 6 : 2;
    const values = tokens.slice(i, i += count).map(Number);
    if (values.length !== count || values.some(value => !Number.isFinite(value) || Math.abs(value) > 14400)) return null;
    const [x, y] = values.slice(-2).map(mm);
    const node: BezierNode = { x, y };
    if (command === 'C') {
      const previous = nodes.at(-1)!;
      previous.handleOut = { x: mm(values[0]) - previous.x, y: mm(values[1]) - previous.y };
      node.handleIn = { x: mm(values[2]) - x, y: mm(values[3]) - y };
    }
    nodes.push(node);
  }
  const first = nodes[0], last = nodes.at(-1)!;
  if (closed && nodes.length > 2 && first.x === last.x && first.y === last.y) {
    first.handleIn = last.handleIn;
    nodes.pop();
  }
  return nodes.length >= (closed ? 3 : 2) ? { nodes, closed } : null;
}

export function parseScribus(xml: string, filename = 'Untitled.sla'): ScribusImport {
  if (xml.length > MAX_BYTES) throw new Error('Scribus import supports files up to 32 MiB.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Scribus import does not support DTDs or external entities.');
  let roots: XmlNode[];
  try { roots = children(parseManuscriptXml(xml, 250_000)); }
  catch { throw new Error('The Scribus XML is malformed or exceeds the import complexity limit.'); }
  const root = roots[0];
  const doc = root && child(root, 'DOCUMENT');
  if (roots.length !== 1 || root.name !== 'SCRIBUSUTF8NEW' || !/^1\.6\.\d+$/.test(root.attrs.Version || '') || !doc) {
    throw new Error('Choose a document saved by Scribus 1.6 (.sla or .sla.gz).');
  }

  const a = doc.attrs;
  const width = number(a.PAGEWIDTH), height = number(a.PAGEHEIGHT);
  if (width <= 0 || height <= 0 || width > 14400 || height > 14400) throw new Error('The Scribus document has unsupported page dimensions.');
  const pageNodes = children(doc, 'PAGE').sort((p, q) => number(p.attrs.NUM) - number(q.attrs.NUM));
  const masterNodes = children(doc, 'MASTERPAGE');
  const objects = children(doc).filter(node => node.name === 'PAGEOBJECT' || node.name === 'MASTEROBJECT');
  if (!pageNodes.length || pageNodes.length > 500 || masterNodes.length > 100 || objects.length > 5000) {
    throw new Error('Scribus import supports 1–500 pages, up to 100 parent pages, and up to 5,000 objects.');
  }
  const warnings = new Set<string>();
  if (number(a.BOOK) > 0) warnings.add('Facing and multi-page spreads were opened as individual pages.');
  if (children(doc, 'Bookmark').length) warnings.add('Scribus bookmarks were omitted.');
  const bleed = ['BleedTop', 'BleedBottom', 'BleedLeft', 'BleedRight'].map(key => Math.max(0, number(a[key])));
  if (new Set(bleed).size > 1) warnings.add('Asymmetric bleed was replaced by the largest source bleed on all sides.');
  const checkPageSettings = (node: XmlNode) => {
    if (Math.abs(number(node.attrs.PAGEWIDTH, width) - width) > 0.01 || Math.abs(number(node.attrs.PAGEHEIGHT, height) - height) > 0.01) {
      warnings.add('Mixed page sizes were normalized to the document size. Check the affected pages.');
    }
    if (['TOP', 'BOTTOM', 'LEFT', 'RIGHT'].some(side => number(node.attrs['BORDER' + side], number(a['BORDER' + side])) !== number(a['BORDER' + side]))) {
      warnings.add('Page-specific margins were replaced by the document margins.');
    }
    if (node.attrs.VerticalGuides?.trim() || node.attrs.HorizontalGuides?.trim()) warnings.add('Page-specific ruler guides were omitted.');
  };
  const locate = (node: XmlNode, page: Page) => ({
    page, x: number(node.attrs.PAGEXPOS), y: number(node.attrs.PAGEYPOS), elements: [] as CanvasElement[],
  });
  const pages = pageNodes.map((node, i) => {
    checkPageSettings(node);
    return locate(node, { id: 'sla-page-' + (i + 1), pageNumber: i + 1, side: 'single' });
  });
  const byPage = new Map(pageNodes.map((node, i) => [node.attrs.NUM, pages[i]]));
  if (byPage.size !== pages.length || pageNodes.some(node => !/^\d+$/.test(node.attrs.NUM || ''))) {
    throw new Error('The Scribus document has invalid or duplicate page numbers.');
  }
  const masters = masterNodes.map((node, i) => {
    checkPageSettings(node);
    return { ...locate(node, { id: 'sla-parent-page-' + (i + 1), pageNumber: 1, side: 'single' }),
      id: 'sla-parent-' + (i + 1), name: node.attrs.NAM || 'Parent ' + (i + 1) };
  });
  const byMaster = new Map(masters.map(master => [master.name, master]));
  if (byMaster.size !== masters.length) throw new Error('The Scribus document has duplicate parent page names.');

  const sourceLayers = children(doc, 'LAYERS');
  const layerIds = new Map(sourceLayers.map((node, index) => [node.attrs.NUMMER, 'sla-layer-' + index]));
  const layers: Layer[] = sourceLayers.map(({ attrs: layer }, index) => ({
    id: 'sla-layer-' + index, name: layer.NAME || 'Layer ' + (index + 1),
    order: number(layer.LEVEL, index), visible: layer.SICHTBAR !== '0',
    locked: layer.EDIT === '0', colorHex: /^#[a-f\d]{6}$/i.test(layer.LAYERC || '') ? layer.LAYERC : '#0d99ff',
  }));
  const nonprintingLayers = new Set(sourceLayers.filter(node => node.attrs.DRUCKEN === '0').map(node => node.attrs.NUMMER));
  if (sourceLayers.some(({ attrs: layer }) => number(layer.BLEND) || number(layer.TRANS, 1) !== 1)) warnings.add('Layer-level blend modes and transparency were omitted.');
  if (!layers.length) layers.push({ ...DEFAULT_LAYERS[0] });
  const activeLayerId = layers.find(layer => layer.visible && !layer.locked)?.id || layers[0].id;

  const colours = new Map(children(doc, 'COLOR').map(node => [node.attrs.NAME, node.attrs]));
  const namedGradients = new Map(children(doc, 'Gradient').map(node => [node.attrs.Name, node]));
  const colour = (name?: string, shade = 100): string => {
    if (!name || name === 'None') return 'transparent';
    const c = colours.get(name);
    if (c?.Spot === '1' || c?.Register === '1') warnings.add('Spot and registration colours were imported as process colours. Reassign the plates before printing.');
    const tint = clamp(shade, 0, 100) / 100;
    if (c?.SPACE === 'CMYK') return 'cmyk(' + ['C', 'M', 'Y', 'K'].map(key => +(clamp(number(c[key]), 0, 100) * tint).toFixed(3)).join(',') + ')';
    if (c?.SPACE === 'RGB') return 'rgb(' + ['R', 'G', 'B'].map(key => Math.round(255 - (255 - clamp(number(c[key]), 0, 255)) * tint)).join(',') + ')';
    if (name === 'Black') return 'cmyk(0,0,0,' + Math.round(tint * 100) + ')';
    if (name === 'White') return '#ffffff';
    warnings.add('Some colours could not be interpreted. Review imported fills and strokes.');
    return '#000000';
  };
  const paragraphStyles = children(doc, 'STYLE');
  const characterStyles = children(doc, 'CHARSTYLE');
  const defaultParagraph = paragraphStyles.find(node => node.attrs.DefaultStyle === '1')?.attrs;
  const defaultCharacter = characterStyles.find(node => node.attrs.DefaultStyle === '1')?.attrs;
  const paragraphByName = new Map(paragraphStyles.map(node => [node.attrs.NAME, node.attrs]));
  const characterByName = new Map(characterStyles.map(node => [node.attrs.CNAME, node.attrs]));
  const inherited = (styles: Map<string, XmlNode['attrs']>, name?: string) => {
    const chain: XmlNode['attrs'][] = [];
    const seen = new Set<string>();
    while (name && !seen.has(name) && chain.length < 32) {
      const style = styles.get(name);
      if (!style) break;
      seen.add(name);
      chain.push(style);
      name = style.PARENT ?? style.CPARENT;
    }
    return Object.assign({}, ...chain.reverse()) as XmlNode['attrs'];
  };
  const format = (attrs: XmlNode['attrs']): TextFormatting => {
    const style = { ...inherited(characterByName, attrs.CPARENT || attrs.CSTYLE), ...attrs };
    const face = (style.FONT || style.CFONT || style.IFONT)?.replace(/[,;\r\n]/g, ' ').trim();
    const family = face?.replace(/ (?:Bold Italic|Bold Oblique|Regular|Roman|Bold|Italic|Oblique)$/, '');
    return {
      fontFamily: family || undefined,
      bold: face ? / Bold(?: Italic| Oblique)?$/.test(face) : undefined,
      italic: face ? / (?:Italic|Oblique)$/.test(face) : undefined,
      fontSizePt: style.FONTSIZE !== undefined || style.CSIZE !== undefined || style.ISIZE !== undefined
        ? clamp(number(style.FONTSIZE ?? style.CSIZE ?? style.ISIZE, 12), 1, 1000) : undefined,
      color: style.FCOLOR || style.CCOLOR || style.TXTFILL ? colour(style.FCOLOR || style.CCOLOR || style.TXTFILL, number(style.FSHADE ?? style.CSHADE, 100)) : undefined,
    };
  };
  const paragraphFormatting = (attrs: XmlNode['attrs']) => {
    const style = { ...defaultParagraph, ...inherited(paragraphByName, attrs.PARENT), ...attrs };
    const font = format({ ...defaultCharacter, ...inherited(characterByName, style.CPARENT), ...style });
    return { ...font, alignment: alignments[number(style.ALIGN, -1)],
      lineHeight: number(style.LINESP) > 0 ? clamp(number(style.LINESP) / (font.fontSizePt || 12), 0.3, 10) : undefined };
  };
  const readStory = (node: XmlNode, base: XmlNode['attrs']): StoryContent => {
    const paragraphs: StoryParagraph[] = [];
    let runs: StoryParagraph['runs'] = [];
    const finish = (attrs: XmlNode['attrs'] = {}) => {
      const style = { ...base, ...attrs };
      paragraphs.push({
        sourceStyle: style.PARENT, formatting: paragraphFormatting(style),
        runs: runs.length ? runs : [{ text: '' }],
      });
      runs = [];
    };
    for (const token of children(child(node, 'StoryText') || node)) {
      const attrs = token.attrs;
      switch (token.name) {
        case 'ITEXT':
          if (attrs.CH !== undefined) runs.push({ text: attrs.CH.replace(/\r\n?/g, '\n'), ...format(attrs) });
          else if (attrs.Unicode !== undefined) {
            const code = number(attrs.Unicode, -1);
            if (Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) runs.push({ text: String.fromCodePoint(code), ...format(attrs) });
          }
          if (attrs.CSTYLE || attrs.CPARENT || attrs.CEFFECT) warnings.add('Some character styles or text effects were converted to direct formatting.');
          break;
        case 'para': finish(attrs); break;
        case 'trail': finish(attrs); break;
        case 'tab': runs.push({ text: '\t' }); break;
        case 'nbspace': runs.push({ text: '\u00a0' }); break;
        case 'nbhyphen': runs.push({ text: '\u2011' }); break;
        case 'breakline': runs.push({ text: '\n' }); break;
        case 'breakcol':
        case 'breakframe': runs.push({ text: '\n' }); warnings.add('Explicit column and frame breaks were converted to line breaks.'); break;
        case 'DefaultStyle': break;
        default: warnings.add('Some inline objects, special characters or text controls were omitted.');
      }
    }
    if (runs.length || !paragraphs.length) finish();
    return { version: 1, paragraphs };
  };

  const frameLinks = new Map<string, { frame: TextElement; next?: string }>();
  const skippedTypes = new Map<string, number>();
  let imported = 0;
  let skipped = 0;
  let missingImages = 0;
  const skip = (reason: string) => { skipped++; skippedTypes.set(reason, (skippedTypes.get(reason) || 0) + 1); };
  const entries: { node: XmlNode; target: ReturnType<typeof locate>; parent: boolean; groupId?: string; locked?: boolean; nonprinting?: boolean }[] = [];
  let scanned = 0;
  const collect = (node: XmlNode, target: ReturnType<typeof locate>, parent: boolean, groupId?: string, locked = false, nonprinting = false) => {
    if (++scanned > 5000) throw new Error('Scribus import supports up to 5,000 objects, including group members.');
    const o = node.attrs;
    if (o.PTYPE !== '12') { entries.push({ node, target, parent, groupId, locked, nonprinting }); return; }
    if (number(o.ROT) % 360 || Math.abs(number(o.groupWidth, number(o.WIDTH)) - number(o.WIDTH)) > 0.01 ||
      Math.abs(number(o.groupHeight, number(o.HEIGHT)) - number(o.HEIGHT)) > 0.01) { skip('scaled or rotated groups'); return; }
    if (number(o.groupClips) || number(o.TransValue) || number(o.TransBlend)) warnings.add('Group-level clipping, transparency and blend settings were omitted.');
    const memberGroup = groupId || 'sla-group-' + scanned;
    for (const member of children(node, 'PAGEOBJECT')) collect(member, target, parent, memberGroup,
      locked || o.LOCK === '1', nonprinting || o.PRINTABLE === '0' || nonprintingLayers.has(o.LAYER));
  };
  for (const node of objects) {
    const parent = node.name === 'MASTEROBJECT';
    const target = parent ? byMaster.get(node.attrs.OnMasterPage) : byPage.get(node.attrs.OwnPage);
    if (target) collect(node, target, parent);
    else skip('pasteboard or unassigned objects');
  }
  for (const [index, { node, target, parent, groupId, locked, nonprinting }] of entries.entries()) {
    const o = node.attrs;
    const type = number(o.PTYPE, -1);
    const w = number(o.WIDTH), h = number(o.HEIGHT);
    if (w < 0 || h < 0 || (w === 0 && h === 0) || w > 14400 || h > 14400) { skip('objects with invalid dimensions'); continue; }
    const rotation = number(o.ROT) % 360;
    const angle = rotation * Math.PI / 180;
    const cx = w / 2, cy = Math.max(0, h) / 2;
    // Scribus rotates around the object's origin. Recto rotates around its centre.
    const base: BaseElement = {
      id: 'sla-object-' + (index + 1), pageId: target.page.id, name: o.ANAME || undefined,
      type: 'shape', x: mm(number(o.XPOS) - target.x + cx * (Math.cos(angle) - 1) - cy * Math.sin(angle)),
      y: mm(number(o.YPOS) - target.y + cx * Math.sin(angle) + cy * (Math.cos(angle) - 1)),
      width: mm(w), height: mm(Math.max(0, h)), rotation, zIndex: index, locked: !!locked || o.LOCK === '1', groupId,
      opacity: 1 - clamp(number(o.TransValue), 0, 1), layerId: layerIds.get(o.LAYER) || activeLayerId,
      editorialOnly: nonprinting || o.PRINTABLE === '0' || nonprintingLayers.has(o.LAYER) || undefined,
    };
    if (number(o.GRTYPS) || number(o.GRTYPM) || o.pattern) warnings.add('Some stroke gradients, patterns or masks were simplified.');
    if (number(o.TransValueS) || number(o.TransBlend) || number(o.TransBlendS)) warnings.add('Some stroke transparency or object blend settings were simplified.');
    if (number(o.TEXTFLOWMODE)) warnings.add('Imported object text wrap needs to be reapplied.');
    const fill = colour(o.PCOLOR, number(o.SHADE, 100)), stroke = colour(o.PCOLOR2, number(o.SHADE2, 100));
    const strokeWidthMm = mm(Math.max(0, number(o.PWIDTH)));
    const frameType = number(o.FRTYPE);
    let element: CanvasElement;
    if (type === 4 || type === 8) {
      const storyNode = child(node, 'StoryText');
      const style: XmlNode['attrs'] = { PARENT: o.PSTYLE, ...o, ...child(storyNode, 'DefaultStyle')?.attrs };
      const formatting = paragraphFormatting(style);
      const storyContent = readStory(node, style);
      const text = storyText(storyContent);
      if (text.length > 500_000) throw new Error('A Scribus story exceeds the 500,000-character import limit.');
      const fontSizePt = formatting.fontSizePt || 12;
      const padding = ['EXTRA', 'REXTRA', 'TEXTRA', 'BEXTRA'].map(key => Math.max(0, number(o[key])));
      if (new Set(padding).size > 1) warnings.add('Asymmetric text frame insets were replaced by the largest inset.');
      if (type === 8 || frameType !== 0 || number(o.CLIPEDIT)) warnings.add('Nonrectangular text was placed in rectangular text frames.');
      if (style.PARENT) warnings.add('Scribus named paragraph styles were imported as direct formatting.');
      const frame: TextElement = { ...base, type: 'text', text, storyContent, rawStoryText: text,
        fontFamily: formatting.fontFamily || 'serif', fontSizePt, color: formatting.color || '#000000',
        lineHeight: formatting.lineHeight || 1.2, letterSpacingPt: 0,
        alignment: formatting.alignment || 'left', columns: Math.trunc(clamp(number(o.COLUMNS, 1), 1, 20)),
        columnGutterMm: mm(Math.max(0, number(o.COLGAP))), backgroundColor: fill,
        borderColor: stroke, borderWidthMm: strokeWidthMm, paddingMm: mm(Math.max(...padding)),
      };
      if (!parent && o.ItemID) {
        if (frameLinks.has(o.ItemID)) throw new Error('The Scribus document has duplicate text frame IDs.');
        frameLinks.set(o.ItemID, { frame, next: o.NEXTITEM });
      }
      element = frame;
    } else if (type === 2) {
      const name = o.PFILE?.split(/[\\/]/).pop();
      if (o.PFILE || o.isInlineImage === '1') missingImages++;
      if (frameType !== 0 || number(o.CLIPEDIT)) warnings.add('Nonrectangular image frames were imported as rectangles.');
      element = { ...base, type: 'image', name: name || base.name, src: '', fitMode: 'fit', borderColor: stroke, borderWidthMm: strokeWidthMm };
    } else if (type === 5 || (type === 6 && [0, 1].includes(frameType) && !number(o.CLIPEDIT) && !number(o.RADRECT))) {
      if (o.NAMEDLST || o.startArrowIndex || o.endArrowIndex || o.NUMDASH) warnings.add('Custom stroke styles, dash lengths and arrowheads were simplified.');
      element = { ...base, type: 'shape', shapeKind: type === 5 ? 'line' : frameType === 1 ? 'ellipse' : 'rectangle',
        fillColor: type === 5 ? 'transparent' : fill, strokeColor: stroke, strokeWidthMm, strokeDash: number(o.PLINEART) > 1 ? 'dashed' : 'solid' };
    } else if (type === 6 || type === 7) {
      const path = readPath(o.path);
      if (!path) { skip('complex or unsupported paths'); continue; }
      element = { ...base, ...path, type: 'path', fillColor: path.closed ? fill : 'transparent', strokeColor: stroke,
        strokeWidthMm, strokeCap: 'butt', strokeJoin: 'miter', strokeDash: number(o.PLINEART) > 1 ? 'dashed' : 'solid' };
    } else { skip('unsupported object type ' + type); continue; }
    if (number(o.GRTYP) && !o.pattern) {
      const gradientType = number(o.GRTYP);
      const source = o.GRNAME ? namedGradients.get(o.GRNAME) : node;
      const radial = gradientType === 7;
      const sx = number(o.GRSTARTX), sy = number(o.GRSTARTY);
      const extend = number(o.GRExt ?? source?.attrs.Ext, 3);
      const compatible = (gradientType === 6 || radial) && extend === 3 && number(o.GRSCALE, 1) === 1 && !number(o.GRSKEW) &&
        (!radial || (Math.abs(number(o.GRFOCALX, sx) - sx) < 0.001 && Math.abs(number(o.GRFOCALY, sy) - sy) < 0.001));
      const stops = (source ? children(source, 'CSTOP') : []).map(({ attrs }) => ({
        offset: number(attrs.RAMP, -1), color: colour(attrs.NAME, number(attrs.SHADE, 100)), opacity: number(attrs.TRANS, 1),
      })).sort((a, b) => a.offset - b.offset);
      const gradient: FillGradient = { kind: radial ? 'radial' : 'linear', start: { x: sx / w, y: sy / h },
        end: { x: number(o.GRENDX) / w, y: number(o.GRENDY) / h }, stops: stops.map(({ offset, color }) => ({ offset, color })) };
      if (((element.type === 'shape' && element.shapeKind !== 'line') || (element.type === 'path' && element.closed)) &&
        compatible && stops.every(stop => stop.opacity === 1) && validGradient(gradient)) {
        element.fillGradient = gradient;
        element.fillColor = gradient.stops[0].color;
      } else warnings.add('Some gradients use unsupported geometry, repeat modes, transparency or frame types. Review the source appearance.');
    }
    target.elements.push(element);
    imported++;
  }

  // Keep complete acyclic chains. A target carrying independent text is left intact.
  const used = new Set<TextElement>();
  for (const { frame, next } of frameLinks.values()) {
    if (!next || next === '-1') continue;
    const target = frameLinks.get(next)?.frame;
    if (!target || target === frame || target.text || used.has(target)) {
      warnings.add('Some text threads were disconnected to preserve their source text.');
      continue;
    }
    target.prevFrameId = frame.id;
    frame.nextFrameId = target.id;
    used.add(target);
  }
  const frames = new Map([...frameLinks.values()].map(({ frame }) => [frame.id, frame]));
  const reached = new Set<string>();
  for (const { frame } of frameLinks.values()) {
    if (frame.prevFrameId) continue;
    let cursor: TextElement | undefined = frame;
    while (cursor) {
      reached.add(cursor.id);
      if (frame.nextFrameId) cursor.storyId = 'sla-story-' + frame.id;
      if (cursor !== frame) { delete cursor.storyContent; delete cursor.rawStoryText; }
      cursor = cursor.nextFrameId ? frames.get(cursor.nextFrameId) : undefined;
    }
  }
  for (const { frame } of frameLinks.values()) if (!reached.has(frame.id)) {
    delete frame.prevFrameId;
    delete frame.nextFrameId;
    warnings.add('Circular text threads were disconnected.');
  }
  if (missingImages) warnings.add(missingImages + ' image frame(s) need relinking. Scribus image files and embedded image data were not loaded.');
  if (frameLinks.size) warnings.add('Check fonts, line breaks and overset text after import. Scribus fonts are not bundled into the Recto document.');
  if (skipped) warnings.add('Skipped ' + [...skippedTypes].map(([reason, count]) => count + ' ' + reason).join(', ') + '.');
  const masterSpreads: MasterSpread[] = masters.map(master => ({ id: master.id, name: master.name, prefix: '', pages: [master.page], elements: master.elements }));
  const spreads: Spread[] = pages.map(({ page, elements }, index) => ({
    id: 'sla-spread-' + (index + 1), spreadIndex: index, pages: [page], elements,
    masterSpreadId: byMaster.get(pageNodes[index].attrs.MNAM)?.id || null,
  }));
  const project: ProjectState = {
    ...structuredClone(INITIAL_STATE),
    settings: { ...INITIAL_STATE.settings, title: a.TITLE?.trim() || filename.replace(/\.sla(?:\.gz)?$/i, ''),
      widthMm: mm(width), heightMm: mm(height), preset: 'Custom', facingPages: false,
      author: a.AUTHOR || undefined, bleedMm: mm(Math.max(...bleed)), columnCount: 1,
      margins: { topMm: mm(Math.max(0, number(a.BORDERTOP))), bottomMm: mm(Math.max(0, number(a.BORDERBOTTOM))),
        insideMm: mm(Math.max(0, number(a.BORDERLEFT))), outsideMm: mm(Math.max(0, number(a.BORDERRIGHT))) },
      baselineGrid: { ...INITIAL_STATE.settings.baselineGrid, enabled: false },
    },
    spreads, masterSpreads, layers, activeLayerId, paragraphStyles: [], activeSpreadIndex: 0,
    selectedElementId: null, selectedElementIds: [],
  };
  return { project, imported, skipped, warnings: [...warnings] };
}
