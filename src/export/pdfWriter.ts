import { PDFHeader, PDFInvalidObject, PDFName, PDFObjectStream, PDFRef, PDFStream, PDFStreamWriter,
  PDFTrailerDict, PDFWriter, type PDFDocument, type PDFObject } from 'pdf-lib';
import type { SerializationInfo } from 'pdf-lib/es/core/writers/PDFWriter';
import { PdfPayload } from './pdfPayload';
import { loadRasterWasm } from '../engine/rasterWasm';

function appendObject(payload: PdfPayload, object: Pick<PDFObject, 'sizeInBytes' | 'copyBytesInto'>) {
  if (object instanceof PDFStream) {
    object.updateDict();
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

function startPdf(header: WritablePdfObject, version?: string) {
  const payload = new PdfPayload();
  const bytes = new Uint8Array(header.sizeInBytes());
  header.copyBytesInto(bytes, 0);
  if (version) bytes.set(new TextEncoder().encode(version));
  payload.append(bytes);
  payload.append('\n\n');
  return payload;
}

function writeIndirect(payload: PdfPayload, ref: ObjectRef, object: WritablePdfObject) {
  payload.append(`${ref.objectNumber} ${ref.generationNumber} obj\n`);
  appendObject(payload, object);
  payload.append('\nendobj\n\n');
}

function writeObjects(header: WritablePdfObject, objects: [ObjectRef, WritablePdfObject][], version?: string,
  record?: (ref: ObjectRef, offset: number) => void) {
  const payload = startPdf(header, version);
  for (const [ref, object] of objects) {
    record?.(ref, payload.size);
    writeIndirect(payload, ref, object);
  }
  return payload;
}

type Engine = NonNullable<Awaited<ReturnType<typeof loadRasterWasm>>>;

function appendFooter(payload: PdfPayload, engine: Engine, offset: number) {
  const size = engine.pdf_classic_footer?.(BigInt(offset));
  if (!size) return undefined;
  payload.append(new Uint8Array(engine.memory.buffer, engine.raster_output(), size));
  return payload;
}

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
  const xrefOffset = payload.size;
  const xrefSize = engine.pdf_classic_xref(count);
  if (!xrefSize) return undefined;
  payload.append(new Uint8Array(engine.memory.buffer, engine.raster_output(), xrefSize));
  payload.append('\n');
  const { Root, Encrypt, Info, ID } = context.trailerInfo;
  const trailer = PDFTrailerDict.of(context.obj({ Size: context.largestObjectNumber + 1, Root, Encrypt, Info, ID }));
  appendObject(payload, trailer);
  payload.append('\n\n');
  return appendFooter(payload, engine, xrefOffset);
}

/** Keep the library's object compression, and encode the cross-reference data from the emitted offsets. */
function writeStreamPdf(pdf: PDFDocument, engine: Engine, version?: string) {
  if (!engine.pdf_stream_xref || !engine.pdf_classic_footer) return undefined;
  const context = pdf.context;
  const objects = context.enumerateIndirectObjects();
  const objectsPerStream = 50;
  // One contiguous scratch input, including a conservative upper bound for object streams.
  const maxEntries = objects.length + Math.ceil(objects.length / objectsPerStream) + 2;
  if (maxEntries * 24 > engine.raster_capacity() || context.largestObjectNumber + maxEntries >= 0xffffffff) return undefined;
  const entries = new DataView(engine.memory.buffer, engine.raster_input(), maxEntries * 24);
  let count = 0;
  function record(number: number, type: number, offset: number, generation: number) {
    const row = count++ * 24;
    entries.setUint32(row, number, true);
    entries.setUint8(row + 4, type);
    entries.setBigUint64(row + 8, BigInt(offset), true);
    entries.setUint32(row + 16, generation, true);
  }
  const payload = startPdf(PDFHeader.forVersion(1, 7), version);
  const groups: { ref: PDFRef; contents: [PDFRef, PDFObject][] }[] = [];
  let nextObject = context.largestObjectNumber + 1, previous = 0;
  record(0, 0, 0, 65535);
  for (const [ref, object] of objects) {
    if (!Number.isInteger(ref.objectNumber) || ref.objectNumber <= previous ||
        !Number.isInteger(ref.generationNumber) || ref.generationNumber < 0 || ref.generationNumber > 65535) return undefined;
    previous = ref.objectNumber;
    if (ref === context.trailerInfo.Encrypt || object instanceof PDFStream || object instanceof PDFInvalidObject || ref.generationNumber !== 0) {
      record(ref.objectNumber, 1, payload.size, ref.generationNumber);
      writeIndirect(payload, ref, object);
    } else {
      let group = groups.at(-1);
      if (!group || group.contents.length === objectsPerStream) {
        group = { ref: PDFRef.of(nextObject++), contents: [] };
        groups.push(group);
      }
      record(ref.objectNumber, 2, group.ref.objectNumber, group.contents.length);
      group.contents.push([ref, object]);
    }
  }
  for (const { ref, contents } of groups) {
    record(ref.objectNumber, 1, payload.size, 0);
    writeIndirect(payload, ref, PDFObjectStream.withContextAndObjects(context, contents, true));
  }
  const xrefRef = PDFRef.of(nextObject++);
  const offset = payload.size;
  record(xrefRef.objectNumber, 1, offset, 0);
  const size = engine.pdf_stream_xref(count);
  if (!size) return undefined;
  const output = new DataView(engine.memory.buffer, engine.raster_output(), size);
  const widths = [output.getUint8(0), output.getUint8(1), output.getUint8(2)];
  const index = Array.from({ length: output.getUint32(4, true) * 2 }, (_, i) => output.getUint32(8 + i * 4, true));
  const prefix = 8 + index.length * 4;
  const { Root, Encrypt, Info, ID } = context.trailerInfo;
  const xref = context.flateStream(new Uint8Array(output.buffer, output.byteOffset + prefix, size - prefix),
    { Size: nextObject, Root, Encrypt, Info, ID });
  xref.dict.set(PDFName.of('Type'), PDFName.of('XRef'));
  xref.updateDict();
  xref.dict.set(PDFName.of('W'), context.obj(widths));
  xref.dict.set(PDFName.of('Index'), context.obj(index));
  writeIndirect(payload, xrefRef, xref);
  return appendFooter(payload, engine, offset);
}

/** Serialize PDF objects, with classic or compressed cross-references, to bounded chunks. */
export async function serializePdf(pdf: PDFDocument, objectStreams: boolean, version?: string): Promise<PdfPayload> {
  const [engine] = await Promise.all([loadRasterWasm(), pdf.flush()]);
  if (engine) {
    const native = objectStreams ? writeStreamPdf(pdf, engine, version) : writeClassicPdf(pdf, engine, version);
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
