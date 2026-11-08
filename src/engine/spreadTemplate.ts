import type { DocumentSettings, Spread } from '../types';

/** Copy all identities together so templates can be inserted repeatedly without collisions. */
export function prepareSpreadTemplate(source: Spread, settings: DocumentSettings, size = { width: 210, height: 297 }): Spread {
  if (!source.pages.length || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) throw new Error('This template has invalid page dimensions.');
  const spread = structuredClone(source);
  const pages = new Map(spread.pages.map(page => [page.id, `page-${crypto.randomUUID()}`]));
  const elements = new Map(spread.elements.map(element => [element.id, `element-${crypto.randomUUID()}`]));
  if (pages.size !== spread.pages.length || elements.size !== spread.elements.length) throw new Error('This template contains duplicate identifiers.');
  const sx = settings.widthMm / size.width, sy = settings.heightMm / size.height;
  const scale = Math.min(sx, sy);
  spread.id = `spread-${crypto.randomUUID()}`;
  delete spread.masterSpreadId; delete spread.detachedMasterElementIds;
  spread.elements = spread.elements.map(element => {
    // Older bundled templates used separate timestamps for a page and its elements.
    const suffix = /-(\d+)$/.exec(element.pageId);
    const page = pages.get(element.pageId) || (suffix ? pages.get(spread.pages[Number(suffix[1]) - 1]?.id) : undefined);
    if (!page) throw new Error('A template element refers to a missing page.');
    element.id = elements.get(element.id)!; element.pageId = page;
    delete element.layerId;
    element.x *= sx; element.y *= sy; element.width *= sx; element.height *= sy;
    if (element.type === 'text' || element.type === 'table') {
      if (element.prevFrameId) element.prevFrameId = elements.get(element.prevFrameId);
      if (element.nextFrameId) element.nextFrameId = elements.get(element.nextFrameId);
    }
    if (element.type === 'text') {
      element.fontSizePt *= scale; element.paddingMm *= scale; element.columnGutterMm *= scale;
      element.letterSpacingPt *= scale;
      for (const content of [element.storyContent, element.textContent]) if (content) for (const paragraph of content.paragraphs) {
        delete paragraph.id;
        for (const run of paragraph.runs) if (run.noteId || run.reference || run.indexId) throw new Error('Template manuscripts cannot contain document-specific reference markers.');
      }
    }
    if (element.type === 'path') {
      // Path nodes use coordinates local to their frame.
      for (const node of element.nodes) {
        node.x *= sx; node.y *= sy;
        if (node.handleIn) { node.handleIn.x *= sx; node.handleIn.y *= sy; }
        if (node.handleOut) { node.handleOut.x *= sx; node.handleOut.y *= sy; }
      }
    }
    return element;
  });
  spread.pages.forEach(page => { page.id = pages.get(page.id)!; delete page.section; });
  return spread;
}
