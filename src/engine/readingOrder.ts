import type { CanvasElement, ProjectState, TextElement } from '../types';

export interface ReadingEntry {
  element: CanvasElement;
  page: number;
  pageId: string;
  rank: number;
}

export const isReadingContent = (element: CanvasElement) =>
  !element.decorative && (element.type === 'text' || element.type === 'image' || element.type === 'table');

/** Use authored positions first, then a stable visual fallback. Paint order is independent. */
export function compareReadingOrder(a: CanvasElement, b: CanvasElement): number {
  return (a.readingOrder ?? Infinity) - (b.readingOrder ?? Infinity) || a.y - b.y || a.x - b.x || a.zIndex - b.zIndex;
}

export function readingEntries(state: ProjectState): ReadingEntry[] {
  const hiddenLayers = new Set(state.layers.filter(layer => !layer.visible || layer.printable === false).map(layer => layer.id));
  const hiddenEditions = new Set((state.conditions || []).filter(condition => !condition.visible).map(condition => condition.id));
  const entries: ReadingEntry[] = [];
  for (const spread of state.spreads) {
    const byPage = new Map<string, CanvasElement[]>();
    for (const element of spread.elements) {
      if (element.pasteboard || element.editorialOnly || element.nonprinting || element.opacity <= 0 ||
        (element.layerId && hiddenLayers.has(element.layerId)) || (element.conditionId && hiddenEditions.has(element.conditionId))) continue;
      const elements = byPage.get(element.pageId);
      if (elements) elements.push(element);
      else byPage.set(element.pageId, [element]);
    }
    for (const page of spread.pages) {
      for (const [rank, element] of (byPage.get(page.id) || []).sort(compareReadingOrder).entries()) {
        entries.push({ element, page: page.pageNumber, pageId: page.id, rank });
      }
    }
  }
  return entries;
}

export function readingLabel(element: CanvasElement): string {
  if (element.name?.trim()) return element.name.trim();
  if (element.type === 'text') return element.text.trim().slice(0, 90) || 'Empty text frame';
  if (element.type === 'image') return element.altText?.trim() || element.caption?.trim() || 'Image';
  if (element.type === 'table') return `Table · ${element.rows} rows × ${element.cols} columns`;
  return element.type === 'shape' ? 'Shape' : 'Vector path';
}

export function readingTextRole(frame: TextElement, styleTag: string | undefined, paragraphIndex: number): string {
  if (frame.generated?.kind === 'caption' || frame.captionForId) return 'Caption';
  if (frame.readingRole && paragraphIndex === 0 && !frame.prevFrameId) return frame.readingRole;
  if (styleTag === 'Title') return 'H1';
  return styleTag && /^(?:H[1-6]|Caption|BlockQuote|LI)$/.test(styleTag) ? styleTag : 'P';
}

export interface ReadingFinding {
  id: string;
  frameId: string;
  page: number;
  message: string;
}

export function reviewReadingOrder(entries: ReadingEntry[], state: ProjectState): ReadingFinding[] {
  const findings: ReadingFinding[] = [];
  const accessible = entries.filter(({ element }) => isReadingContent(element));
  const positions = new Map(accessible.map((entry, index) => [entry.element.id, index]));
  const byId = new Map(entries.map(entry => [entry.element.id, entry]));
  const styles = new Map(state.paragraphStyles.map(style => [style.id, style.pdfTag]));
  const closedArticles = new Set<string>();
  let article: string | undefined;
  let heading = 0;
  const add = (entry: ReadingEntry, code: string, message: string) =>
    findings.push({ id: `${entry.element.id}:${code}`, frameId: entry.element.id, page: entry.page, message });
  for (const [index, entry] of accessible.entries()) {
    const { element } = entry;
    if (element.readingArticle !== article) {
      if (article) closedArticles.add(article);
      article = element.readingArticle;
      if (article && closedArticles.has(article)) {
        add(entry, 'article', 'This article resumes after unrelated content. Place its items consecutively for the same order in fixed-layout EPUB.');
      }
    }
    if (element.type === 'image' && !element.altText?.trim()) add(entry, 'alt', 'Describe this image or mark it decorative.');
    if (element.type === 'table' && !element.prevFrameId) {
      if (!element.headerRowCount && element.rows > 1) add(entry, 'table-header', 'Review the header rows for this table.');
      if (element.rowSizing !== 'content') add(entry, 'table-sizing', 'Use content-sized rows for accessible PDF and fixed-layout EPUB.');
    }
    if (element.type === 'table' && element.prevFrameId && positions.get(element.prevFrameId) !== index - 1) {
      add(entry, 'table-thread', 'This table continuation is separated by unrelated content. Reflowable EPUB reads the whole table at its first frame.');
    }
    if (element.type !== 'text') continue;
    if (element.captionForId) {
      const target = byId.get(element.captionForId);
      if (!target || !isReadingContent(target.element) || (target.element.type !== 'image' && target.element.type !== 'table')) {
        add(entry, 'caption-target', 'This caption has no meaningful figure or table in the publication.');
      }
      else if (positions.get(element.captionForId) !== index - 1) add(entry, 'caption-order', 'Place this caption immediately after its figure or table.');
      else if (target.pageId !== entry.pageId) add(entry, 'caption-page', 'Keep this caption on the same page as its figure or table so EPUB can link them.');
    }
    if (element.prevFrameId && (positions.get(element.prevFrameId) ?? -1) !== index - 1) {
      add(entry, 'thread', 'This linked story is interrupted in reading order. Reflowable EPUB reads the complete story at its first frame.');
    }
    if (element.prevFrameId) continue;
    const paragraphs = element.storyContent?.paragraphs || element.textContent?.paragraphs;
    const roles = (paragraphs || [{ styleId: element.paragraphStyleId }]).map((paragraph, paragraphIndex) =>
      readingTextRole(element, styles.get(paragraph.styleId || element.paragraphStyleId || ''), paragraphIndex));
    for (const role of roles) {
      if (!/^H[1-6]$/.test(role)) continue;
      const next = Number(role[1]);
      if (next > heading + 1 && !findings.some(finding => finding.id === `${element.id}:heading`)) {
        add(entry, 'heading', 'This heading skips a level in reading order.');
      }
      heading = next;
    }
  }
  return findings;
}

/** Divide the physical reading sequence into consecutive article fragments. */
export function readingSections(elements: CanvasElement[]) {
  const sections: { article?: string; elements: CanvasElement[] }[] = [];
  for (const element of elements) {
    const last = sections.at(-1);
    if (last && (last.article === element.readingArticle || !isReadingContent(element))) last.elements.push(element);
    else sections.push({ article: element.readingArticle, elements: [element] });
  }
  return sections;
}

export function readingCaptions(elements: CanvasElement[]) {
  const captions = new Map<string, string>();
  const content = elements.filter(isReadingContent);
  for (const [index, frame] of content.entries()) {
    const previous = content[index - 1];
    if (frame.type === 'text' && previous && frame.captionForId === previous.id &&
      (previous.type === 'image' || previous.type === 'table')) captions.set(previous.id, frame.id);
  }
  return captions;
}
