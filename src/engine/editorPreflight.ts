import type { PreflightIssue, ProjectState, Spread, TextElement } from '../types';
import { layoutFrameNotes } from './publicationReferences';
import { publicationPreflight } from './publicationPreflight';
import { layoutStory } from './storyLayout';

export function calculateTacPercentage(colorStr?: string): number {
  if (!colorStr || colorStr === 'transparent' || colorStr === 'none') return 0;
  const str = colorStr.trim();
  const cmykMatch = str.match(/cmyk\s*\(\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*\)/i);
  if (cmykMatch) {
    const c = parseFloat(cmykMatch[1]) || 0;
    const m = parseFloat(cmykMatch[2]) || 0;
    const y = parseFloat(cmykMatch[3]) || 0;
    const k = parseFloat(cmykMatch[4]) || 0;
    return Math.round(c + m + y + k);
  }

  let hex = str;
  if (hex.startsWith('#')) {
    hex = hex.substring(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      const k = 1 - Math.max(r, g, b);
      if (k >= 0.99) return 100;
      const c = (1 - r - k) / (1 - k);
      const m = (1 - g - k) / (1 - k);
      const y = (1 - b - k) / (1 - k);
      return Math.round((c + m + y + k) * 100);
    }
  }
  return 0;
}

function textOverflowMessage(state: ProjectState, spread: Spread, frame: TextElement): string | undefined {
  const text = frame.text || '';
  if (!text.length || frame.nextFrameId) return;
  if (frame.textContent) {
    const reserve = state.settings.footnotes?.length ? layoutFrameNotes(state, frame).height : 0;
    const layout = layoutStory(frame.textContent, frame, state.paragraphStyles, state.characterStyles, undefined, reserve,
      { obstacles: spread.elements, baselineGrid: state.settings.baselineGrid, positionText: false });
    if (layout.overset) return 'Manuscript text exceeds the final frame. Link another frame or enlarge this frame.';
    return;
  }

  const padding = frame.paddingMm ?? 2;
  const columns = Math.max(1, frame.columns || 1);
  const width = Math.max(10, (frame.width - padding * 2 - (columns - 1) * (frame.columnGutterMm ?? 4)) / columns);
  const height = Math.max(10, frame.height - padding * 2);
  const fontPt = frame.fontSizePt || 10;
  const lines = Math.max(1, Math.floor(height / (fontPt * (frame.lineHeight || 1.3) * 25.4 / 72))) * columns;
  const charactersPerLine = Math.max(10, Math.floor(width / (fontPt * 0.45 * 25.4 / 72)));
  const capacity = lines * charactersPerLine;
  let usedLines = 0;
  let start = 0;
  for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', start)) {
    usedLines += Math.max(1, Math.ceil((end - start) / charactersPerLine));
    start = end + 1;
  }
  usedLines += Math.max(1, Math.ceil((text.length - start) / charactersPerLine));
  if (usedLines <= lines && text.length <= capacity * 1.15) return;
  const excess = Math.max(usedLines - lines, Math.ceil((text.length - capacity) / charactersPerLine));
  return `Text frame overflows available area by ~${excess} lines. Link to next frame or enlarge frame.`;
}

