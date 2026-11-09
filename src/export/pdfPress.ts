import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString } from 'pdf-lib';
import type { ProjectState } from '../types';
import { inspectIccHeader, profileBytes } from '../engine/iccProfiles';

export type PressStandard = 'pdfx1a-2003' | 'pdfx4';
export const escapeXml = (value: string) => value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!));

export function requirePdfFonts(pdf: PDFDocument, unicode = false) {
  for (const page of pdf.getPages()) {
    const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
    for (const [, reference] of fonts?.entries() || []) {
      const font = pdf.context.lookup(reference, PDFDict), descendants = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
      const actual = descendants?.lookup(0, PDFDict) || font;
      if (!unicode && actual.get(PDFName.of('Subtype'))?.toString() === '/Type3') continue;
      const descriptor = actual.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
      if (!descriptor || !['FontFile', 'FontFile2', 'FontFile3'].some(key => descriptor.has(PDFName.of(key))) || (unicode && !font.has(PDFName.of('ToUnicode')))) {
        throw new Error(`${unicode ? 'Accessible' : 'Press'} PDF requires embedded fonts${unicode ? ' with Unicode mappings' : ''}. Import embeddable TrueType or OpenType fonts for all text, including running headers, notes and print slugs.`);
      }
    }
  }
}

// Only inspect operators, never bytes inside literal strings, hex strings or comments.
function contentOperators(bytes: Uint8Array) {
  const text = new TextDecoder('latin1').decode(bytes); let output = '', depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (depth) { if (c === '\\') i++; else if (c === '(') depth++; else if (c === ')') depth--; continue; }
    if (c === '(') { depth = 1; output += ' '; continue; }
    if (c === '%') { while (i < text.length && !/[\r\n]/.test(text[i])) i++; output += '\n'; continue; }
    if (c === '<' && text[i + 1] !== '<') { while (i < text.length && text[i] !== '>') i++; output += ' '; continue; }
    if (c === '<' && text[i + 1] === '<') { output += '<<'; i++; continue; }
    output += c;
  }
  return output;
}

