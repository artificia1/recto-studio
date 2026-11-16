import { PDFStream, PDFStreamWriter, PDFWriter, type PDFDocument, type PDFObject } from 'pdf-lib';
import type { SerializationInfo } from 'pdf-lib/es/core/writers/PDFWriter';
import { PdfPayload } from './pdfPayload';

/** Use pdf-lib's size and cross-reference plan with a segmented output buffer. */
export async function serializePdf(pdf: PDFDocument, objectStreams: boolean, version?: string): Promise<PdfPayload> {
  await pdf.flush();
  const writer = objectStreams ? PDFStreamWriter.forContext(pdf.context, 50) : PDFWriter.forContext(pdf.context, 50);
  const plan = await (writer as unknown as { computeBufferSize(): Promise<SerializationInfo> }).computeBufferSize();
  const payload = new PdfPayload();
  function appendObject(object: Pick<PDFObject, 'sizeInBytes' | 'copyBytesInto'>) {
    const size = object.sizeInBytes();
    if (object instanceof PDFStream) {
      appendObject(object.dict);
      payload.append('\nstream\n');
      payload.append(object.getContents());
      payload.append('\nendstream');
      return;
    }
    const bytes = new Uint8Array(size);
    if (object.copyBytesInto(bytes, 0) !== size) throw new Error('PDF object size changed during serialization.');
    payload.append(bytes);
  }
  const header = new Uint8Array(plan.header.sizeInBytes());
  plan.header.copyBytesInto(header, 0);
  if (version) header.set(new TextEncoder().encode(version));
  payload.append(header);
  payload.append('\n\n');
  for (const [ref, object] of plan.indirectObjects) {
    payload.append(`${ref.objectNumber} ${ref.generationNumber} obj\n`);
    appendObject(object);
    payload.append('\nendobj\n\n');
  }
  if (plan.xref) {
    appendObject(plan.xref);
    payload.append('\n');
  }
  if (plan.trailerDict) {
    appendObject(plan.trailerDict);
    payload.append('\n\n');
  }
  appendObject(plan.trailer);
  if (payload.size !== plan.size) throw new Error('PDF cross-reference offsets changed during serialization.');
  return payload;
}
