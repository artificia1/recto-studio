import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';
import { expect, it } from 'vitest';
import { serializeJsPdf } from '../src/export/pdfPayload';
import { serializePdf } from '../src/export/pdfWriter';

it('streams jsPDF bytes and preserves offsets across large embedded streams', async () => {
  const doc = new jsPDF();
  doc.text('First page', 10, 10);
  doc.addPage();
  doc.addImage({ data: new Uint8ClampedArray(800 * 600 * 4).fill(127), width: 800, height: 600 }, 'RGBA', 0, 0, 20, 15);
  const expected = new Uint8Array(doc.output('arraybuffer'));
  const payload = serializeJsPdf(doc);
  expect(payload.size).toBeGreaterThan(1024 * 1024);
  expect(Buffer.from(await payload.blob().arrayBuffer()).equals(expected)).toBe(true);
  expect((await PDFDocument.load(payload.bytes())).getPageCount()).toBe(2);
  doc.text('Page remains editable', 10, 45);
  expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(expected.length);
});

it.each([false, true])('matches the pdf-lib serializer with object streams set to %s', async objectStreams => {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Editorial proof');
  pdf.context.register(pdf.context.stream(new Uint8Array(1024 * 1024 + 300).fill(210)));
  const expected = await pdf.save({ useObjectStreams: objectStreams, updateFieldAppearances: false });
  const clone = await PDFDocument.load(expected, { updateMetadata: false });
  // Compute both plans against the same parsed context, which may normalize objects on load.
  const baseline = await clone.save({ useObjectStreams: objectStreams, updateFieldAppearances: false });
  const output = await serializePdf(clone, objectStreams);
  expect(Buffer.from(output.bytes()).equals(baseline)).toBe(true);
  expect((await PDFDocument.load(output.bytes())).getPageCount()).toBe(1);
});
