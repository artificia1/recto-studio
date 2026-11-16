import type { jsPDF } from 'jspdf';

export class PdfPayload {
  private readonly chunks: Uint8Array<ArrayBuffer>[] = [];
  private pending = new Uint8Array(0);
  private used = 0;
  private length = 0;

  append(source: Uint8Array | string) {
    for (let offset = 0; offset < source.length;) {
      if (this.used === this.pending.length) {
        this.pending = new Uint8Array(this.chunks.length ? 1024 * 1024 : 64 * 1024);
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

  private parts() {
    return this.chunks.map((chunk, index) => index === this.chunks.length - 1 ? chunk.subarray(0, this.used) : chunk);
  }

  get size() { return this.length; }

  blob() { return new Blob(this.parts(), { type: 'application/pdf' }); }

  bytes() {
    const result = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.parts()) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

interface JsPdfOutput {
  buildDocument(): string;
  setCustomOutputDestination(destination: { push(line: string): void }): void;
  resetCustomOutputDestination(): void;
}

export const finalizedPdfPayloads = new WeakMap<jsPDF, PdfPayload>();

export function pdfExportBlob(doc: jsPDF) {
  return (finalizedPdfPayloads.get(doc) ?? serializeJsPdf(doc)).blob();
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
