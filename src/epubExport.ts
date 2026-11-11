/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */
// Recto EPUB 3 Digital Publishing Pipeline
// Assembles semantic XHTML, responsive CSS, OPF packages, and nav documents

import { ProjectState, CanvasElement, TextElement, ImageElement, ShapeElement, TableElement, VectorPathElement, Page } from './types';
import { createZipArchive, base64ToUint8Array } from './zip';
import { formatOpenTypeText } from './canvas';
import { publicationHeadings, publicationId, publicationSnapshot, textFrames } from './engine/publicationReferences';
import { publicationPreflight } from './engine/publicationPreflight';
import { embeddedAsset, fullImageSource, prepareExportAssets } from './export/publicationAssets';
import { resolveParagraphStyle, resolveRunStyle } from './engine/storyLayout';
import { readingCaptions, readingEntries, readingSections, readingTextRole } from './engine/readingOrder';
import { tableGrid } from './engine/tableCells';

export interface EpubExportOptions {
  download?: boolean;
  strict?: boolean;
  onWarning?: (message: string) => void;
}

export function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

import { bezierNodesToSvgPath } from './engine/vectorPath';
export { bezierNodesToSvgPath } from './engine/vectorPath';

import { fontFamilyCss } from './export/fontAssets';
import { variationCss } from './engine/fontVariations';

