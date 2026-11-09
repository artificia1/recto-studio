import type { jsPDF } from 'jspdf';
import type { CanvasElement, ProjectState, StoryContent, TextElement, TableElement } from '../types';
import { resolveParagraphStyle } from '../engine/storyLayout';
import { fontManager } from '../fontManager';
import { pdfFontName } from './pdfFonts';
import type { PdfContentTag } from './pdfStructure';
import { tableGrid } from '../engine/tableCells';

export interface PdfStructureGroup { id: string; role: string; parentId?: string; order: number; attributes?: Record<string, string | number> }
export interface TablePdfSemantics { beginCell(row: number, column: number, header: boolean, rowSpan: number, colSpan: number, text: string): () => void }
const hex = (text: string) => `FEFF${Array.from({ length: text.length }, (_, i) => text.charCodeAt(i).toString(16).padStart(4, '0')).join('')}`;

export class PdfSemantics {
  readonly tags: PdfContentTag[] = [];
  readonly groups: PdfStructureGroup[] = [];
  private ids = new Set<string>();
  private repeatedHeaders = new Set<string>();
  private counts = new Map<number, number>();
  private artifacts = new Set<string>();
  constructor(private doc: jsPDF, private state: ProjectState) {}
  furniture(ids: string[]) { ids.forEach(id => this.artifacts.add(id)); }
  validate() {
    let level = 0;
    for (const group of [...this.groups].sort((a, b) => a.order - b.order)) {
      const heading = /^H([1-6])$/.exec(group.role);
      if (!heading) continue;
      const next = Number(heading[1]);
      if (next > level + 1) throw new Error('Accessible PDF headings must start at H1 and must not skip heading levels in reading order.');
      level = next;
    }
  }
  private write(value: string) { (this.doc.internal as unknown as { write(value: string): void }).write(value); }
  private order(element: CanvasElement) { return (this.doc.getNumberOfPages() - 1) * 1e9 + (element.readingOrder ?? element.y * 1000 + element.x); }
  private group(group: PdfStructureGroup) {
    if (!this.ids.has(group.id)) {
      this.ids.add(group.id); this.groups.push(group);
    }
    return group.id;
  }
  assertFont(family: string, text: string) {
    if (!text.trim()) return;
    const font = fontManager.getFont(family);
    if (!font || !pdfFontName(this.doc, family)) throw new Error(`Accessible PDF requires an embedded font for “${family}”. Import an embeddable TrueType or OpenType face and apply it to this content.`);
    if (font.layout(text.replace(/[\r\n\t]/g, ' ')).glyphs.some(glyph => glyph.id === 0)) throw new Error(`The font “${family}” is missing a glyph used by this publication. Choose a font covering all characters.`);
  }
  private mark(role: string, text: string | undefined, parentId?: string, alt?: string, order = 0) {
    const page = this.doc.getNumberOfPages(), mcid = this.counts.get(page) || 0; this.counts.set(page, mcid + 1);
    this.tags.push({ page, mcid, role, text, parentId, alt, order });
    this.write(`/${role} << /MCID ${mcid}${text === undefined ? '' : ` /ActualText <${hex(text)}>`} >> BDC`);
    return () => this.write('EMC');
  }
  image(element: CanvasElement) {
    if (element.type !== 'image' || element.decorative || this.artifacts.has(element.id)) { this.write('/Artifact BMC'); return; }
    if (!element.altText?.trim()) throw new Error('Describe every meaningful image or mark it as decorative before exporting accessible PDF.');
    this.mark('Figure', undefined, undefined, element.altText, this.order(element));
  }
  line(frame: TextElement, content: StoryContent, start: number) {
    if (this.artifacts.has(frame.id)) return { parts: (text: string) => [{ text, parent: '' }], begin: (_text: string, _parent: string) => () => {} };
    let offset = 0, index = 0;
    for (; index + 1 < content.paragraphs.length; index++) {
      const length = content.paragraphs[index].runs.reduce((sum, run) => sum + run.text.length, 0);
      if (start <= offset + length) break; offset += length + 1;
    }
    const paragraph = content.paragraphs[index], style = resolveParagraphStyle(paragraph, this.state.paragraphStyles);
    const text = paragraph.runs.map(run => run.text).join('');
    const id = `paragraph:${paragraph.id || `${frame.id}:${index}`}`, order = this.order(frame) + index / 10000;
    let bodyId: string, labelId: string | undefined, labelRemaining = 0;
    if (style.pdfTag === 'LI') {
      let head = frame;
      const seen = new Set<string>(), frames = this.state.spreads.flatMap(spread => spread.elements);
      while (head.prevFrameId && !seen.has(head.id)) {
        seen.add(head.id);
        const previous = frames.find(element => element.id === head.prevFrameId && element.type === 'text');
        if (!previous || previous.type !== 'text') break;
        head = previous;
      }
      const paragraphs = head.storyContent?.paragraphs || content.paragraphs;
      const originalIndex = paragraph.id ? paragraphs.findIndex(item => item.id === paragraph.id) : index;
      let first = Math.max(0, originalIndex);
      while (first > 0 && resolveParagraphStyle(paragraphs[first - 1], this.state.paragraphStyles).pdfTag === 'LI') first--;
      const list = this.group({ id: `list:${head.id}:${paragraphs[first].id || first}`, role: 'L', order });
      const item = this.group({ id: `${id}:item`, role: 'LI', parentId: list, order: index });
      const label = /^(?:[•◦▪‣–-]|\d+[.)]|[A-Za-z][.)])\s+/u.exec(text)?.[0] || '';
      if (label) labelId = this.group({ id: `${id}:label`, role: 'Lbl', parentId: item, order: 0 });
      bodyId = this.group({ id, role: 'LBody', parentId: item, order: 1 });
      labelRemaining = Math.max(0, label.length - (start - offset));
    } else {
      const role = frame.generated?.kind === 'caption' ? 'Caption' : /^H[1-6]$/.test(style.pdfTag || '') ? style.pdfTag! : style.pdfTag === 'Title' ? 'H1' : ['Caption', 'BlockQuote'].includes(style.pdfTag || '') ? style.pdfTag! : 'P';
      bodyId = this.group({ id, role, order });
    }
    return {
      parts: (value: string) => {
        const count = Math.min(labelRemaining, value.length); labelRemaining -= count;
        return [{ text: value.slice(0, count), parent: labelId }, { text: value.slice(count), parent: bodyId }].filter(part => part.text && part.parent).map(part => ({ text: part.text, parent: part.parent! }));
      },
      begin: (text: string, parent: string) => { this.write('EMC'); const end = this.mark('Span', text, parent); return () => { end(); this.write('/Artifact BMC'); }; },
    };
  }
  note(frame: TextElement, noteId: string, text: string) {
    const parent = this.group({ id: `note:${noteId}`, role: 'Note', order: this.order(frame) + 0.9 });
    this.write('EMC'); const end = this.mark('Span', text, parent);
    return () => { end(); this.write('/Artifact BMC'); };
  }
  table(element: TableElement, source: TableElement): TablePdfSemantics {
    if (source.rowSizing !== 'content') throw new Error('Choose content-sized table rows before exporting accessible PDF so every cell is fitted and tagged.');
    tableGrid(source.cells, source.headerRowCount, source.footerRowCount || 0);
    if (this.artifacts.has(element.id)) return { beginCell: (_row, _column, _header, _rowSpan, _colSpan, text) => { this.assertFont(element.fontFamily, text); return () => {}; } };
    const parent = this.group({ id: `table:${source.id}`, role: 'Table', order: this.order(element) });
    for (let row = 0; row < source.rows; row++) this.group({ id: `${parent}:row:${row}`, role: 'TR', parentId: parent, order: row });
    return { beginCell: (row, column, header, rowSpan, colSpan, text) => {
      this.assertFont(element.fontFamily, text);
      const id = `${parent}:${row}:${column}`;
      const repeat = header || row >= source.rows - (source.footerRowCount || 0);
      if (repeat && this.repeatedHeaders.has(id)) return () => {};
      if (repeat) this.repeatedHeaders.add(id);
      const tr = this.group({ id: `${parent}:row:${row}`, role: 'TR', parentId: parent, order: row });
      const cell = this.group({ id, role: header ? 'TH' : 'TD', parentId: tr, order: column,
        attributes: { O: 'Table', RowSpan: rowSpan, ColSpan: colSpan, ...(header ? { Scope: 'Column' } : {}) } });
      this.write('EMC'); const end = this.mark('Span', text, cell);
      return () => { end(); this.write('/Artifact BMC'); };
    } };
  }
}
