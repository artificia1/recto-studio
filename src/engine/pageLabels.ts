import type { Page } from '../types';

export interface PublicationSection {
  title: string;
  startNumber: number;
  numbering: 'arabic' | 'roman-lower' | 'roman-upper';
  prefix: string;
}

export function masterTargetPage(masterPages: Page[], pages: Page[], sourceId: string): Page | undefined {
  const source = masterPages.find(page => page.id === sourceId);
  if (!source) return undefined;
  const matching = pages.find(page => page.side === source.side);
  if (matching) return matching;
  if (pages.length === 1) {
    const preferred = masterPages.find(page => page.side === pages[0].side) || masterPages.find(page => page.side === 'right') || masterPages[0];
    return source.id === preferred?.id ? pages[0] : undefined;
  }
  return undefined;
}

function roman(value: number): string {
  const digits: [number, string][] = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let result = '';
  for (const [number, symbol] of digits) while (value >= number) { result += symbol; value -= number; }
  return result;
}

function printedLabel(page: Page, section: PublicationSection | undefined, offset: number) {
  if (!section) return { label: String(page.pageNumber), sectionTitle: '' };
  const number = section.startNumber + offset;
  let label = String(number);
  if (section.numbering !== 'arabic' && number <= 3999) {
    label = roman(number);
    if (section.numbering === 'roman-lower') label = label.toLowerCase();
  }
  return { label: section.prefix + label, sectionTitle: section.title };
}

export function indexPageLabels(pages: Page[]) {
  const byId = new Map<string, ReturnType<typeof printedLabel> & { index: number; pageNumber: number; sectionId: string }>();
  const byNumber = new Map<number, Page>();
  let section: PublicationSection | undefined;
  let sectionIndex = 0, sectionId = 'document';
  for (const [index, page] of pages.entries()) {
    if (page.section) { section = page.section; sectionIndex = index; sectionId = page.id; }
    if (!byId.has(page.id)) byId.set(page.id, { ...printedLabel(page, section, index - sectionIndex), index, pageNumber: page.pageNumber, sectionId });
    if (!byNumber.has(page.pageNumber)) byNumber.set(page.pageNumber, page);
  }
  return { byId, byNumber };
}

/** Physical numbers remain unique; printed labels may restart at any section. */
export function pageLabel(pages: Page[], pageId: string): { label: string; sectionTitle: string } {
  let current: PublicationSection | undefined;
  let offset = 0;
  for (const page of pages) {
    if (page.section) { current = page.section; offset = 0; }
    if (page.id === pageId) return printedLabel(page, current, offset);
    offset++;
  }
  return { label: '', sectionTitle: '' };
}
