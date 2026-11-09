import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import type { ProjectState } from '../types';
import { escapeXml as xml, requirePdfFonts } from './pdfPress';

/** Declare PDF/UA-1 only after the strict exporter has built its supported semantics. */
export async function identifyPdfUa1(bytes: Uint8Array, state: ProjectState) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  if (!state.settings.title.trim()) throw new Error('Accessible PDF requires a document title.');
  try { Intl.getCanonicalLocales(state.settings.language || 'en-US'); } catch { throw new Error('Set a valid document language before accessible PDF export.'); }
  if (!pdf.catalog.has(PDFName.of('StructTreeRoot'))) throw new Error('The PDF has no accessibility structure tree.');
  for (const page of pdf.getPages()) {
    if (page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size()) throw new Error('Accessible annotation tagging is not implemented. Remove links/forms or use the ordinary tagged screen preset.');
  }
  requirePdfFonts(pdf, true);
  pdf.setTitle(state.settings.title); pdf.setAuthor(state.settings.author || ''); pdf.setProducer('Recto Studio');
  const now = new Date().toISOString();
  const metadata = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Recto Studio"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/" pdfuaid:part="1"/>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(state.settings.title)}</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>${xml(state.settings.author || '')}</rdf:li></rdf:Seq></dc:creator></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreateDate="${now}" xmp:ModifyDate="${now}" xmp:MetadataDate="${now}"/>
</rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
  pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(pdf.context.flateStream(new TextEncoder().encode(metadata), { Type: 'Metadata', Subtype: 'XML' })));
  return pdf.save({ useObjectStreams: true, updateFieldAppearances: false });
}
