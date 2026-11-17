import { PDFHeader, PDFInvalidObject, PDFName, PDFNumber, PDFObjectStream, PDFRef, PDFStream, PDFStreamWriter,
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

function objectStream(context: PDFDocument['context'], engine: Engine, contents: [PDFRef, PDFObject][]) {
  const encode = engine.pdf_object_stream;
  if (encode) {
    const lengths = contents.map(([, object]) => object.sizeInBytes());
    const header = contents.length * 8;
    const length = lengths.reduce((total, size) => total + size, header);
    if (length <= engine.raster_capacity()) {
      const input = new Uint8Array(engine.memory.buffer, engine.raster_input(), length);
      const records = new DataView(input.buffer, input.byteOffset, header);
      let offset = header;
      for (const [i, [ref, object]] of contents.entries()) {
        records.setUint32(i * 8, ref.objectNumber, true);
        records.setUint32(i * 8 + 4, lengths[i], true);
        if (object.copyBytesInto(input, offset) !== lengths[i]) throw new Error('PDF object size changed during serialization.');
        offset += lengths[i];
      }
      const size = encode(contents.length, length);
      if (size > 4) {
        const output = new Uint8Array(engine.memory.buffer, engine.raster_output(), size);
        const first = new DataView(output.buffer, output.byteOffset, 4).getUint32(0, true);
        const stream = context.flateStream(output.subarray(4));
        stream.dict.set(PDFName.of('Type'), PDFName.of('ObjStm'));
        stream.dict.set(PDFName.of('N'), PDFNumber.of(contents.length));
        stream.dict.set(PDFName.of('First'), PDFNumber.of(first));
        return stream;
      }
    }
  }
  return PDFObjectStream.withContextAndObjects(context, contents, true);
}

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
  const fitsScratch = 5 + count * 33 <= engine.raster_capacity();
  const batch = engine.pdf_classic_rows;
  if ((!fitsScratch && !batch) ||
      objects.some(([ref], index) => !Number.isInteger(ref.objectNumber) || ref.objectNumber <= 0 ||
        ref.objectNumber > 0xffffffff || (index > 0 && ref.objectNumber <= objects[index - 1][0].objectNumber) ||
        !Number.isInteger(ref.generationNumber) || ref.generationNumber < 0 || ref.generationNumber > 65535)) return undefined;
  const batchRows = 16_384;
  const entries = new DataView(engine.memory.buffer, engine.raster_input(), (fitsScratch ? count : batchRows) * 16);
  const offsets = fitsScratch ? undefined : new Float64Array(count);
  function pack(row: number, number: number, generation: number, offset: number) {
    entries.setUint32(row * 16, number, true);
    entries.setUint32(row * 16 + 4, generation, true);
    entries.setBigUint64(row * 16 + 8, BigInt(offset), true);
  }
  let cursor = 1;
  if (!offsets) pack(0, 0, 65535, 0);
  const payload = writeObjects(PDFHeader.forVersion(1, 7), objects, version,
    (ref, offset) => {
      if (offsets) offsets[cursor++] = offset;
      else pack(cursor++, ref.objectNumber, ref.generationNumber, offset);
    });
  const xrefOffset = payload.size;
  function appendRows(size: number) {
    if (size) payload.append(new Uint8Array(engine.memory.buffer, engine.raster_output(), size));
    return size > 0;
  }
  if (offsets && batch) {
    payload.append('xref\n');
    const numberAt = (row: number) => row === 0 ? 0 : objects[row - 1][0].objectNumber;
    for (let first = 0; first < count;) {
      let end = first + 1;
      while (end < count && numberAt(end) === numberAt(end - 1) + 1) end++;
      for (let start = first; start < end; start += batchRows) {
        const rows = Math.min(batchRows, end - start);
        for (let i = 0; i < rows; i++) {
          const row = start + i;
          pack(i, numberAt(row), row === 0 ? 65535 : objects[row - 1][0].generationNumber, offsets[row]);
        }
        if (!appendRows(batch(rows, start === first ? end - first : 0))) return undefined;
      }
      first = end;
    }
  } else if (!appendRows(engine.pdf_classic_xref(count))) return undefined;
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
  // Object-stream assembly borrows the same scratch space before the xref is finalized.
  const entries = new DataView(new ArrayBuffer(maxEntries * 24));
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
    writeIndirect(payload, ref, objectStream(context, engine, contents));
  }
  const xrefRef = PDFRef.of(nextObject++);
  const offset = payload.size;
  record(xrefRef.objectNumber, 1, offset, 0);
  new Uint8Array(engine.memory.buffer, engine.raster_input(), count * 24).set(new Uint8Array(entries.buffer, 0, count * 24));
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
