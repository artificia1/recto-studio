import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, PDFRef } from 'pdf-lib';
import type { jsPDF } from 'jspdf';
import type { CanvasElement, ProjectState } from '../types';
import { getSafeSpotName, type FreeToneSpotColor } from '../engine/spotColors';
import { storyText } from '../engine/storyContent';
import { publicationHeadings } from '../engine/publicationReferences';
import { savePublicationFile } from '../desktop';
import type { PdfStructureGroup } from './pdfSemantics';
import { installPdfFonts } from './pdfFontResources';

export interface PdfContentTag { page: number; mcid: number; role: string; text?: string; alt?: string; order: number; parentId?: string }
export function elementPdfTag(state: ProjectState, element: CanvasElement, page: number, mcid: number): PdfContentTag | undefined {
  if (element.type === 'text') {
    const style = state.paragraphStyles.find(style => style.id === element.paragraphStyleId);
    const role = /^H[1-6]$/.test(style?.pdfTag || '') ? style!.pdfTag! : 'P';
    const text = element.textContent ? storyText(element.textContent) : element.text;
    return { page, mcid, role, text, order: element.readingOrder ?? element.y * 1000 + element.x };
  }
  if (element.type === 'image' && element.altText?.trim()) return { page, mcid, role: 'Figure', alt: element.altText, order: element.readingOrder ?? element.y * 1000 + element.x };
  return undefined;
}

function attachHeadingBookmarks(pdf: PDFDocument, state: ProjectState, pageIds: string[]) {
  const pages = new Map(pdf.getPages().map((page, i) => [pageIds[i], page.ref]));
  const headings = publicationHeadings(state).filter(heading => pages.has(heading.pageId));
  if (!headings.length) return;
  const { context } = pdf;
  const root = context.obj({ Type: 'Outlines' });
  type Item = { level: number; dict: PDFDict; ref: PDFRef; children: Item[] };
  const tree: Item = { level: 0, dict: root, ref: context.register(root), children: [] };
  const branch = [tree];
  for (const heading of headings) {
    const destination = pages.get(heading.pageId)!;
    while (branch.at(-1)!.level >= heading.level) branch.pop();
    const parent = branch.at(-1)!;
    const dict = context.obj({ Title: PDFHexString.fromText(heading.title), Parent: parent.ref, Dest: [destination, PDFName.of('Fit')] });
    const item: Item = { level: heading.level, dict, ref: context.register(dict), children: [] };
    parent.children.push(item);
    branch.push(item);
  }
  const link = (item: Item): number => {
    if (!item.children.length) return 0;
    const count = item.children.reduce((total, child, index, siblings) => {
      if (index) child.dict.set(PDFName.of('Prev'), siblings[index - 1].ref);
      if (index + 1 < siblings.length) child.dict.set(PDFName.of('Next'), siblings[index + 1].ref);
      return total + 1 + link(child);
    }, 0);
    item.dict.set(PDFName.of('First'), item.children[0].ref);
    item.dict.set(PDFName.of('Last'), item.children.at(-1)!.ref);
    item.dict.set(PDFName.of('Count'), PDFNumber.of(count));
    return count;
  };
  link(tree);
  pdf.catalog.set(PDFName.of('Outlines'), tree.ref);
}

