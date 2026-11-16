import { PDFHeader, PDFStream, PDFStreamWriter, PDFTrailerDict, PDFWriter, type PDFDocument, type PDFObject, type PDFRef } from 'pdf-lib';
import type { SerializationInfo } from 'pdf-lib/es/core/writers/PDFWriter';
import { PdfPayload } from './pdfPayload';
import { loadRasterWasm } from '../engine/rasterWasm';

function appendObject(payload: PdfPayload, object: Pick<PDFObject, 'sizeInBytes' | 'copyBytesInto'>) {
  if (object instanceof PDFStream) {
    appendObject(payload, object.dict);
    payload.append('\nstream\n');
    payload.append(object.getContents());
    payload.append('\nendstream');
    return;
  }
  const size = object.sizeInBytes();
  const bytes = new Uint8Array(size);
  if (object.copyBytesInto(bytes, 0) !== size) throw new Error('PDF object size changed during serialization.');
  payload.append(bytes);
}

type ObjectRef = Pick<PDFRef, 'objectNumber' | 'generationNumber'>;
type WritablePdfObject = Pick<PDFObject, 'sizeInBytes' | 'copyBytesInto'>;

function writeObjects(header: WritablePdfObject, objects: [ObjectRef, WritablePdfObject][], version?: string,
  record?: (ref: ObjectRef, offset: number) => void) {
  const payload = new PdfPayload();
  const bytes = new Uint8Array(header.sizeInBytes());
  header.copyBytesInto(bytes, 0);
  if (version) bytes.set(new TextEncoder().encode(version));
  payload.append(bytes);
  payload.append('\n\n');
  for (const [ref, object] of objects) {
    record?.(ref, payload.size);
    payload.append(`${ref.objectNumber} ${ref.generationNumber} obj\n`);
    appendObject(payload, object);
    payload.append('\nendobj\n\n');
  }
  return payload;
}

type Engine = NonNullable<Awaited<ReturnType<typeof loadRasterWasm>>>;

/** Emit a classic cross-reference table from actual byte offsets, without a sizing pass. */
function writeClassicPdf(pdf: PDFDocument, engine: Engine, version?: string): PdfPayload | undefined {
  if (!engine.pdf_classic_xref || !engine.pdf_classic_footer) return undefined;
  const context = pdf.context;
  const objects = context.enumerateIndirectObjects();
  const count = objects.length + 1;
  // Allow room for a separate subsection header per entry in a sparse document.
  if (5 + count * 33 > engine.raster_capacity() ||
      objects.some(([ref]) => ref.objectNumber <= 0 || ref.objectNumber > 0xffffffff ||
        ref.generationNumber < 0 || ref.generationNumber > 65535)) return undefined;
  const entries = new DataView(engine.memory.buffer, engine.raster_input(), count * 16);
  let cursor = 0;
  function record(number: number, generation: number, offset: number) {
    entries.setUint32(cursor, number, true);
    entries.setUint32(cursor + 4, generation, true);
    entries.setBigUint64(cursor + 8, BigInt(offset), true);
    cursor += 16;
  }
  record(0, 65535, 0);
  const payload = writeObjects(PDFHeader.forVersion(1, 7), objects, version,
    (ref, offset) => record(ref.objectNumber, ref.generationNumber, offset));
  const xrefOffset = BigInt(payload.size);
  const xrefSize = engine.pdf_classic_xref(count);
  if (!xrefSize) return undefined;
  payload.append(new Uint8Array(engine.memory.buffer, engine.raster_output(), xrefSize));
  payload.append('\n');
  const { Root, Encrypt, Info, ID } = context.trailerInfo;
  const trailer = PDFTrailerDict.of(context.obj({ Size: context.largestObjectNumber + 1, Root, Encrypt, Info, ID }));
  appendObject(payload, trailer);
  payload.append('\n\n');
  const footerSize = engine.pdf_classic_footer(xrefOffset);
  if (!footerSize) return undefined;
  payload.append(new Uint8Array(engine.memory.buffer, engine.raster_output(), footerSize));
  return payload;
}

/** Serialize PDF objects to bounded chunks. Compressed object streams use pdf-lib's plan. */
export async function serializePdf(pdf: PDFDocument, objectStreams: boolean, version?: string): Promise<PdfPayload> {
  const [engine] = await Promise.all([objectStreams ? undefined : loadRasterWasm(), pdf.flush()]);
  if (engine) {
    const native = writeClassicPdf(pdf, engine, version);
    if (native) return native;
  }
  const writer = objectStreams ? PDFStreamWriter.forContext(pdf.context, 50) : PDFWriter.forContext(pdf.context, 50);
  const plan = await (writer as unknown as { computeBufferSize(): Promise<SerializationInfo> }).computeBufferSize();
  const payload = writeObjects(plan.header, plan.indirectObjects, version);
  if (plan.xref) {
    appendObject(payload, plan.xref);
    payload.append('\n');
  }
  if (plan.trailerDict) {
    appendObject(payload, plan.trailerDict);
    payload.append('\n\n');
  }
  appendObject(payload, plan.trailer);
  if (payload.size !== plan.size) throw new Error('PDF cross-reference offsets changed during serialization.');
  return payload;
}
