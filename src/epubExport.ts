/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */
// Recto EPUB 3 Digital Publishing Pipeline
// Assembles semantic XHTML, responsive CSS, OPF packages, and nav documents

import { ProjectState, CanvasElement, TextElement, ImageElement, ShapeElement, TableElement, VectorPathElement, Page } from './types';
import { createZipArchive } from './zip';
import { formatOpenTypeText } from './canvas';

export interface EpubExportOptions {
  download?: boolean;
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

export function bezierNodesToSvgPath(nodes: { x: number; y: number; handleIn?: { x: number; y: number }; handleOut?: { x: number; y: number } }[], closed: boolean): string {
  if (!nodes || nodes.length === 0) return '';
  let d = `M ${nodes[0].x} ${nodes[0].y}`;
  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1];
    const curr = nodes[i];
    const cp1x = prev.x + (prev.handleOut ? prev.handleOut.x : 0);
    const cp1y = prev.y + (prev.handleOut ? prev.handleOut.y : 0);
    const cp2x = curr.x + (curr.handleIn ? curr.handleIn.x : 0);
    const cp2y = curr.y + (curr.handleIn ? curr.handleIn.y : 0);
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`;
  }
  if (closed && nodes.length > 2) {
    const prev = nodes[nodes.length - 1];
    const curr = nodes[0];
    const cp1x = prev.x + (prev.handleOut ? prev.handleOut.x : 0);
    const cp1y = prev.y + (prev.handleOut ? prev.handleOut.y : 0);
    const cp2x = curr.x + (curr.handleIn ? curr.handleIn.x : 0);
    const cp2y = curr.y + (curr.handleIn ? curr.handleIn.y : 0);
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${curr.x.toFixed(2)} ${curr.y.toFixed(2)} Z`;
  }
  return d;
}

