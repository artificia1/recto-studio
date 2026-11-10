import type { CanvasElement, Page, ProjectState, Spread, TextElement } from '../types';
import { escapeXml } from '../epubExport';
import { createZipArchive } from '../zip';
import { embeddedAsset, prepareExportAssets } from './publicationAssets';
import { fontFamilyCss } from './fontAssets';
import { variationCss } from '../engine/fontVariations';
import { displayGradientColor } from '../engine/fillGradients';
import { explicitCmyk, rgbColor } from '../engine/inkColors';
import { resolveMaster } from '../engine/masterInheritance';
import { masterTargetPage } from '../engine/pageLabels';
import { publicationPreflight } from '../engine/publicationPreflight';
import { layoutFrameNotes, publicationSnapshot, publicationText } from '../engine/publicationReferences';
import { publicationWrapObjects, wrappedPlainContent } from '../engine/publicationWrap';
import { layoutStory } from '../engine/storyLayout';
import { bezierNodesToSvgPath, shapeToPath } from '../engine/vectorPath';

const ns = 'http://www.w3.org/1999/xhtml';
const xml = '<?xml version="1.0" encoding="UTF-8"?>';
const color = (value?: string) => value && (explicitCmyk(value) || rgbColor(value))
  ? displayGradientColor(value) : 'transparent';
