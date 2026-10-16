/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */
// Recto Self-Contained Interactive Web Flipbook Export Engine
// Generates a single standalone HTML package with 3D page curls, keyboard nav, and responsive vector layout

import { ProjectState, CanvasElement, TextElement, ImageElement, ShapeElement, TableElement, VectorPathElement, Page } from './types';
import { bezierNodesToSvgPath, escapeXml } from './epubExport';
import { formatOpenTypeText } from './canvas';

import { stateManager } from './state';

export interface FlipbookExportOptions {
  download?: boolean;
}

export function generateFlipbookHtml(state: ProjectState): string {
  const widthMm = state.settings.widthMm || 210;
  const heightMm = state.settings.heightMm || 297;
  const title = escapeXml(state.settings.title || 'Recto Interactive Flipbook');

  // Standard CSS millimeter to pixel coordinate conversion (96 DPI: 1 mm = 3.779528 px)
  const PX_PER_MM = 3.779528;
  const pageWidthPx = Math.round(widthMm * PX_PER_MM);
  const pageHeightPx = Math.round(heightMm * PX_PER_MM);

  // Collect all pages in sequential order
  interface FlatPage {
    pageNumber: number;
    side: 'left' | 'right' | 'single';
    elements: CanvasElement[];
  }

  const pages: FlatPage[] = [];
  let pageCount = 0;

  for (const spread of state.spreads) {
    for (const page of spread.pages) {
      pageCount++;
      const elements = spread.elements.filter((el) => el.pageId === page.id);
      elements.sort((a, b) => a.zIndex - b.zIndex);
      pages.push({
        pageNumber: page.pageNumber || pageCount,
        side: page.side || 'single',
        elements,
      });
    }
  }

  // Render individual page HTML with high-DPI sub-pixel crispness
  function renderPageContent(p: FlatPage): string {
    let elementsHtml = '';

    for (const el of p.elements) {
      const elXPx = Math.round(el.x * PX_PER_MM * 10) / 10;
      const elYPx = Math.round(el.y * PX_PER_MM * 10) / 10;
      const elWPx = Math.round(el.width * PX_PER_MM * 10) / 10;
      const elHPx = Math.round(el.height * PX_PER_MM * 10) / 10;
      const transform = `transform: rotate(${el.rotation || 0}deg);`;
      const opacity = `opacity: ${el.opacity ?? 1};`;
      const zIndex = `z-index: ${el.zIndex || 1};`;
      const baseStyle = `position: absolute; left: ${elXPx}px; top: ${elYPx}px; width: ${elWPx}px; height: ${elHPx}px; ${transform} ${opacity} ${zIndex} box-sizing: border-box;`;

      if (el.type === 'text') {
        const textEl = el as TextElement;
        const evaluated = stateManager.evaluateTokens(textEl.text, p.pageNumber);
        const processed = formatOpenTypeText(evaluated, textEl.openTypeFeatures);
        const colCount = textEl.columns || 1;
        const colGutterPx = Math.round((textEl.columnGutterMm || 4) * PX_PER_MM * 10) / 10;
        const paddingPx = Math.round((textEl.paddingMm || 2) * PX_PER_MM * 10) / 10;
        const bg = textEl.backgroundColor && textEl.backgroundColor !== 'transparent' ? `background-color: ${textEl.backgroundColor};` : '';
        const borderWPx = Math.max(1, Math.round((textEl.borderWidthMm || 0) * PX_PER_MM * 10) / 10);
        const border = textEl.borderWidthMm > 0 && textEl.borderColor !== 'transparent' ? `border: ${borderWPx}px solid ${textEl.borderColor};` : '';
        const letterSpacingPx = textEl.letterSpacingPt ? `letter-spacing: ${(textEl.letterSpacingPt * (96 / 72)).toFixed(2)}px;` : '';
        const smallCaps = textEl.openTypeFeatures?.smallCaps ? 'font-variant: small-caps;' : '';
        const fontSizePx = Math.round(textEl.fontSizePt * (96 / 72) * 10) / 10;

        const colStyle = colCount > 1 ? `column-count: ${colCount}; column-gap: ${colGutterPx}px;` : '';
        const dropCapClass = textEl.dropCapLines && textEl.dropCapLines >= 2 ? `drop-cap-${textEl.dropCapLines}` : '';

        const paragraphs = processed.split('\n');
        let parasHtml = '';
        for (let idx = 0; idx < paragraphs.length; idx++) {
          const raw = paragraphs[idx];
          if (!raw.trim()) {
            parasHtml += '<div style="height: 0.8em;"></div>';
            continue;
          }
          if (idx === 0 && textEl.dropCapLines && textEl.dropCapLines >= 2 && raw.length > 1) {
            const first = raw.charAt(0);
            const rest = raw.slice(1);
            parasHtml += `<p class="para ${dropCapClass}"><span class="drop-cap">${escapeXml(first)}</span>${escapeXml(rest)}</p>`;
          } else {
            parasHtml += `<p class="para">${escapeXml(raw)}</p>`;
          }
        }

        const textStyle = `font-family: ${textEl.fontFamily || 'serif'}; font-size: ${fontSizePx}px; line-height: ${textEl.lineHeight || 1.3}; color: ${textEl.color || '#111'}; text-align: ${textEl.alignment || 'left'}; padding: ${paddingPx}px; ${bg} ${border} ${letterSpacingPx} ${smallCaps} ${colStyle} overflow: hidden;`;

        elementsHtml += `    <div style="${baseStyle} ${textStyle}">\n${parasHtml}    </div>\n`;
      } else if (el.type === 'image') {
        const img = el as ImageElement;
        const fit = img.fitMode === 'fill' ? 'cover' : img.fitMode === 'fit' ? 'contain' : img.fitMode === 'center' ? 'none' : 'fill';
        const borderWPx = Math.max(1, Math.round((img.borderWidthMm || 0) * PX_PER_MM));
        const border = img.borderWidthMm > 0 && img.borderColor !== 'transparent' ? `border: ${borderWPx}px solid ${img.borderColor};` : '';
        elementsHtml += `    <div style="${baseStyle} overflow: hidden; ${border}">\n`;
        if (img.src) {
          elementsHtml += `      <img src="${escapeXml(img.src)}" alt="${escapeXml(img.caption || '')}" style="width: 100%; height: 100%; object-fit: ${fit}; display: block; image-rendering: high-quality; image-rendering: -webkit-optimize-contrast;"/>\n`;
        } else {
          elementsHtml += `      <div style="width: 100%; height: 100%; background: #eee; display: flex; align-items: center; justify-content: center; color: #888; font-size: 14px;">[Image Frame]</div>\n`;
        }
        elementsHtml += '    </div>\n';
      } else if (el.type === 'table') {
        const tbl = el as TableElement;
        const cellPadPx = Math.round((tbl.cellPaddingMm || 2) * PX_PER_MM * 10) / 10;
        const borderWPx = Math.max(1, Math.round((tbl.borderWidthMm || 1) * PX_PER_MM));
        const borderStyle = tbl.borderWidthMm > 0 ? `${borderWPx}px solid ${tbl.borderColor || '#333'}` : 'none';
        const tblFontSizePx = Math.round((tbl.fontSizePt || 10) * (96 / 72) * 10) / 10;

        let rowsHtml = '';
        if (tbl.cells) {
          for (let r = 0; r < tbl.cells.length; r++) {
            const isHeader = tbl.headerRowCount > 0 && r < tbl.headerRowCount;
            const rowBg = isHeader ? tbl.headerFillColor : (tbl.alternateRowColor && r % 2 === 1 ? tbl.alternateRowColor : undefined);
            rowsHtml += `      <tr style="${rowBg ? `background: ${rowBg};` : ''}">\n`;
            for (let c = 0; c < (tbl.cells[r] || []).length; c++) {
              const cell = tbl.cells[r][c];
              const tag = isHeader ? 'th' : 'td';
              const cellColor = isHeader ? tbl.headerTextColor : (cell.textColor || '#111');
              const align = cell.align || 'left';
              rowsHtml += `        <${tag} style="padding: ${cellPadPx}px; border: ${borderStyle}; text-align: ${align}; color: ${cellColor}; font-weight: ${isHeader ? 700 : 400};">${escapeXml(cell.text || '')}</${tag}>\n`;
            }
            rowsHtml += '      </tr>\n';
          }
        }

        elementsHtml += `    <div style="${baseStyle} overflow: auto;">\n      <table style="width: 100%; height: 100%; border-collapse: collapse; font-family: ${tbl.fontFamily || 'sans-serif'}; font-size: ${tblFontSizePx}px; border: ${borderStyle};">\n${rowsHtml}      </table>\n    </div>\n`;
      } else if (el.type === 'path') {
        const pathEl = el as VectorPathElement;
        const scaledNodes = pathEl.nodes.map((n) => ({
          x: n.x * PX_PER_MM,
          y: n.y * PX_PER_MM,
          handleIn: n.handleIn ? { x: n.handleIn.x * PX_PER_MM, y: n.handleIn.y * PX_PER_MM } : undefined,
          handleOut: n.handleOut ? { x: n.handleOut.x * PX_PER_MM, y: n.handleOut.y * PX_PER_MM } : undefined,
        }));
        const d = bezierNodesToSvgPath(scaledNodes, pathEl.closed);
        const strokeDash = pathEl.strokeDash === 'dashed' ? ' stroke-dasharray="8,6"' : '';
        const strokeWPx = Math.max(1, Math.round((pathEl.strokeWidthMm || 1) * PX_PER_MM));
        elementsHtml += `    <div style="${baseStyle}">\n`;
        elementsHtml += `      <svg viewBox="0 0 ${elWPx} ${elHPx}" style="width: 100%; height: 100%; overflow: visible;">\n`;
        elementsHtml += `        <path d="${d}" fill="${pathEl.fillColor || 'none'}" stroke="${pathEl.strokeColor || '#000'}" stroke-width="${strokeWPx}" stroke-linecap="${pathEl.strokeCap || 'round'}" stroke-linejoin="${pathEl.strokeJoin || 'round'}"${strokeDash}/>\n`;
        elementsHtml += '      </svg>\n    </div>\n';
      } else if (el.type === 'shape') {
        const shape = el as ShapeElement;
        const strokeWPx = shape.strokeWidthMm > 0 ? Math.max(1, Math.round(shape.strokeWidthMm * PX_PER_MM)) : 0;
        elementsHtml += `    <div style="${baseStyle}">\n`;
        elementsHtml += `      <svg viewBox="0 0 ${elWPx} ${elHPx}" style="width: 100%; height: 100%;">\n`;
        if (shape.shapeKind === 'ellipse') {
          elementsHtml += `        <ellipse cx="${elWPx / 2}" cy="${elHPx / 2}" rx="${Math.max(1, elWPx / 2 - strokeWPx / 2)}" ry="${Math.max(1, elHPx / 2 - strokeWPx / 2)}" fill="${shape.fillColor || 'none'}" stroke="${shape.strokeColor || '#000'}" stroke-width="${strokeWPx}"/>\n`;
        } else if (shape.shapeKind === 'line') {
          elementsHtml += `        <line x1="0" y1="${elHPx / 2}" x2="${elWPx}" y2="${elHPx / 2}" stroke="${shape.strokeColor || '#000'}" stroke-width="${strokeWPx || 1}"/>\n`;
        } else {
          elementsHtml += `        <rect x="${strokeWPx / 2}" y="${strokeWPx / 2}" width="${Math.max(1, elWPx - strokeWPx)}" height="${Math.max(1, elHPx - strokeWPx)}" fill="${shape.fillColor || 'none'}" stroke="${shape.strokeColor || '#000'}" stroke-width="${strokeWPx}"/>\n`;
        }
        elementsHtml += '      </svg>\n    </div>\n';
      }
    }

    return elementsHtml;
  }

  // Build Spreads array for 3D flipbook
  interface FlipSpread {
    index: number;
    label: string;
    leftPage?: FlatPage;
    rightPage?: FlatPage;
  }

  const flipSpreads: FlipSpread[] = [];
  const facing = state.settings.facingPages;

  if (facing) {
    let pIdx = 0;
    let sIdx = 0;
    while (pIdx < pages.length) {
      if (pIdx === 0) {
        // Cover spread: single right page
        flipSpreads.push({
          index: sIdx++,
          label: `Cover (Page 1)`,
          rightPage: pages[0],
        });
        pIdx += 1;
      } else {
        const left = pages[pIdx];
        const right = pIdx + 1 < pages.length ? pages[pIdx + 1] : undefined;
        const label = right ? `Pages ${left.pageNumber}–${right.pageNumber}` : `Page ${left.pageNumber}`;
        flipSpreads.push({
          index: sIdx++,
          label,
          leftPage: left,
          rightPage: right,
        });
        pIdx += 2;
      }
    }
  } else {
    // Single page mode
    pages.forEach((p, idx) => {
      flipSpreads.push({
        index: idx,
        label: `Page ${p.pageNumber}`,
        leftPage: p,
      });
    });
  }

  let spreadsMarkup = '';
  flipSpreads.forEach((sp, idx) => {
    const activeClass = idx === 0 ? ' active' : '';
    spreadsMarkup += `    <div class="flip-spread${activeClass}" data-spread="${idx}">\n`;

    // Left Leaf
    if (sp.leftPage) {
      spreadsMarkup += `      <div class="flip-leaf left-leaf" style="width: ${pageWidthPx}px; height: ${pageHeightPx}px;">\n`;
      spreadsMarkup += renderPageContent(sp.leftPage);
      spreadsMarkup += `        <div class="page-num left-num" style="bottom: ${Math.round(10 * PX_PER_MM)}px; left: ${Math.round(12 * PX_PER_MM)}px; font-size: ${Math.round(8 * (96 / 72))}px;">${sp.leftPage.pageNumber}</div>\n`;
      spreadsMarkup += `        <div class="leaf-shadow left-shadow"></div>\n`;
      spreadsMarkup += '      </div>\n';
    } else {
      spreadsMarkup += `      <div class="flip-leaf left-leaf empty-leaf" style="width: ${pageWidthPx}px; height: ${pageHeightPx}px;">\n`;
      spreadsMarkup += `        <div class="leaf-shadow left-shadow"></div>\n`;
      spreadsMarkup += '      </div>\n';
    }

    // Spine
    spreadsMarkup += '      <div class="book-spine"></div>\n';

    // Right Leaf
    if (sp.rightPage) {
      spreadsMarkup += `      <div class="flip-leaf right-leaf" style="width: ${pageWidthPx}px; height: ${pageHeightPx}px;">\n`;
      spreadsMarkup += renderPageContent(sp.rightPage);
      spreadsMarkup += `        <div class="page-num right-num" style="bottom: ${Math.round(10 * PX_PER_MM)}px; right: ${Math.round(12 * PX_PER_MM)}px; font-size: ${Math.round(8 * (96 / 72))}px;">${sp.rightPage.pageNumber}</div>\n`;
      spreadsMarkup += `        <div class="leaf-shadow right-shadow"></div>\n`;
      spreadsMarkup += '      </div>\n';
    } else {
      spreadsMarkup += `      <div class="flip-leaf right-leaf empty-leaf" style="width: ${pageWidthPx}px; height: ${pageHeightPx}px;">\n`;
      spreadsMarkup += `        <div class="leaf-shadow right-shadow"></div>\n`;
      spreadsMarkup += '      </div>\n';
    }

    spreadsMarkup += '    </div>\n';
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
  <title>${title} — Interactive Web Flipbook</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #111113;
      color: #e5e5e5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
      user-select: none;
    }

    /* Top Navigation Toolbar */
    header.flipbook-toolbar {
      height: 48px;
      background: rgba(22, 22, 26, 0.95);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      z-index: 1000;
      backdrop-filter: blur(8px);
    }

    .doc-title {
      font-weight: 600;
      font-size: 14px;
      color: #f3f4f6;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .doc-title .badge {
      background: #0d99ff;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .nav-controls {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #f3f4f6;
      font-size: 12px;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
    }

    .btn:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.16);
      border-color: rgba(255, 255, 255, 0.25);
    }

    .btn:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }

    .page-indicator {
      font-size: 12px;
      color: #9ca3af;
      font-variant-numeric: tabular-nums;
      padding: 0 4px;
    }

    /* Flipbook Main Stage */
    main.flipbook-stage {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      perspective: 2500px;
      overflow: hidden;
      position: relative;
      background: radial-gradient(circle at center, #1e1e24 0%, #0e0e11 100%);
    }

    .book-wrapper {
      position: relative;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 5px 15px rgba(0, 0, 0, 0.4);
      transform-origin: center center;
    }

    .flip-spread {
      display: none;
      position: relative;
      background: transparent;
    }

    .flip-spread.active {
      display: flex;
    }

    /* Page Leaf Styling */
    .flip-leaf {
      background: #ffffff;
      position: relative;
      overflow: hidden;
      -webkit-font-smoothing: subpixel-antialiased;
      -moz-osx-font-smoothing: auto;
      text-rendering: geometricPrecision;
      box-shadow: inset 0 0 30px rgba(0, 0, 0, 0.04);
      transform-origin: center center;
    }

    .empty-leaf {
      background: #18181b !important;
      box-shadow: none !important;
    }

    .left-leaf {
      border-radius: 4px 0 0 4px;
      transform-origin: right center;
    }

    .right-leaf {
      border-radius: 0 4px 4px 0;
      transform-origin: left center;
    }

    .book-spine {
      width: 4px;
      background: linear-gradient(to right, rgba(0,0,0,0.3), rgba(0,0,0,0.5), rgba(0,0,0,0.3));
      z-index: 50;
    }

    .leaf-shadow {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 30px;
      pointer-events: none;
      z-index: 40;
    }

    .left-shadow {
      right: 0;
      background: linear-gradient(to left, rgba(0,0,0,0.12), transparent);
    }

    .right-shadow {
      left: 0;
      background: linear-gradient(to right, rgba(0,0,0,0.12), transparent);
    }

    .page-num {
      position: absolute;
      bottom: 10mm;
      font-size: 8pt;
      font-family: -apple-system, sans-serif;
      color: #999;
      pointer-events: none;
      z-index: 30;
    }

    .left-num { left: 12mm; }
    .right-num { right: 12mm; }

    /* Interactive Drop Caps & Paragraph Typography */
    .para {
      margin-bottom: 0.6em;
      text-rendering: optimizeLegibility;
    }

    .drop-cap {
      float: left;
      font-size: 3em;
      line-height: 0.8;
      padding-top: 2px;
      padding-right: 6px;
      font-weight: 700;
      font-family: "Playfair Display", Georgia, serif;
    }

    /* 3D Flip Animation Classes */
    @keyframes flipNextAnim {
      0% { transform: rotateY(0deg); }
      100% { transform: rotateY(-180deg); }
    }

    @keyframes flipPrevAnim {
      0% { transform: rotateY(0deg); }
      100% { transform: rotateY(180deg); }
    }

    /* Navigation Overlay Arrows */
    .nav-arrow {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 52px;
      height: 52px;
      background: rgba(30, 30, 36, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #fff;
      font-size: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.2s ease;
      z-index: 100;
      backdrop-filter: blur(4px);
    }

    .nav-arrow:hover {
      background: rgba(13, 153, 255, 0.85);
      border-color: #0d99ff;
      transform: translateY(-50%) scale(1.08);
    }

    .nav-arrow-left { left: 24px; }
    .nav-arrow-right { right: 24px; }

    /* Footer Status & Hotkey Hints */
    footer.flipbook-footer {
      height: 36px;
      background: rgba(22, 22, 26, 0.9);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      font-size: 11px;
      color: #9ca3af;
    }

    .hotkey-hints {
      display: flex;
      gap: 14px;
    }

    kbd {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 3px;
      padding: 1px 5px;
      font-size: 10px;
      font-family: inherit;
      color: #e5e5e5;
    }

    @media (max-width: 768px) {
      .doc-title span { display: none; }
      .hotkey-hints { display: none; }
      .nav-arrow { display: none; }
    }
  </style>
</head>
<body>
  <header class="flipbook-toolbar">
    <div class="doc-title">
      <span class="badge">Recto</span>
      <span>${title}</span>
    </div>
    <div class="nav-controls">
      <button class="btn" id="prevBtn" title="Previous Spread (Left Arrow)">⇦ Prev</button>
      <span class="page-indicator" id="pageIndicator">Spread 1 of ${flipSpreads.length}</span>
      <button class="btn" id="nextBtn" title="Next Spread (Right Arrow / Space)">Next ⇨</button>
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn" id="zoomFitBtn" title="Reset Fit">⊙ Fit</button>
      <button class="btn" id="fullscreenBtn" title="Toggle Fullscreen (F)">⛶ Fullscreen</button>
    </div>
  </header>

  <main class="flipbook-stage" id="stage">
    <button class="nav-arrow nav-arrow-left" id="arrowLeft" title="Previous Spread">‹</button>
    
    <div class="book-wrapper" id="bookWrapper">
${spreadsMarkup}
    </div>

    <button class="nav-arrow nav-arrow-right" id="arrowRight" title="Next Spread">›</button>
  </main>

  <footer class="flipbook-footer">
    <div>Recto Universal Web Flipbook · ${pages.length} Pages · ${state.settings.preset || 'A4'}</div>
    <div class="hotkey-hints">
      <span><kbd>←</kbd> / <kbd>→</kbd> Flip</span>
      <span><kbd>Space</kbd> Next</span>
      <span><kbd>F</kbd> Fullscreen</span>
      <span><kbd>Home</kbd> / <kbd>End</kbd> First / Last</span>
    </div>
  </footer>

  <script>
    (function() {
      let currentSpread = 0;
      const totalSpreads = ${flipSpreads.length};
      const spreads = document.querySelectorAll('.flip-spread');
      const prevBtn = document.getElementById('prevBtn');
      const nextBtn = document.getElementById('nextBtn');
      const arrowLeft = document.getElementById('arrowLeft');
      const arrowRight = document.getElementById('arrowRight');
      const pageIndicator = document.getElementById('pageIndicator');
      const bookWrapper = document.getElementById('bookWrapper');
      const stage = document.getElementById('stage');
      const fullscreenBtn = document.getElementById('fullscreenBtn');
      const zoomFitBtn = document.getElementById('zoomFitBtn');

      // Spread labels
      const spreadLabels = ${JSON.stringify(flipSpreads.map((s) => s.label))};

      function updateUI() {
        spreads.forEach((s, idx) => {
          if (idx === currentSpread) {
            s.classList.add('active');
          } else {
            s.classList.remove('active');
          }
        });

        const label = spreadLabels[currentSpread] || ('Spread ' + (currentSpread + 1));
        pageIndicator.textContent = label + ' (' + (currentSpread + 1) + '/' + totalSpreads + ')';
        prevBtn.disabled = currentSpread <= 0;
        nextBtn.disabled = currentSpread >= totalSpreads - 1;
        arrowLeft.style.opacity = currentSpread <= 0 ? '0.3' : '1';
        arrowRight.style.opacity = currentSpread >= totalSpreads - 1 ? '0.3' : '1';
      }

      function nextSpread() {
        if (currentSpread < totalSpreads - 1) {
          currentSpread++;
          updateUI();
        }
      }

      function prevSpread() {
        if (currentSpread > 0) {
          currentSpread--;
          updateUI();
        }
      }

      // Responsive auto-fit scaling with native typography rasterization
      function resizeBook() {
        if (!stage || !bookWrapper) return;
        const stageW = stage.clientWidth - 80;
        const stageH = stage.clientHeight - 40;
        const bookW = (${pageWidthPx} * 2 + 4);
        const bookH = ${pageHeightPx};

        const scaleX = stageW / bookW;
        const scaleY = stageH / bookH;
        const scale = Math.min(scaleX, scaleY);

        if ('zoom' in bookWrapper.style) {
          bookWrapper.style.zoom = scale.toFixed(4);
          bookWrapper.style.transform = 'none';
        } else {
          bookWrapper.style.transform = 'scale(' + scale.toFixed(4) + ')';
          bookWrapper.style.transformOrigin = 'center center';
        }
      }

      window.addEventListener('resize', resizeBook);
      setTimeout(resizeBook, 50);

      // Keyboard Controls
      window.addEventListener('keydown', function(e) {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          nextSpread();
        } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          prevSpread();
        } else if (e.key === 'Home') {
          e.preventDefault();
          currentSpread = 0;
          updateUI();
        } else if (e.key === 'End') {
          e.preventDefault();
          currentSpread = totalSpreads - 1;
          updateUI();
        } else if (e.key === 'f' || e.key === 'F') {
          toggleFullscreen();
        }
      });

      // Button Listeners
      prevBtn.addEventListener('click', prevSpread);
      nextBtn.addEventListener('click', nextSpread);
      arrowLeft.addEventListener('click', prevSpread);
      arrowRight.addEventListener('click', nextSpread);
      zoomFitBtn.addEventListener('click', resizeBook);

      // Fullscreen
      function toggleFullscreen() {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(function() {});
        } else {
          document.exitFullscreen().catch(function() {});
        }
      }
      fullscreenBtn.addEventListener('click', toggleFullscreen);

      // Touch Swipe Handling
      let touchStartX = 0;
      stage.addEventListener('touchstart', function(e) {
        if (e.touches && e.touches[0]) {
          touchStartX = e.touches[0].clientX;
        }
      }, { passive: true });

      stage.addEventListener('touchend', function(e) {
        if (e.changedTouches && e.changedTouches[0]) {
          const deltaX = e.changedTouches[0].clientX - touchStartX;
          if (deltaX < -50) nextSpread();
          else if (deltaX > 50) prevSpread();
        }
      }, { passive: true });

      updateUI();
    })();
  </script>
</body>
</html>`;
}

export function exportDocumentToFlipbook(
  state: ProjectState,
  options: FlipbookExportOptions = { download: true }
): { html: string; filename: string } {
  const html = generateFlipbookHtml(state);
  const baseTitle = state.settings.title.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'recto-flipbook';
  const filename = `${baseTitle}.html`;

  if (options.download && typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { html, filename };
}