export function generateEpubPackage(source: ProjectState, options: EpubExportOptions = {}): Record<string, string | Uint8Array> {
  const state = publicationSnapshot(source);
  const issues = publicationPreflight(state, 'epub');
  const draftIssues = new Set(['MISSING_ASSET', 'MISSING_ALT_TEXT']);
  const failures = issues.filter(issue => issue.severity === 'error' && (options.strict || !draftIssues.has(issue.code)));
  if (failures.length) throw new Error(failures.map(issue => issue.message).join('\n'));
  issues.filter(issue => issue.severity !== 'error' || draftIssues.has(issue.code)).forEach(issue => options.onWarning?.(issue.message));
  const language = state.settings.language || 'en';
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) throw new Error('Choose a valid publication language, such as en, de or en-US.');
  const files: Record<string, string | Uint8Array> = {};
  // OCF requires this to precede every other ZIP entry, including fonts.
  files['mimetype'] = 'application/epub+zip';
  const fontManifest: string[] = [];
  const equationManifest: string[] = [];
  const imageCache = new Map<string, string>();
  const fontStyles = (state.embeddedFonts || []).map((font, index) => {
    const extension = font.fileName.match(/\.(ttf|otf|woff2?)$/i)?.[1].toLowerCase() || 'ttf';
    const location = `fonts/font-${index}.${extension}`;
    files[`OEBPS/${location}`] = Uint8Array.from(atob(font.data), char => char.charCodeAt(0));
    fontManifest.push(`    <item id="font-${index}" href="${location}" media-type="font/${extension}"/>`);
    return `@font-face{font-family:${fontFamilyCss(font.family)};src:url("${location}");font-variation-settings:${variationCss(font.variations)};}`;
  }).join('\n');

  // 2. META-INF/container.xml
  files['META-INF/container.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  // 3. OEBPS/styles.css
  const stylesCss = `/* Recto EPUB 3 Typography & Layout Stylesheet */
@namespace epub "http://www.idpf.org/2007/ops";

body {
  margin: 5% 8%;
  font-family: "Georgia", "Merriweather", "Playfair Display", serif;
  font-size: 1em;
  line-height: 1.6;
  color: #1a1a1a;
  background-color: #fafafa;
}

h1, h2, h3, h4, h5, h6 {
  font-family: "Playfair Display", "Georgia", serif;
  line-height: 1.25;
  font-weight: 700;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}

h1 { font-size: 2em; }
h2 { font-size: 1.5em; }
h3 { font-size: 1.25em; }

p {
  margin: 0 0 1em 0;
  text-rendering: optimizeLegibility;
}

.text-justify {
  text-align: justify;
  text-justify: inter-word;
  hyphens: auto;
}

.text-center { text-align: center; }
.text-right { text-align: right; }
.text-left { text-align: left; }

.drop-cap {
  float: left;
  font-size: 3.2em;
  line-height: 0.8;
  padding-top: 4px;
  padding-right: 8px;
  padding-bottom: 2px;
  font-family: "Playfair Display", serif;
  font-weight: bold;
}

blockquote {
  border-left: 3px solid #0d99ff;
  padding-left: 1em;
  margin: 1.5em 0;
  font-style: italic;
  color: #444;
}

.caption {
  font-size: 0.85em;
  color: #666;
  margin-top: 0.4em;
  font-style: italic;
}

figure {
  margin: 2em 0;
  text-align: center;
}

figure img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.5em 0;
  font-size: 0.95em;
}

th, td {
  border: 1px solid #ddd;
  padding: 8px 12px;
}

th {
  background-color: #f2f2f2;
  font-weight: 600;
}

svg {
  display: block;
  max-width: 100%;
  margin: 1.5em auto;
}

.page-break {
  page-break-before: always;
  break-before: page;
}
`;
  files['OEBPS/styles.css'] = stylesCss + '\n' + fontStyles;

  // 4. Collect Pages across all spreads
  interface PageItem {
    id: string;
    pageNumber: number;
    filename: string;
    title: string;
    elements: CanvasElement[];
  }

  const pageItems: PageItem[] = [];
  const pageArtwork = new Map<string, CanvasElement[]>();
  for (const { pageId, element } of readingEntries(state)) {
    const elements = pageArtwork.get(pageId);
    if (elements) elements.push(element);
    else pageArtwork.set(pageId, [element]);
  }
  let pageCounter = 1;

  for (const spread of state.spreads) {
    for (const page of spread.pages) {
      const pageElements = (pageArtwork.get(page.id) || []).filter(element =>
        (element.type !== 'text' && element.type !== 'table') ||
        (!element.prevFrameId && (element.type === 'table' || element.generated?.kind !== 'endnotes')));
      if (!pageElements.length) continue;

      const filename = `page_${pageCounter}.xhtml`;
      pageItems.push({
        id: `page-${pageCounter}`,
        pageNumber: page.pageNumber || pageCounter,
        filename,
        title: `Page ${page.pageNumber || pageCounter}`,
        elements: pageElements,
      });
      pageCounter++;
    }
  }

  const frameFiles = new Map<string, string>();
  for (const item of pageItems) for (const element of item.elements) frameFiles.set(element.id, item.filename);
  const frames = textFrames(state);
  for (const frame of frames) {
    let head = frame; const visited = new Set<string>();
    while (head.prevFrameId && !visited.has(head.id)) { visited.add(head.id); const previous = frames.find(candidate => candidate.id === head.prevFrameId); if (!previous) break; head = previous; }
    if (frameFiles.has(head.id)) frameFiles.set(frame.id, frameFiles.get(head.id)!);
  }
  const noteBacklinks = new Map<string, string>();
  function runMarkup(run: import('./types').StoryRun, html: string, file: string) {
    if (run.noteId) {
      const note = state.settings.footnotes?.find(note => note.id === run.noteId);
      if (!note) throw new Error('A note marker has no body. Repair it before exporting.');
      const id = publicationId('noteref', note.id);
      noteBacklinks.set(note.id, `${file}#${id}`);
      return `<a id="${id}" epub:type="noteref" role="doc-noteref" href="notes.xhtml#${publicationId('note', note.id)}"><sup>${note.number}</sup></a>`;
    }
    if (run.reference) {
      const ref = run.reference;
      const file = frameFiles.get(ref.targetElementId);
      if (!file) throw new Error('A reference target is excluded from this EPUB. Include it or remove the reference.');
      return `<a href="${file}#${publicationId(ref.targetParagraphId ? 'paragraph' : 'frame', ref.targetParagraphId || ref.targetElementId)}">${html}</a>`;
    }
    return run.indexId ? `<span id="${publicationId('index', run.indexId)}">${html}</span>` : html;
  }

  // 5. Generate XHTML for each page
  for (const item of pageItems) {
    let bodyContent = '';
    const captions = readingCaptions(item.elements);

    for (const { article, elements } of readingSections(item.elements)) {
    if (article) bodyContent += `<section aria-label="${escapeXml(article)}">\n`;
    for (const el of elements) {
      const hidden = el.decorative ? ' aria-hidden="true"' : '';
      const caption = captions.get(el.id);
      const description = caption ? ` aria-describedby="${publicationId('frame', caption)}"` : '';
      if (el.type === 'text') {
        const textEl = el as TextElement;
        if (textEl.generated?.kind === 'endnotes') continue;
        if (textEl.storyContent || textEl.textContent) {
          // Export the semantic story once, so frame boundaries cannot split paragraphs or duplicate copy.
          if (textEl.prevFrameId) continue;
          const content = textEl.storyContent || textEl.textContent!;
          bodyContent += `  <div id="${publicationId('frame', textEl.id)}"${hidden}>\n`;
          for (const [paragraphIndex, paragraph] of content.paragraphs.entries()) {
            const style = resolveParagraphStyle(paragraph, state.paragraphStyles);
            const semantic = style?.pdfTag;
            const role = readingTextRole(textEl, semantic, paragraphIndex);
            const tag = /^H[1-6]$/.test(role) ? role.toLowerCase()
              : role === 'BlockQuote' ? 'blockquote'
              : textEl.generated && textEl.generated.kind !== 'caption' && paragraphIndex === 0 ? 'h1' : 'p';
            const runs = paragraph.runs.map(run => {
              const format = resolveRunStyle(textEl, style, run, state.characterStyles || []);
              let html = escapeXml(run.text).replace(/\n/g, '<br/>');
              if (format.bold) html = `<strong>${html}</strong>`;
              if (format.italic) html = `<em>${html}</em>`;
              if (format.underline) html = `<u>${html}</u>`;
              return runMarkup(run, `<span style="font-family:${escapeXml(fontFamilyCss(format.fontFamily.split(',')[0].replace(/['"]/g, '').trim()))}">${html}</span>`, item.filename);
            }).join('');
            const paragraphLanguage = paragraph.language || style.language || language;
            if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(paragraphLanguage)) throw new Error('Invalid paragraph language.');
            const count = (value?: number) => Number.isInteger(value) && value! > 0 ? Math.min(value!, 100) : 1;
            const alignment = ['left', 'center', 'right', 'justify'].includes(style.alignment || textEl.alignment) ? style.alignment || textEl.alignment : 'left';
            const flowCss = `orphans:${count(style.orphanLines)};widows:${count(style.widowLines)};break-inside:${style.keepTogether ? 'avoid' : 'auto'};break-after:${style.keepWithNext ? 'avoid' : 'auto'};hyphens:${style.hyphenate && !style.cjkLineBreak ? 'auto' : 'manual'};line-break:${style.cjkLineBreak ? 'strict' : 'auto'};word-break:normal`;
            bodyContent += `  <${tag}${paragraph.id ? ` id="${publicationId('paragraph', paragraph.id)}"` : ''} class="text-${alignment}" xml:lang="${paragraphLanguage}" lang="${paragraphLanguage}" style="${flowCss}">${runs || '<br/>'}</${tag}>\n`;
          }
          bodyContent += '  </div>\n';
          continue;
        }
        bodyContent += `  <div id="${publicationId('frame', textEl.id)}"${hidden}>\n`;
        const processed = formatOpenTypeText(textEl.text, textEl.openTypeFeatures);
        const paragraphs = processed.split('\n');
        const alignClass = `text-${textEl.alignment || 'left'}`;
        const familyStyle = `style="font-family:${escapeXml(fontFamilyCss((textEl.fontFamily || 'serif').split(',')[0].replace(/['"]/g, '').trim()))}"`;

        const isTitle = textEl.fontSizePt >= 24;
        const isHeader = textEl.fontSizePt >= 14 && textEl.fontSizePt < 24;
        const style = state.paragraphStyles.find(item => item.id === textEl.paragraphStyleId);
        const role = readingTextRole(textEl, style?.pdfTag, 0);
        const heading = /^H[1-6]$/.test(role) ? role.toLowerCase()
          : textEl.readingRole || textEl.captionForId || style?.pdfTag ? undefined
          : isTitle ? 'h1' : isHeader ? 'h2' : undefined;
        const hasDropCap = Boolean(textEl.dropCapLines && textEl.dropCapLines >= 2);

        for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
          const para = paragraphs[pIdx].trim();
          if (!para) continue;

          if (heading && pIdx === 0) {
            bodyContent += `  <${heading} class="${alignClass}" ${familyStyle}>${escapeXml(para)}</${heading}>\n`;
          } else {
            if (hasDropCap && pIdx === 0 && para.length > 1) {
              const firstChar = para.charAt(0);
              const remainder = para.slice(1);
              bodyContent += `  <p class="${alignClass}" ${familyStyle}><span class="drop-cap">${escapeXml(firstChar)}</span>${escapeXml(remainder)}</p>\n`;
            } else {
              bodyContent += `  <p class="${alignClass}" ${familyStyle}>${escapeXml(para)}</p>\n`;
            }
          }
        }
        bodyContent += '  </div>\n';
      } else if (el.type === 'table') {
        const tbl = el as TableElement;
        bodyContent += `  <table${hidden}${description}>\n`;
        if (tbl.cells?.length) {
          const grid = tableGrid(tbl.cells, tbl.headerRowCount, tbl.footerRowCount || 0);
          for (const [r, row] of grid.entries()) {
            const isHeaderRow = r < tbl.headerRowCount;
            bodyContent += '    <tr>\n';
            for (const [c, owner] of row.entries()) {
              if (owner.row !== r || owner.column !== c) continue;
              const { cell, rowSpan, colSpan } = owner;
              const tag = isHeaderRow ? 'th' : 'td';
              const align = cell.align ? ` style="text-align: ${cell.align};"` : '';
              bodyContent += `      <${tag} colspan="${colSpan}" rowspan="${rowSpan}"${isHeaderRow ? ' scope="col"' : ''}${align}>${escapeXml(cell.text || '')}</${tag}>\n`;
            }
            bodyContent += '    </tr>\n';
          }
        }
        bodyContent += '  </table>\n';
      } else if (el.type === 'image') {
        const img = el as ImageElement;
        if (img.src) {
          const source = fullImageSource(img);
          let imageSource = imageCache.get(source);
          if (!imageSource) {
            const asset = embeddedAsset(source);
            if (asset.mediaType === 'image/webp') throw new Error('Convert WebP artwork to PNG or JPEG for EPUB reader compatibility.');
            const id = `image-${imageCache.size + 1}`;
            imageSource = `images/${id}.${asset.extension}`;
            files[`OEBPS/${imageSource}`] = asset.bytes;
            equationManifest.push(`    <item id="${id}" href="${imageSource}" media-type="${asset.mediaType}"/>`);
            imageCache.set(source, imageSource);
          }
          bodyContent += `  <figure${hidden}${description}>\n    <img src="${imageSource}" alt="${escapeXml(img.decorative ? '' : img.altText || img.caption || '')}"${img.decorative ? ' role="presentation"' : ''}/>\n`;
          if (img.caption) {
            bodyContent += `    <figcaption class="caption">${escapeXml(img.caption)}</figcaption>\n`;
          }
          bodyContent += '  </figure>\n';
        }
      } else if (el.type === 'path') {
        const pathEl = el as VectorPathElement;
        const d = bezierNodesToSvgPath(pathEl.nodes, pathEl.closed);
        const strokeDash = pathEl.strokeDash === 'dashed' ? ' stroke-dasharray="4,3"' : '';
        bodyContent += `  <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 ${pathEl.width} ${pathEl.height}" width="${pathEl.width}mm" height="${pathEl.height}mm">\n`;
        bodyContent += `    <path d="${d}" fill="${escapeXml(pathEl.fillColor || 'none')}" stroke="${escapeXml(pathEl.strokeColor || '#000000')}" stroke-width="${pathEl.strokeWidthMm || 1}" stroke-linecap="${pathEl.strokeCap || 'round'}" stroke-linejoin="${pathEl.strokeJoin || 'round'}"${strokeDash}/>\n`;
        bodyContent += '  </svg>\n';
      } else if (el.type === 'shape') {
        const shape = el as ShapeElement;
        bodyContent += `  <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 ${shape.width} ${shape.height}" width="${shape.width}mm" height="${shape.height}mm">\n`;
        if (shape.shapeKind === 'ellipse') {
          bodyContent += `    <ellipse cx="${shape.width / 2}" cy="${shape.height / 2}" rx="${shape.width / 2}" ry="${shape.height / 2}" fill="${escapeXml(shape.fillColor || 'none')}" stroke="${escapeXml(shape.strokeColor || '#000000')}" stroke-width="${shape.strokeWidthMm || 1}"/>\n`;
        } else if (shape.shapeKind === 'line') {
          bodyContent += `    <line x1="0" y1="${shape.height / 2}" x2="${shape.width}" y2="${shape.height / 2}" stroke="${escapeXml(shape.strokeColor || '#000000')}" stroke-width="${shape.strokeWidthMm || 1}"/>\n`;
        } else {
          bodyContent += `    <rect x="0" y="0" width="${shape.width}" height="${shape.height}" fill="${escapeXml(shape.fillColor || 'none')}" stroke="${escapeXml(shape.strokeColor || '#000000')}" stroke-width="${shape.strokeWidthMm || 1}"/>\n`;
        }
        bodyContent += '  </svg>\n';
      }
    }
    if (article) bodyContent += '</section>\n';
    }

    const pageXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}" lang="${language}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(item.title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body epub:type="bodymatter">
  <section class="page-container" id="${item.id}">
${bodyContent || '  <p>(Empty spread page)</p>\n'}
  </section>
</body>
</html>`;

    files[`OEBPS/${item.filename}`] = pageXhtml;
  }

  // 6. OEBPS/nav.xhtml (EPUB 3 Navigation Document)
  const headings = publicationHeadings(state).filter(heading => frameFiles.has(heading.elementId));
  const navLinks = (headings.length ? headings.map(heading => `        <li><a href="${frameFiles.get(heading.elementId)}#${publicationId(heading.paragraphId ? 'paragraph' : 'frame', heading.paragraphId || heading.elementId)}">${escapeXml(heading.title)}</a></li>`) :
    pageItems.map(page => `        <li><a href="${page.filename}">${escapeXml(page.title)}</a></li>`)).join('\n');

  files['OEBPS/nav.xhtml'] = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}" lang="${language}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(state.settings.title || 'Table of Contents')}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
${navLinks}
    </ol>
  </nav>
</body>
</html>`;

  const notes = (state.settings.footnotes || []).filter(note => noteBacklinks.has(note.id));
  if (notes.length) {
    const noteBody = notes.map(note => `<aside id="${publicationId('note', note.id)}" epub:type="${note.kind === 'endnote' ? 'endnote' : 'footnote'}"${note.kind !== 'endnote' ? ' role="doc-footnote"' : ''}><p>${note.number}. ${escapeXml(note.text).replace(/\n/g, '<br/>')} <a href="${noteBacklinks.get(note.id)}" aria-label="Back to note reference ${note.number}">Back</a></p></aside>`).join('\n');
    files['OEBPS/notes.xhtml'] = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}" lang="${language}"><head><title>Notes</title><link rel="stylesheet" type="text/css" href="styles.css"/></head><body><section epub:type="endnotes" role="doc-endnotes"><h1>Notes</h1>${noteBody}</section></body></html>`;
  }

  // 7. OEBPS/package.opf (Package Document)
  const bookId = state.settings.identifier || `urn:uuid:${crypto.randomUUID()}`;
  const modifiedIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const manifestEntries = [
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="css" href="styles.css" media-type="text/css"/>',
    ...fontManifest,
    ...(notes.length ? ['    <item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>'] : []),
    ...equationManifest,
    ...pageItems.map((p) => `    <item id="${p.id}" href="${p.filename}" media-type="application/xhtml+xml"${String(files[`OEBPS/${p.filename}`]).includes("<svg ") ? ' properties="svg"' : ''}/>` ),
  ].join('\n');

  const spineEntries = [...pageItems.map((p) => `    <itemref idref="${p.id}"/>`), ...(notes.length ? ['    <itemref idref="notes"/>'] : [])].join('\n');

  files['OEBPS/package.opf'] = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${language}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(state.settings.title || 'Recto Publication')}</dc:title>
    <dc:language>${language}</dc:language>
    <meta property="dcterms:modified">${modifiedIso}</meta>
    <dc:creator>${escapeXml(state.settings.author || 'Recto Studio')}</dc:creator>
    <meta property="schema:accessMode">textual</meta>
    ${imageCache.size ? '<meta property="schema:accessMode">visual</meta>' : ''}
    <meta property="schema:accessibilityFeature">structuralNavigation</meta>
    <meta property="schema:accessibilitySummary">Semantic headings, navigation and note links are provided. Review descriptions, reading order and reader compatibility before distribution.</meta>
  </metadata>
  <manifest>
${manifestEntries}
  </manifest>
  <spine>
${spineEntries}
  </spine>
</package>`;

  return files;
}

export function exportDocumentToEpub(
  state: ProjectState,
  options: EpubExportOptions = { download: true }
): { buffer: Uint8Array; filename: string; warnings: string[] } {
  const warnings: string[] = [];
  const files = generateEpubPackage(state, { ...options, onWarning: message => { warnings.push(message); options.onWarning?.(message); } });
  const buffer = createZipArchive(files);
  const baseTitle = state.settings.title.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'recto-publication';
  const filename = `${baseTitle}.epub`;

  if (options.download && typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([buffer as any], { type: 'application/epub+zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { buffer, filename, warnings };
}

export async function exportDocumentToEpubAsync(state: ProjectState, options: EpubExportOptions = {}) {
  const { fontManager } = await import('./fontManager');
  await fontManager.restoreFonts(state.embeddedFonts);
  return exportDocumentToEpub(await prepareExportAssets(state, typeof window !== 'undefined', false, true), options);
}
