import type { jsPDF } from 'jspdf';

const firstChunkBytes = 64 * 1024;
const chunkBytes = 1024 * 1024;

export class PdfPayload {
  private readonly chunks: Uint8Array<ArrayBuffer>[] = [];
  private pending = new Uint8Array(0);
  private used = 0;
  private length = 0;

  append(source: Uint8Array | string) {
    for (let offset = 0; offset < source.length;) {
      if (this.used === this.pending.length) {
        this.pending = new Uint8Array(this.chunks.length ? chunkBytes : firstChunkBytes);
        this.chunks.push(this.pending);
        this.used = 0;
      }
      const count = Math.min(source.length - offset, this.pending.length - this.used);
      if (typeof source === 'string') {
        for (let i = 0; i < count; i++) this.pending[this.used + i] = source.charCodeAt(offset + i);
      } else {
        this.pending.set(source.subarray(offset, offset + count), this.used);
      }
      this.used += count;
      this.length += count;
      offset += count;
    }
  }

  parts(): Uint8Array<ArrayBuffer>[] {
    return this.chunks.map((chunk, index) => index === this.chunks.length - 1 ? chunk.subarray(0, this.used) : chunk);
  }

  get size() { return this.length; }

  blob() { return new Blob(this.parts(), { type: 'application/pdf' }); }

  byteAt(offset: number): number | undefined {
    if (offset < 0 || offset >= this.length) return undefined;
    if (offset < firstChunkBytes) return this.chunks[0][offset];
    const relative = offset - firstChunkBytes;
    return this.chunks[1 + Math.floor(relative / chunkBytes)][relative % chunkBytes];
  }

  range(begin: number, end: number): Uint8Array<ArrayBuffer> {
    const normalize = (offset: number) => Math.min(this.length, Math.max(0, offset < 0 ? this.length + offset : offset));
    const start = normalize(begin), stop = normalize(end);
    const result = new Uint8Array(Math.max(0, stop - start));
    for (let offset = start; offset < stop;) {
      const relative = offset - firstChunkBytes;
      const index = relative < 0 ? 0 : 1 + Math.floor(relative / chunkBytes);
      const localOffset = relative < 0 ? offset : relative % chunkBytes;
      const chunk = this.chunks[index];
      const count = Math.min(stop - offset, chunk.length - localOffset);
      result.set(chunk.subarray(localOffset, localOffset + count), offset - start);
      offset += count;
    }
    return result;
  }

  bytes() { return this.range(0, this.length); }
}

interface JsPdfOutput {
  buildDocument(): string;
  setCustomOutputDestination(destination: { push(line: string): void }): void;
  resetCustomOutputDestination(): void;
}

export const finalizedPdfPayloads = new WeakMap<jsPDF, PdfPayload>();

export function pdfExportPayload(doc: jsPDF) {
  return finalizedPdfPayloads.get(doc) ?? serializeJsPdf(doc);
}

export function pdfExportBlob(doc: jsPDF) {
  return pdfExportPayload(doc).blob();
}

/** Capture jsPDF's binary strings before its writer joins the whole document. */
export function serializeJsPdf(doc: jsPDF): PdfPayload {
  const payload = new PdfPayload();
  const output = (doc as unknown as { __private__?: JsPdfOutput }).__private__;
  if (!output?.buildDocument || !output.setCustomOutputDestination || !output.resetCustomOutputDestination) {
    payload.append(new Uint8Array(doc.output('arraybuffer')));
    return payload;
  }
  try {
    let started = false;
    output.setCustomOutputDestination({ push(line) {
      if (started) payload.append('\n');
      started = true;
      payload.append(line);
    } });
    const fallback = output.buildDocument();
    if (!payload.size) payload.append(fallback);
  } finally {
    output.resetCustomOutputDestination();
    doc.setPage(doc.getCurrentPageInfo().pageNumber);
  }
  return payload;
}
