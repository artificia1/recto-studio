import type { Footnote, ProjectState, StoryContent, TextElement } from '../types';
import { measureStoryText, type StoryLine } from './storyLayout';

export interface NoteContinuation { note: Footnote; rows: string[]; started: boolean }
interface NoteLine { text: string; noteId: string; column: number; x: number; y: number }

export function footnoteGeometry(state: ProjectState, frame: TextElement) {
  const size = state.settings.footnoteSettings?.fontSizePt || 8;
  const family = state.settings.footnoteSettings?.fontFamily || frame.fontFamily;
  const columns = frame.spanColumns ? 1 : Math.max(1, frame.splitColumns || frame.columns || 1);
  const gutter = frame.columnGutterMm ?? 4;
  const columnWidth = Math.max(1, (frame.width - 2 * (frame.paddingMm ?? 2) - gutter * (columns - 1)) / columns);
  return { size, family, columns, gutter, columnWidth, lineHeight: size * 25.4 / 72 * 1.35 };
}

export function wrapFootnote(text: string, width: number, size: number, family: string) {
  const style = { fontFamily: family, fontSizePt: size, letterSpacingPt: 0, color: '#000000' };
  const rows: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const token of paragraph.match(/\s+|\S+/g) || []) {
      if (line && !/^\s+$/.test(token) && measureStoryText(line + token, style) > width) {
        rows.push(line.trimEnd());
        line = '';
      }
      for (const character of token) {
        if (!line && /\s/.test(character)) continue;
        if (line && measureStoryText(line + character, style) > width) {
          rows.push(line.trimEnd());
          line = '';
        }
        if (line || !/\s/.test(character)) line += character;
      }
    }
    rows.push(line);
  }
  return rows;
}

export function composeFootnotes(state: ProjectState, frame: TextElement, content: StoryContent,
  body: StoryLine[], notes: Footnote[], incoming: NoteContinuation[]) {
  const geometry = footnoteGeometry(state, frame);
  const { columns, columnWidth, lineHeight, gutter, size, family } = geometry;
  const bodyLine = frame.fontSizePt * frame.lineHeight * 25.4 / 72;
  const padding = frame.paddingMm ?? 2;
  let anchorBottom = padding + bodyLine;
  const byId = new Map(notes.map(note => [note.id, note]));
  const atColumn = Array.from({ length: columns }, () => [] as NoteContinuation[]);
  let offset = 0;
  for (const paragraph of content.paragraphs) {
    for (const run of paragraph.runs) {
      const note = run.noteId && byId.get(run.noteId);
      if (note) {
        const line = body.find(line => offset >= line.start && offset < line.end);
        if (line) {
          anchorBottom = Math.max(anchorBottom, line.y + line.height);
          atColumn[Math.min(columns - 1, line.column ?? 0)].push({
            note, rows: wrapFootnote(`${note.number}. ${note.text}`, columnWidth, size, family), started: false,
          });
        }
      }
      offset += run.text.length;
    }
    offset++;
  }
  const capacity = Math.max(0, Math.floor((frame.height - padding - anchorBottom - 3) / lineHeight));
  let carry = incoming.map(item => ({ ...item, rows: item.rows.flatMap(row => wrapFootnote(row, columnWidth, size, family)) }));
  const lines: NoteLine[] = [];
  let maxRows = 0;
  let unplacedAnchors = 0;
  for (const [column, anchors] of atColumn.entries()) {
    let row = 0;
    const append = (text: string, noteId: string) => {
      lines.push({ text, noteId, column, x: column * (columnWidth + gutter), y: row++ * lineHeight });
    };
    const next: NoteContinuation[] = [];
    for (const item of carry) {
      const label = item.started ? wrapFootnote(`${item.note.number}. Continued`, columnWidth, size, family) : [];
      const available = capacity - row - anchors.length - label.length;
      if (available < 1) { next.push(item); continue; }
      for (const line of label) append(line, item.note.id);
      for (const line of item.rows.slice(0, available)) append(line, item.note.id);
      if (available < item.rows.length) next.push({ ...item, rows: item.rows.slice(available), started: true });
    }
    anchors.forEach((item, index) => {
      const available = capacity - row - (anchors.length - index - 1);
      if (available < 1) { unplacedAnchors++; next.push(item); return; }
      for (const line of item.rows.slice(0, available)) append(line, item.note.id);
      if (available < item.rows.length) next.push({ ...item, rows: item.rows.slice(available), started: true });
    });
    carry = next;
    maxRows = Math.max(maxRows, row);
  }
  const remaining = carry.reduce((count, item) => count + item.rows.reduce((sum, line) => sum + line.length + 1, 0), 0);
  const requestedRows = unplacedAnchors ? Math.max(1, maxRows) : maxRows;
  return { ...geometry, lines, height: requestedRows ? requestedRows * lineHeight + 3 : 0, carry, remaining, unplacedAnchors };
}