export function runEditorPreflight(snapshot: ProjectState): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const settings = snapshot.settings;
  const pageWidthMm = settings.widthMm;
  const pageHeightMm = settings.heightMm;
  const bleedMm = settings.bleedMm ?? 3;

  let hasSeenH1 = false;
  let lastHeadingLevel = 0;

  snapshot.spreads.forEach((spread, spreadIdx) => {
    for (const el of spread.elements) {
      if (el.pasteboard) continue;
      const page = spread.pages.find((p) => p.id === el.pageId) || spread.pages[0];
      const pageNumber = page ? page.pageNumber : spreadIdx + 1;

      // 1. OVERSET_TEXT: Overflowing text frames without continuation nextFrameId
      if (el.type === 'text') {
        const message = textOverflowMessage(snapshot, spread, el);
        if (message) issues.push({ id: `preflight-overset-${spreadIdx}-${el.id}`, severity: 'error',
          code: 'OVERSET_TEXT', message, spreadIndex: spreadIdx, pageNumber, elementId: el.id });
      }

      // 2. LOW_RES_IMAGE: Empty src or low effective DPI (<220 DPI)
      if (el.type === 'image') {
        const imgEl = el;
        if (!imgEl.src || imgEl.src.trim() === '') {
          issues.push({
            id: `preflight-empty-img-${spreadIdx}-${el.id}`,
            severity: 'error',
            code: 'LOW_RES_IMAGE',
            message: `Image frame is empty placeholder without source photo.`,
            spreadIndex: spreadIdx,
            pageNumber,
            elementId: el.id,
          });
        } else if (!imgEl.src.startsWith('data:image/svg+xml') && (imgEl.originalWidth && imgEl.originalHeight
          ? Math.min(imgEl.originalWidth / imgEl.width, imgEl.originalHeight / imgEl.height) * 25.4 < 220
          : imgEl.src.startsWith('data:image') && imgEl.src.length < 250 && imgEl.width > 15)) {
          issues.push({
            id: `preflight-lowres-${spreadIdx}-${el.id}`,
            severity: 'warning',
            code: 'LOW_RES_IMAGE',
            message: `Image resolution appears below print threshold (< 220 DPI on spread).`,
            spreadIndex: spreadIdx,
            pageNumber,
            elementId: el.id,
          });
        }
      }

      // 3. TRIM_HAZARD: Text elements placed < 4mm from page trim boundary
      if (el.type === 'text') {
        const trimMargin = 4;
        const rightEdge = el.x + el.width;
        const bottomEdge = el.y + el.height;
        if (
          el.x < trimMargin ||
          el.y < trimMargin ||
          rightEdge > pageWidthMm - trimMargin ||
          bottomEdge > pageHeightMm - trimMargin
        ) {
          issues.push({
            id: `preflight-trim-${spreadIdx}-${el.id}`,
            severity: 'warning',
            code: 'TRIM_HAZARD',
            message: `Text frame placed within 4mm of page trim edge. Risk of clipping during print trimming.`,
            spreadIndex: spreadIdx,
            pageNumber,
            elementId: el.id,
          });
        }
      }

      // 4. BLEED_ERROR: Images touching the trim edge without filling full bleed allowance
      if (el.type === 'image') {
        const rightEdge = el.x + el.width;
        const bottomEdge = el.y + el.height;
        const touchesLeft = Math.abs(el.x) <= 1.0;
        const touchesTop = Math.abs(el.y) <= 1.0;
        const touchesRight = Math.abs(rightEdge - pageWidthMm) <= 1.0;
        const touchesBottom = Math.abs(bottomEdge - pageHeightMm) <= 1.0;

        if (touchesLeft || touchesTop || touchesRight || touchesBottom) {
          const hasProperBleed =
            (!touchesLeft || el.x <= -bleedMm + 0.5) &&
            (!touchesTop || el.y <= -bleedMm + 0.5) &&
            (!touchesRight || rightEdge >= pageWidthMm + bleedMm - 0.5) &&
            (!touchesBottom || bottomEdge >= pageHeightMm + bleedMm - 0.5);

          if (!hasProperBleed) {
            issues.push({
              id: `preflight-bleed-${spreadIdx}-${el.id}`,
              severity: 'warning',
              code: 'BLEED_ERROR',
              message: `Image touches page boundary but lacks ${bleedMm}mm bleed allowance. May show white edge defect when trimmed.`,
              spreadIndex: spreadIdx,
              pageNumber,
              elementId: el.id,
            });
          }
        }
      }

      // 5. MISSING_ALT_TEXT: Images lacking Alt Text for screen readers (PDF/UA Section 508)
      if (el.type === 'image') {
        const imgEl = el;
        if (!imgEl.decorative && (!imgEl.altText || !imgEl.altText.trim())) {
          issues.push({
            id: `preflight-alt-${spreadIdx}-${el.id}`,
            severity: 'warning',
            code: 'MISSING_ALT_TEXT',
            message: `Image frame "${imgEl.name || imgEl.id}" is missing Alt Text description for screen-reader accessibility (Section 508 / PDF/UA).`,
            spreadIndex: spreadIdx,
            pageNumber,
            elementId: el.id,
          });
        }
      }

      // 6. HEADING_ORDER_HAZARD: Logical heading structure check (H2/H3 before H1 or level skip)
      if (el.type === 'text') {
        const textEl = el;
        if (textEl.paragraphStyleId) {
          const style = snapshot.paragraphStyles.find((s) => s.id === textEl.paragraphStyleId);
          const tag = style?.pdfTag;
          if (tag && /^H[1-6]$/i.test(tag)) {
            const level = parseInt(tag.substring(1), 10);
            if (level === 1) {
              hasSeenH1 = true;
              lastHeadingLevel = 1;
            } else {
              if (!hasSeenH1) {
                issues.push({
                  id: `preflight-heading-order-${spreadIdx}-${el.id}`,
                  severity: 'warning',
                  code: 'HEADING_ORDER_HAZARD',
                  message: `Heading hierarchy warning: <${tag}> appears before an <H1> has been defined (PDF/UA Section 508).`,
                  spreadIndex: spreadIdx,
                  pageNumber,
                  elementId: el.id,
                });
              } else if (level > lastHeadingLevel + 1) {
                issues.push({
                  id: `preflight-heading-order-${spreadIdx}-${el.id}`,
                  severity: 'warning',
                  code: 'HEADING_ORDER_HAZARD',
                  message: `Heading hierarchy warning: <${tag}> skips heading levels after <H${lastHeadingLevel}> (PDF/UA Section 508).`,
                  spreadIndex: spreadIdx,
                  pageNumber,
                  elementId: el.id,
                });
              }
              lastHeadingLevel = level;
            }
          }
        }
      }

      // 7. TAC_INK_DENSITY: Total Area Coverage (TAC) exceeding 300%
      if (el.type === 'shape' || el.type === 'text') {
        const colorsToCheck = el.type === 'shape'
          ? [el.fillColor, el.strokeColor]
          : [el.color, el.backgroundColor, el.borderColor];

        for (const col of colorsToCheck) {
          const tac = calculateTacPercentage(col);
          if (tac > 300) {
            issues.push({
              id: `preflight-tac-${spreadIdx}-${el.id}`,
              severity: 'warning',
              code: 'TAC_INK_DENSITY',
              message: `Ink coverage (${tac}%) exceeds standard press threshold (300% TAC). Risk of wet ink offset and smudging.`,
              spreadIndex: spreadIdx,
              pageNumber,
              elementId: el.id,
            });
            break;
          }
        }
      }

      // 8. Typographic Linter: Straight Quotes, Double Spaces, Hyphenation Ladders
      if (el.type === 'text') {
        const txt = el;
        const content = txt.text || '';
        if (content.length > 0) {
          if (/"|'/.test(content)) {
            issues.push({
              id: `preflight-typo-quotes-${spreadIdx}-${el.id}`,
              severity: 'info',
              code: 'TYPO_STRAIGHT_QUOTES',
              message: 'Straight typewriter quote(s) detected. Recommend typographical smart curly quotes (“ ” ‘ ’).',
              spreadIndex: spreadIdx,
              pageNumber,
              elementId: el.id,
            });
          }
          if (/  +/.test(content)) {
            issues.push({
              id: `preflight-typo-spaces-${spreadIdx}-${el.id}`,
              severity: 'info',
              code: 'TYPO_DOUBLE_SPACES',
              message: 'Double or consecutive spaces detected. Recommend single word spacing for professional typesetting.',
              spreadIndex: spreadIdx,
              pageNumber,
              elementId: el.id,
            });
          }
          const lines = content.split('\n');
          let ladderCount = 0;
          let hasLadder = false;
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.endsWith('-') || trimmed.endsWith('‐')) {
              ladderCount++;
              if (ladderCount >= 3) {
                hasLadder = true;
                break;
              }
            } else {
              ladderCount = 0;
            }
          }
          if (hasLadder) {
            issues.push({
              id: `preflight-typo-ladder-${spreadIdx}-${el.id}`,
              severity: 'warning',
              code: 'TYPO_HYPHENATION_LADDER',
              message: 'Hyphenation ladder detected: 3 or more consecutive lines end with a hyphen.',
              spreadIndex: spreadIdx,
              pageNumber,
              elementId: el.id,
            });
          }
        }
      }
    }
  });

  const errorElements = new Set(issues.filter(issue => issue.severity === 'error').map(issue => issue.elementId));
  const missingAlt = new Set(issues.filter(issue => issue.code === 'MISSING_ALT_TEXT').map(issue => issue.elementId));
  for (const issue of publicationPreflight(snapshot)) {
    if (issue.code === 'MISSING_ASSET' && errorElements.has(issue.elementId)) continue;
    if (issue.code === 'MISSING_ALT_TEXT' && missingAlt.has(issue.elementId)) continue;
    issues.push(issue);
  }
  return issues;
}
