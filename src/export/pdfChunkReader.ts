import { NextByteAssertionError, PDFDocument, PDFParser, type PDFContext } from 'pdf-lib';
import { PdfPayload } from './pdfPayload';

/** ByteStream-compatible cursor for segmented PDF data. */
class PdfChunkReader {
  private index = 0;
  private line = 0;
  private column = 0;

  constructor(private readonly payload: PdfPayload) {}

  moveTo(offset: number) { this.index = offset; }
  offset() { return this.index; }
  done() { return this.index >= this.payload.size; }
  peek() { return this.payload.byteAt(this.index); }
  peekAhead(steps: number) { return this.payload.byteAt(this.index + steps); }
  peekAt(offset: number) { return this.payload.byteAt(offset); }
  slice(start: number, end: number) { return this.payload.range(start, end); }
  position() { return { line: this.line, column: this.column, offset: this.index }; }

  next() {
    const byte = this.payload.byteAt(this.index++);
    if (byte === 10) {
      this.line++;
      this.column = 0;
    } else {
      this.column++;
    }
    return byte;
  }

  assertNext(expected: number) {
    const actual = this.peek();
    if (actual !== expected) throw new NextByteAssertionError(this.position(), expected, actual ?? -1);
    return this.next();
  }
}

/** Keep pdf-lib's parser and object normalization while supplying segmented bytes. */
export async function loadPdfChunks(payload: PdfPayload, throwOnInvalidObject = false): Promise<PDFDocument> {
  const parser = PDFParser.forBytesWithOptions(new Uint8Array(0), 100, throwOnInvalidObject);
  const source = parser as unknown as { bytes?: unknown };
  // Both hooks belong to the pinned pdf-lib 1.17.1 parser API. Keep an upgrade fallback.
  if (!source.bytes) return PDFDocument.load(payload.bytes(), { updateMetadata: false, throwOnInvalidObject });
  source.bytes = new PdfChunkReader(payload);
  const context = await parser.parseDocument();
  const Document = PDFDocument as unknown as new (context: PDFContext, ignoreEncryption: boolean, updateMetadata: boolean) => PDFDocument;
  return new Document(context, false, false);
}

export async function readPdfChunks(file: Blob) {
  const payload = new PdfPayload();
  const reader = file.stream().getReader();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) return payload;
      payload.append(part.value);
    }
  } finally {
    reader.releaseLock();
  }
}
