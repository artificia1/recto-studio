import type { Font } from 'fontkit';
import type { jsPDF } from 'jspdf';

/** Use the actual font's shaping and outlines for formats jsPDF cannot embed. */
export function fontTextWidth(font: Font, text: string, sizePt: number): number {
  return font.layout(text).advanceWidth * sizePt * 25.4 / 72 / font.unitsPerEm;
}

export function wrapFontText(font: Font, text: string, sizePt: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && fontTextWidth(font, candidate, sizePt) > width) {
        lines.push(line);
        line = '';
      }
      // Split oversized words by Unicode code point, never by UTF-16 surrogate.
      for (const character of (line ? ` ${word}` : word)) {
        if (line && fontTextWidth(font, line + character, sizePt) > width) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function drawFontText(doc: jsPDF, font: Font, text: string, x: number, y: number, sizePt: number) {
  const scale = sizePt * 25.4 / 72 / font.unitsPerEm;
  const run = font.layout(text);
  let advance = 0;
  run.glyphs.forEach((glyph, index) => {
    const position = run.positions[index];
    const originX = x + (advance + position.xOffset) * scale;
    const originY = y - position.yOffset * scale;
    let lastX = 0;
    let lastY = 0;
    const operations: { op: string; c: number[] }[] = [];
    for (const { command, args } of glyph.path.commands) {
      const point = (a: number, b: number) => [originX + a * scale, originY - b * scale];
      if (command === 'moveTo' || command === 'lineTo') {
        operations.push({ op: command === 'moveTo' ? 'm' : 'l', c: point(args[0], args[1]) });
      } else if (command === 'bezierCurveTo') {
        operations.push({ op: 'c', c: [...point(args[0], args[1]), ...point(args[2], args[3]), ...point(args[4], args[5])] });
      } else if (command === 'quadraticCurveTo') {
        operations.push({ op: 'c', c: [
          ...point(lastX + 2 / 3 * (args[0] - lastX), lastY + 2 / 3 * (args[1] - lastY)),
          ...point(args[2] + 2 / 3 * (args[0] - args[2]), args[3] + 2 / 3 * (args[1] - args[3])),
          ...point(args[2], args[3]),
        ] });
      } else operations.push({ op: 'h', c: [] });
      if (args.length) [lastX, lastY] = args.slice(-2);
    }
    if (operations.length) doc.path(operations).fill();
    advance += position.xAdvance;
  });
}