export function generateEpubPackage(state: ProjectState): Record<string, string | Uint8Array> {
  const files: Record<string, string | Uint8Array> = {};

  // 1. mimetype MUST be the very first file in the ZIP, uncompressed
  files['mimetype'] = 'application/epub+zip';

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
  files['OEBPS/styles.css'] = stylesCss;

  // 4. Collect Pages across all spreads
  interface PageItem {
    id: string;
    pageNumber: number;
    filename: string;
    title: string;
    elements: CanvasElement[];
  }

  const pageItems: PageItem[] = [];
  let pageCounter = 1;

  for (const spread of state.spreads) {
    for (const page of spread.pages) {
      const pageElements = spread.elements.filter((el) => el.pageId === page.id);
      // Sort reading order: top to bottom, then left to right
      pageElements.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

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

  // 5. Generate XHTML for each page
  for (const item of pageItems) {
    let bodyContent = '';

    for (const el of item.elements) {
      if (el.type === 'text') {
        const textEl = el as TextElement;
        const processed = formatOpenTypeText(textEl.text, textEl.openTypeFeatures);
        const paragraphs = processed.split('\n');
        const alignClass = `text-${textEl.alignment || 'left'}`;

        const isTitle = textEl.fontSizePt >= 24;
        const isHeader = textEl.fontSizePt >= 14 && textEl.fontSizePt < 24;
        const hasDropCap = Boolean(textEl.dropCapLines && textEl.dropCapLines >= 2);

        for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
          const para = paragraphs[pIdx].trim();
          if (!para) continue;

          if (isTitle && pIdx === 0) {
            bodyContent += `  <h1 class="${alignClass}">${escapeXml(para)}</h1>\n`;
          } else if (isHeader && pIdx === 0) {
            bodyContent += `  <h2 class="${alignClass}">${escapeXml(para)}</h2>\n`;
          } else {
            if (hasDropCap && pIdx === 0 && para.length > 1) {
              const firstChar = para.charAt(0);
              const remainder = para.slice(1);
              bodyContent += `  <p class="${alignClass}"><span class="drop-cap">${escapeXml(firstChar)}</span>${escapeXml(remainder)}</p>\n`;
            } else {
              bodyContent += `  <p class="${alignClass}">${escapeXml(para)}</p>\n`;
            }
          }
        }
      } else if (el.type === 'table') {
        const tbl = el as TableElement;
        bodyContent += '  <table>\n';
        if (tbl.cells && tbl.cells.length > 0) {
          const hasHeaders = tbl.headerRowCount > 0;
          for (let r = 0; r < tbl.cells.length; r++) {
            const isHeaderRow = hasHeaders && r < tbl.headerRowCount;
            bodyContent += '    <tr>\n';
            for (let c = 0; c < (tbl.cells[r] || []).length; c++) {
              const cell = tbl.cells[r][c];
              const tag = isHeaderRow ? 'th' : 'td';
              const align = cell.align ? ` style="text-align: ${cell.align};"` : '';
              bodyContent += `      <${tag}${align}>${escapeXml(cell.text || '')}</${tag}>\n`;
            }
            bodyContent += '    </tr>\n';
          }
        }
        bodyContent += '  </table>\n';
      } else if (el.type === 'image') {
        const img = el as ImageElement;
        if (img.src) {
          bodyContent += `  <figure>\n    <img src="${escapeXml(img.src)}" alt="${escapeXml(img.caption || 'Publication image')}"/>\n`;
          if (img.caption) {
            bodyContent += `    <figcaption class="caption">${escapeXml(img.caption)}</figcaption>\n`;
          }
          bodyContent += '  </figure>\n';
        }
      } else if (el.type === 'path') {
        const pathEl = el as VectorPathElement;
        const d = bezierNodesToSvgPath(pathEl.nodes, pathEl.closed);
        const strokeDash = pathEl.strokeDash === 'dashed' ? ' stroke-dasharray="4,3"' : '';
        bodyContent += `  <svg viewBox="0 0 ${pathEl.width} ${pathEl.height}" width="${pathEl.width}mm" height="${pathEl.height}mm">\n`;
        bodyContent += `    <path d="${d}" fill="${pathEl.fillColor || 'none'}" stroke="${pathEl.strokeColor || '#000000'}" stroke-width="${pathEl.strokeWidthMm || 1}" stroke-linecap="${pathEl.strokeCap || 'round'}" stroke-linejoin="${pathEl.strokeJoin || 'round'}"${strokeDash}/>\n`;
        bodyContent += '  </svg>\n';
      } else if (el.type === 'shape') {
        const shape = el as ShapeElement;
        bodyContent += `  <svg viewBox="0 0 ${shape.width} ${shape.height}" width="${shape.width}mm" height="${shape.height}mm">\n`;
        if (shape.shapeKind === 'ellipse') {
          bodyContent += `    <ellipse cx="${shape.width / 2}" cy="${shape.height / 2}" rx="${shape.width / 2}" ry="${shape.height / 2}" fill="${shape.fillColor || 'none'}" stroke="${shape.strokeColor || '#000000'}" stroke-width="${shape.strokeWidthMm || 1}"/>\n`;
        } else if (shape.shapeKind === 'line') {
          bodyContent += `    <line x1="0" y1="${shape.height / 2}" x2="${shape.width}" y2="${shape.height / 2}" stroke="${shape.strokeColor || '#000000'}" stroke-width="${shape.strokeWidthMm || 1}"/>\n`;
        } else {
          bodyContent += `    <rect x="0" y="0" width="${shape.width}" height="${shape.height}" fill="${shape.fillColor || 'none'}" stroke="${shape.strokeColor || '#000000'}" stroke-width="${shape.strokeWidthMm || 1}"/>\n`;
        }
        bodyContent += '  </svg>\n';
      }
    }

    const pageXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
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
  const navLinks = pageItems
    .map((p) => `        <li><a href="${p.filename}">${escapeXml(p.title)}</a></li>`)
    .join('\n');

  files['OEBPS/nav.xhtml'] = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
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

  // 7. OEBPS/package.opf (Package Document)
  const bookId = `urn:uuid:recto-${Date.now()}`;
  const modifiedIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const manifestEntries = [
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="css" href="styles.css" media-type="text/css"/>',
    ...pageItems.map((p) => `    <item id="${p.id}" href="${p.filename}" media-type="application/xhtml+xml"/>`),
  ].join('\n');

  const spineEntries = pageItems.map((p) => `    <itemref idref="${p.id}"/>`).join('\n');

  files['OEBPS/package.opf'] = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${bookId}</dc:identifier>
    <dc:title>${escapeXml(state.settings.title || 'Recto Publication')}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${modifiedIso}</meta>
    <dc:creator>Recto DTP Studio</dc:creator>
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
): { buffer: Uint8Array; filename: string } {
  const files = generateEpubPackage(state);
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

  return { buffer, filename };
}