/** Repair resources and attach a real structure/parent tree without claiming PDF/UA conformance. */
export async function finishPdf(doc: jsPDF, state: ProjectState, spots: FreeToneSpotColor[], tags?: PdfContentTag[], compress = true, groups?: PdfStructureGroup[], pageIds?: string[]) {
  const pdf = await PDFDocument.load(doc.output('arraybuffer'), { updateMetadata: false });
  installPdfFonts(doc, pdf);
  const { context } = pdf;
  for (const page of pdf.getPages()) {
    const resources = page.node.Resources() || context.obj({});
    page.node.set(PDFName.of('Resources'), resources);
    let colors = resources.lookupMaybe(PDFName.of('ColorSpace'), PDFDict);
    if (!colors) { colors = context.obj({}); resources.set(PDFName.of('ColorSpace'), colors); }
    for (const spot of spots) {
      const name = getSafeSpotName(spot.name);
      const fn = context.obj({ FunctionType: 2, Domain: [0, 1], Range: [0, 1, 0, 1, 0, 1, 0, 1], C0: [0, 0, 0, 0], C1: spot.cmyk, N: 1 });
      colors.set(PDFName.of(`CS_${name}`), context.obj([PDFName.of('Separation'), PDFName.of(name), PDFName.of('DeviceCMYK'), fn]));
    }
  }
  if (tags) {
    const root = context.obj({ Type: 'StructTreeRoot' }), rootRef = context.register(root);
    const document = context.obj({ Type: 'StructElem', S: 'Document', P: rootRef }), documentRef = context.register(document);
    const children: PDFRef[] = [], nums = PDFArray.withContext(context);
    const groupRefs = new Map<string, PDFRef>(), groupDicts = new Map<string, PDFDict>(), groupChildren = new Map<string, { ref: PDFRef; order: number }[]>();
    for (const group of groups || []) {
      const dict = context.obj({ Type: 'StructElem', S: group.role, ID: PDFHexString.fromText(group.id) });
      if (group.attributes) dict.set(PDFName.of('A'), context.obj(group.attributes));
      groupDicts.set(group.id, dict); groupRefs.set(group.id, context.register(dict)); groupChildren.set(group.id, []);
    }
    const orderedRoots: { ref: PDFRef; order: number }[] = [];
    for (const group of groups || []) {
      const parent = group.parentId ? groupRefs.get(group.parentId) : documentRef;
      if (!parent) throw new Error('Missing PDF structure parent.');
      groupDicts.get(group.id)!.set(PDFName.of('P'), parent);
      (group.parentId ? groupChildren.get(group.parentId)! : orderedRoots).push({ ref: groupRefs.get(group.id)!, order: group.order });
    }
    for (const [index, page] of pdf.getPages().entries()) {
      const records = tags.filter(tag => tag.page === index + 1);
      page.node.set(PDFName.of('StructParents'), PDFNumber.of(index));
      page.node.set(PDFName.of('Tabs'), PDFName.of('S'));
      const parents = context.obj(records.map(() => null));
      for (const tag of [...records].sort((a, b) => a.order - b.order || a.mcid - b.mcid)) {
        const item = context.obj({ Type: 'StructElem', S: tag.role, P: tag.parentId ? groupRefs.get(tag.parentId)! : documentRef, Pg: page.ref, K: tag.mcid });
        if (tag.alt) item.set(PDFName.of('Alt'), PDFHexString.fromText(tag.alt));
        const ref = context.register(item); parents.set(tag.mcid, ref);
        if (groups) (tag.parentId ? groupChildren.get(tag.parentId)! : orderedRoots).push({ ref, order: tag.order }); else children.push(ref);
      }
      nums.push(PDFNumber.of(index)); nums.push(parents);
    }
    if (groups) {
      for (const group of groups) groupDicts.get(group.id)!.set(PDFName.of('K'), context.obj(groupChildren.get(group.id)!.sort((a, b) => a.order - b.order).map(child => child.ref)));
      children.push(...orderedRoots.sort((a, b) => a.order - b.order).map(child => child.ref));
      root.set(PDFName.of('IDTree'), context.register(context.obj({ Names: [...groupRefs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).flatMap(([id, ref]) => [PDFHexString.fromText(id), ref]) })));
    }
    document.set(PDFName.of('K'), context.obj(children));
    root.set(PDFName.of('K'), context.obj([documentRef]));
    root.set(PDFName.of('ParentTree'), context.register(context.obj({ Nums: nums })));
    root.set(PDFName.of('ParentTreeNextKey'), PDFNumber.of(pdf.getPageCount()));
    pdf.catalog.set(PDFName.of('StructTreeRoot'), rootRef);
    pdf.catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }));
    pdf.catalog.set(PDFName.of('Lang'), PDFString.of(state.settings.language || 'en-US'));
    pdf.catalog.set(PDFName.of('ViewerPreferences'), context.obj({ DisplayDocTitle: true }));
    if (pageIds) attachHeadingBookmarks(pdf, state, pageIds);
  }
  const bytes = await pdf.save({ useObjectStreams: compress, addDefaultPage: false, updateFieldAppearances: false });
  bindFinalizedPdf(doc, bytes);
  return bytes;
}

export function bindFinalizedPdf(doc: jsPDF, bytes: Uint8Array) {
  // Exported documents are complete snapshots. Preserve jsPDF's public output formats
  // while ensuring every consumer (downloads, packages and CLI) receives fixed bytes.
  const blob = () => new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  const binary = () => {
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    return chunks.join('');
  };
  doc.save = ((filename = 'document.pdf', options?: { returnPromise?: boolean }) => {
    const saved = savePublicationFile(filename, new Uint8Array(bytes), 'application/pdf');
    if (options?.returnPromise) return saved.then(() => doc);
    void saved.catch(error => console.error('PDF could not be saved:', error));
    return doc;
  }) as jsPDF['save'];
  doc.output = ((format?: string) => {
    if (!format) return binary();
    if (format === 'arraybuffer') return new Uint8Array(bytes).buffer;
    if (format === 'blob') return blob();
    if (format === 'bloburi' || format === 'bloburl') return URL.createObjectURL(blob());
    if (format === 'datauristring' || format === 'dataurlstring') return `data:application/pdf;base64,${btoa(binary())}`;
    throw new Error(`Output format “${format}” is unavailable for finalized PDFs. Use arraybuffer or blob.`);
  }) as jsPDF['output'];
}
