import type { PDFDataRangeTransport } from 'pdfjs-dist';
import type { PdfPayload } from './pdfPayload';

export function pdfRangeOptions(
  Transport: typeof PDFDataRangeTransport,
  source: Blob | PdfPayload,
  onError: (error: unknown) => void,
) {
  class PublicationTransport extends Transport {
    private stopped = false;

    override requestDataRange(begin: number, end: number) {
      void (async () => {
        const bytes = source instanceof Blob
          ? new Uint8Array(await source.slice(begin, end).arrayBuffer())
          : source.range(begin, end);
        if (!this.stopped) this.onDataRange(begin, bytes);
      })().catch(error => {
        if (!this.stopped) onError(error);
      });
    }

    override abort() { this.stopped = true; }
  }
  return {
    range: new PublicationTransport(source.size, null),
    rangeChunkSize: 256 * 1024,
    disableStream: true,
    disableAutoFetch: true,
  };
}
