import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, PDFRef } from 'pdf-lib';
import type { jsPDF } from 'jspdf';
import type { CanvasElement, ProjectState } from '../types';
import { getSafeSpotName, type FreeToneSpotColor } from '../engine/spotColors';
import { storyText } from '../engine/storyContent';

export interface PdfContentTag { page: number; mcid: number; role: string; text?: string; alt?: string; order: number }
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

/** Repair resources and attach a real structure/parent tree without claiming PDF/UA conformance. */
export async function finishPdf(doc: jsPDF, state: ProjectState, spots: FreeToneSpotColor[], tags?: PdfContentTag[], compress = true) {
  const pdf = await PDFDocument.load(doc.output('arraybuffer'), { updateMetadata: false });
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
    for (const [index, page] of pdf.getPages().entries()) {
      const records = tags.filter(tag => tag.page === index + 1);
      page.node.set(PDFName.of('StructParents'), PDFNumber.of(index));
      page.node.set(PDFName.of('Tabs'), PDFName.of('S'));
      const parents = context.obj(records.map(() => null));
      for (const tag of [...records].sort((a, b) => a.order - b.order || a.mcid - b.mcid)) {
        const item = context.obj({ Type: 'StructElem', S: tag.role, P: documentRef, Pg: page.ref, K: tag.mcid });
        if (tag.alt) item.set(PDFName.of('Alt'), PDFHexString.fromText(tag.alt));
        const ref = context.register(item); parents.set(tag.mcid, ref); children.push(ref);
      }
      nums.push(PDFNumber.of(index)); nums.push(parents);
    }
    document.set(PDFName.of('K'), context.obj(children));
    root.set(PDFName.of('K'), context.obj([documentRef]));
    root.set(PDFName.of('ParentTree'), context.register(context.obj({ Nums: nums })));
    root.set(PDFName.of('ParentTreeNextKey'), PDFNumber.of(pdf.getPageCount()));
    pdf.catalog.set(PDFName.of('StructTreeRoot'), rootRef);
    pdf.catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }));
    pdf.catalog.set(PDFName.of('Lang'), PDFString.of(state.settings.language || 'en-US'));
    pdf.catalog.set(PDFName.of('ViewerPreferences'), context.obj({ DisplayDocTitle: true }));
  }
  const bytes = await pdf.save({ useObjectStreams: compress, addDefaultPage: false, updateFieldAppearances: false });
  // Exported documents are complete snapshots. Preserve jsPDF's public output formats
  // while ensuring every consumer (downloads, packages and CLI) receives fixed bytes.
  const blob = () => new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  const binary = () => {
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    return chunks.join('');
  };
  doc.output = ((format?: string) => {
    if (!format) return binary();
    if (format === 'arraybuffer') return new Uint8Array(bytes).buffer;
    if (format === 'blob') return blob();
    if (format === 'bloburi' || format === 'bloburl') return URL.createObjectURL(blob());
    if (format === 'datauristring' || format === 'dataurlstring') return `data:application/pdf;base64,${btoa(binary())}`;
    throw new Error(`Output format “${format}” is unavailable for finalized PDFs. Use arraybuffer or blob.`);
  }) as jsPDF['output'];
  return bytes;
}