const cssFont = (family: string) => fontFamilyCss(family.split(',')[0].replace(/['"]/g, '').trim());

function pageArtwork(state: ProjectState, spread: Spread, page: Page) {
  const local = spread.elements.filter(element => element.pageId === page.id);
  const master = resolveMaster(state.masterSpreads, spread.masterSpreadId);
  const inherited = master?.elements.filter(element =>
    masterTargetPage(master.pages, spread.pages, element.pageId)?.id === page.id &&
    !spread.detachedMasterElementIds?.includes(element.id) && !local.some(item => item.masterSourceId === element.id)) || [];
  const layers = new Map(state.layers.map(layer => [layer.id, layer]));
  return [...inherited, ...local].filter(element => !element.pasteboard && !element.editorialOnly &&
    layers.get(element.layerId || 'layer-1')?.visible !== false).sort((a, b) =>
    (layers.get(a.layerId || '')?.order || 0) - (layers.get(b.layerId || '')?.order || 0) || a.zIndex - b.zIndex);
}

function unsupported(element: CanvasElement): string | undefined {
  if (element.type === 'table') return 'tables';
  if (element.interactiveField) return 'interactive fields';
  if (element.spotColor || (element.blendMode && element.blendMode !== 'normal') || element.shadow) return 'spot inks, blend modes or shadows';
  if ('fillGradient' in element && element.fillGradient) return 'gradient fills';
  if ((element.type === 'shape' || element.type === 'path') && element.decoration) return 'mesh and hatch fills';
  if (element.type === 'path' && element.textOnPath) return 'text on a path';
  if (element.type === 'text' && element.verticalAlign && element.verticalAlign !== 'top') return 'vertically aligned text frames';
  if (element.type === 'image' && (!element.src || (!element.decorative && !element.altText?.trim()))) return 'images missing artwork or descriptions';
}

function positionedText(state: ProjectState, spread: Spread, page: Page, element: TextElement) {
  const original = element.textContent || element.storyContent || wrappedPlainContent(element, element.text);
  const content = { ...original, paragraphs: original.paragraphs.map(paragraph => ({
    ...paragraph, runs: paragraph.runs.map(run => /\{\{|\{xref:|\{cond:/.test(run.text)
      ? { ...run, text: publicationText(state, run.text, page.pageNumber) } : run),
  })) };
  const notes = layoutFrameNotes(state, element);
  const lines = layoutStory(content, element, state.paragraphStyles, state.characterStyles, undefined, notes.height,
    { baselineGrid: state.settings.baselineGrid, obstacles: publicationWrapObjects(state, spread) }).lines;
  const output = lines.map(line => `<p style="position:absolute;margin:0;left:0;right:0;top:${line.y}mm;height:${line.height}mm">${line.segments.map(({ text, x, style }) => {
    const format = `position:absolute;left:${x}mm;font-family:${cssFont(style.fontFamily)};font-size:${style.fontSizePt}pt;letter-spacing:${style.letterSpacingPt}pt;color:${color(style.color)};font-weight:${style.bold ? 'bold' : 'normal'};font-style:${style.italic ? 'italic' : 'normal'};text-decoration:${style.underline ? 'underline' : 'none'};white-space:pre`;
    return `<span style="${escapeXml(format)}">${escapeXml(text)}</span>`;
  }).join('')}</p>`).join('\n');
  return output + notes.lines.map(line => {
    const y = element.height - (element.paddingMm ?? 2) - notes.height + 3 + line.y;
    const format = `position:absolute;margin:0;left:${(element.paddingMm ?? 2) + line.x}mm;top:${y}mm;font-family:${cssFont(notes.family)};font-size:${notes.size}pt;color:${color(element.color)};white-space:pre`;
    return `<p style="${escapeXml(format)}">${escapeXml(line.text)}</p>`;
  }).join('\n');
}

export function generateFixedEpubPackage(source: ProjectState) {
  const state = publicationSnapshot(source);
  const title = escapeXml(state.settings.title || 'Recto Publication');
  const language = state.settings.language || 'en';
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) throw new Error('Choose a valid publication language.');
  const issues = publicationPreflight(state, 'epub').filter(issue => issue.severity === 'error');
  if (issues.length) throw new Error(issues.map(issue => `Page ${issue.pageNumber}: ${issue.message}`).join('\n'));
  const pages = state.spreads.flatMap(spread => spread.pages.map(page => ({ spread, page, artwork: pageArtwork(state, spread, page) })));
  const problems = [...new Set(pages.flatMap(({ page, artwork }) => artwork.flatMap(element => {
    const problem = unsupported(element);
    return problem ? [`Page ${page.pageNumber}: ${problem}`] : [];
  })))];
  if (problems.length) throw new Error(`Fixed-layout EPUB needs a review of these unsupported objects: ${problems.join(', ')}.`);
  const files: Record<string, string | Uint8Array> = { mimetype: 'application/epub+zip' };
  const manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="styles.css" media-type="text/css"/>'];
  const spine: string[] = [], navigation: string[] = [];
  const assets = new Map<string, string>();
  files['META-INF/container.xml'] = `${xml}<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  files['OEBPS/styles.css'] = (state.embeddedFonts || []).map((font, index) => {
    const extension = font.fileName.match(/\.(ttf|otf|woff2?)$/i)?.[1].toLowerCase() || 'ttf';
    const path = `font-${index + 1}.${extension}`;
    files[`OEBPS/${path}`] = Uint8Array.from(atob(font.data), char => char.charCodeAt(0));
    manifest.push(`<item id="font-${index + 1}" href="${path}" media-type="font/${extension}"/>`);
    return `@font-face{font-family:${fontFamilyCss(font.family)};src:url("${path}");font-variation-settings:${variationCss(font.variations)};}`;
  }).join('\n');
  const viewport = (mm: number) => Math.round(mm * 96 / 25.4);
  const width = viewport(state.settings.widthMm), height = viewport(state.settings.heightMm);
  for (const { spread, page, artwork } of pages) {
    const number = spine.length + 1, id = `page-${number}`, filename = `${id}.xhtml`;
    const stacking = new Map(artwork.map((element, index) => [element, index]));
    const ordered = [...artwork].sort((a, b) => (a.readingOrder ?? Infinity) - (b.readingOrder ?? Infinity) || a.y - b.y || a.x - b.x);
    let hasSvg = false;
    const body = ordered.map(element => {
      const position = `position:absolute;left:${element.x}mm;top:${element.y}mm;width:${element.width}mm;height:${element.height}mm;opacity:${element.opacity};transform:rotate(${element.rotation}deg);z-index:${stacking.get(element)}`;
      if (element.type === 'text') return `<div style="${position};overflow:hidden;background:${color(element.backgroundColor)}">${positionedText(state, spread, page, element)}</div>`;
      if (element.type === 'image') {
        if (!element.src) return '';
        let path = assets.get(element.src);
        if (!path) {
          const image = embeddedAsset(element.src), assetId = `image-${assets.size + 1}`;
          path = `${assetId}.${image.extension}`;
          assets.set(element.src, path);
          files[`OEBPS/${path}`] = image.bytes;
          manifest.push(`<item id="${assetId}" href="${path}" media-type="${image.mediaType}"/>`);
        }
        const fit = element.fitMode === 'fit' ? 'contain' : element.fitMode === 'center' ? 'none' : element.fitMode === 'stretch' ? 'fill' : 'cover';
        return `<img src="${path}" alt="${escapeXml(element.decorative ? '' : element.altText || '')}" style="${position};object-fit:${fit}"/>`;
      }
      if (element.type === 'shape' || element.type === 'path') {
        const path = element.type === 'shape' ? shapeToPath(element) : element;
        hasSvg = true;
        const pattern = path.strokePattern ? ` stroke-dasharray="${path.strokePattern.dash} ${path.strokePattern.gap}"` : '';
        return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="${position};overflow:visible" viewBox="0 0 ${Math.max(0.1, element.width)} ${Math.max(0.1, element.height)}"><path d="${bezierNodesToSvgPath(path.nodes, path.closed)}" fill="${color(path.fillColor)}" stroke="${color(path.strokeColor)}" stroke-width="${path.strokeWidthMm}"${pattern}/></svg>`;
      }
      return '';
    }).join('\n');
    files[`OEBPS/${filename}`] = `${xml}<html xmlns="${ns}" xml:lang="${language}" lang="${language}"><head><title>Page ${number}</title><meta name="viewport" content="width=${width}, height=${height}"/><link rel="stylesheet" href="styles.css"/></head><body style="position:relative;margin:0;width:${width}px;height:${height}px;overflow:hidden">${body}</body></html>`;
    manifest.push(`<item id="${id}" href="${filename}" media-type="application/xhtml+xml"${hasSvg ? ' properties="svg"' : ''}/>`);
    spine.push(`<itemref idref="${id}"/>`);
    navigation.push(`<li><a href="${filename}">Page ${number}</a></li>`);
  }
  files['OEBPS/nav.xhtml'] = `${xml}<html xmlns="${ns}" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}"><head><title>${title}</title></head><body><nav epub:type="toc"><h1>Contents</h1><ol>${navigation.join('')}</ol></nav></body></html>`;
  files['OEBPS/package.opf'] = `${xml}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="publication" xml:lang="${language}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="publication">${escapeXml(state.settings.identifier || `urn:uuid:${crypto.randomUUID()}`)}</dc:identifier><dc:title>${title}</dc:title><dc:language>${language}</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta><meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">none</meta></metadata><manifest>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`;
  return files;
}

export async function exportFixedEpub(state: ProjectState) {
  const { fontManager } = await import('../fontManager');
  await fontManager.restoreFonts(state.embeddedFonts);
  return createZipArchive(generateFixedEpubPackage(await prepareExportAssets(state, typeof window !== 'undefined', false, true)));
}