/** Conservative checks for Recto-generated process/spot print PDFs; not an ISO validator. */
export async function preparePressPdf(bytes: Uint8Array, state: ProjectState, standard: PressStandard) {
  const settings = state.settings.colorManagement;
  if (!settings?.convertPdf) throw new Error('PDF/X preparation requires a CMYK output ICC profile and enabled PDF conversion.');
  const header = inspectIccHeader(profileBytes(settings.outputProfile));
  if (standard === 'pdfx1a-2003' && header.version !== 2) throw new Error('PDF/X-1a:2003 requires an ICC v2 output profile. Use PDF/X-4 for a v4 profile.');
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  requirePdfFonts(pdf);
  if (!state.settings.title.trim()) throw new Error('Set a document title before preparing PDF/X.');
  const intents = pdf.catalog.lookupMaybe(PDFName.of('OutputIntents'), PDFArray);
  if (intents?.size() !== 1 || !intents.lookup(0, PDFDict).has(PDFName.of('DestOutputProfile'))) throw new Error('The PDF must embed exactly one output ICC profile.');
  const boxes = (values: PDFArray) => values.asArray().map(value => (value as PDFNumber).asNumber());
  const encloses = (outer: number[], inner: number[]) => outer.every(Number.isFinite) && inner.every(Number.isFinite) && inner[2] > inner[0] && inner[3] > inner[1] && inner[0] >= outer[0] - 0.01 && inner[1] >= outer[1] - 0.01 && inner[2] <= outer[2] + 0.01 && inner[3] <= outer[3] + 0.01;
  for (const page of pdf.getPages()) {
    if (page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size()) throw new Error('Remove interactive annotations before PDF/X preparation.');
    const trim = page.node.lookupMaybe(PDFName.of('TrimBox'), PDFArray), bleed = page.node.lookupMaybe(PDFName.of('BleedBox'), PDFArray);
    if (!trim || !bleed || !encloses(boxes(page.node.MediaBox()), boxes(bleed)) || !encloses(boxes(bleed), boxes(trim))) throw new Error('PDF/X preparation requires nested MediaBox, BleedBox and TrimBox rectangles.');
    page.node.delete(PDFName.of('ArtBox'));
    if (standard === 'pdfx4') page.node.set(PDFName.of('Group'), pdf.context.obj({ Type: 'Group', S: 'Transparency', CS: 'DeviceCMYK', I: true }));
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map(value => pdf.context.lookup(value)) : [contents];
    for (const stream of streams) if (stream instanceof PDFRawStream && /(?:^|\s)(?:rg|RG)(?=\s|$)/m.test(contentOperators(decodePDFRawStream(stream).decode()))) throw new Error('Unmanaged RGB operators remain in this PDF. Convert SVG/equation artwork to an sRGB raster image before preparing a process-colour PDF/X.');
  }
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFRawStream ? object.dict : object instanceof PDFDict ? object : undefined;
    if (!dict) continue;
    if (['JavaScript', 'EmbeddedFile', 'Movie', 'Sound', '3D', 'PS'].includes(dict.get(PDFName.of('S'))?.toString().slice(1) || '') || dict.has(PDFName.of('OPI'))) throw new Error('This PDF contains unsupported print content.');
    if (dict.get(PDFName.of('ColorSpace'))?.toString() === '/DeviceRGB') throw new Error('An RGB image remains in this PDF. Enable ICC conversion for all raster assets.');
    if (standard === 'pdfx1a-2003' && (['SMask', 'SMaskInData', 'BM'].some(key => dict.has(PDFName.of(key))) || ['ca', 'CA'].some(key => (dict.lookupMaybe(PDFName.of(key), PDFNumber)?.asNumber() ?? 1) !== 1))) throw new Error('Live transparency remains. Use the flattened PDF/X-1a export path.');
  }
  const version = standard === 'pdfx1a-2003' ? 'PDF/X-1a:2003' : 'PDF/X-4';
  pdf.setTitle(state.settings.title); pdf.setAuthor(state.settings.author || ''); pdf.setProducer('Recto Studio');
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info!, PDFDict), date = new Date();
  pdf.setCreationDate(date); pdf.setModificationDate(date);
  info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of(version));
  // Partial vector trapping does not establish that every page is fully trapped.
  info.set(PDFName.of('Trapped'), PDFName.of('False'));
  const metadata = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/" pdfxid:GTS_PDFXVersion="${version}"/>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" pdf:Producer="Recto Studio" pdf:Trapped="False"/>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:format>application/pdf</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(state.settings.title)}</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>${escapeXml(state.settings.author || '')}</rdf:li></rdf:Seq></dc:creator></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="Recto Studio" xmp:CreateDate="${date.toISOString()}" xmp:ModifyDate="${date.toISOString()}" xmp:MetadataDate="${date.toISOString()}"/>
<rdf:Description rdf:about="" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmpMM:DocumentID="uuid:${crypto.randomUUID()}" xmpMM:InstanceID="uuid:${crypto.randomUUID()}"/>
</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(pdf.context.stream(new TextEncoder().encode(metadata), { Type: 'Metadata', Subtype: 'XML' })));
  pdf.catalog.delete(PDFName.of('Version'));
  if (!pdf.context.trailerInfo.ID) pdf.context.trailerInfo.ID = pdf.context.obj([PDFHexString.of(crypto.randomUUID().replace(/-/g, '')), PDFHexString.of(crypto.randomUUID().replace(/-/g, ''))]);
  // Classic xref tables and no object streams keep the flattened edition within PDF 1.4.
  const result = await pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
  result.set(new TextEncoder().encode(standard === 'pdfx1a-2003' ? '%PDF-1.4' : '%PDF-1.6'));
  return { bytes: result, report: { target: version, independentValidationRequired: true, certified: false,
    checks: ['Embedded fonts', 'CMYK output ICC profile', 'Nested page boxes', 'No interactive annotations', 'Process-colour artwork', ...(standard === 'pdfx1a-2003' ? ['Transparency flattened', 'PDF 1.4 serialization'] : ['CMYK transparency blending space', 'PDF 1.6 serialization'])] } };
}
