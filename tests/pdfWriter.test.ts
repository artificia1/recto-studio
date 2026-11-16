import { jsPDF } from 'jspdf';
import { PDFDocument, PDFRef, PDFWriter } from 'pdf-lib';
import { expect, it, vi } from 'vitest';
import { loadRasterWasm } from '../src/engine/rasterWasm';
import { serializeJsPdf } from '../src/export/pdfPayload';
import { serializePdf } from '../src/export/pdfWriter';
import { loadPdfChunks } from '../src/export/pdfChunkReader';
import { createNodePdfRaster } from '../src/export/pdfRasterNode';
import { createZipArchive, readZip } from '../src/zip';

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
  expect((await loadPdfChunks(payload)).getPageCount()).toBe(2);
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
  expect((await loadPdfChunks(output)).getPageCount()).toBe(1);
});

it('writes the native classic xref and footer for sparse object numbers and nonzero generations', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.context.assign(PDFRef.of(100, 7), pdf.context.obj({ Test: 'Sparse' }));
  const expected = await pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
  expect((await loadRasterWasm())?.pdf_classic_xref).toBeTypeOf('function');
  const fallback = vi.spyOn(PDFWriter, 'forContext');
  try {
    const output = await serializePdf(pdf, false, '%PDF-1.4');
    expect(fallback).not.toHaveBeenCalled();
    expect(Buffer.from(output.range(0, 8)).toString()).toBe('%PDF-1.4');
    expect(output.range(8, output.size)).toEqual(expected.subarray(8));
  } finally {
    fallback.mockRestore();
  }
});

it('reads and renders a large generated PDF from ranges and archives its original chunks', async () => {
  const pdf = await PDFDocument.create();
  pdf.context.register(pdf.context.stream(new Uint8Array(2 * 1024 * 1024).fill(42)));
  pdf.addPage([100, 100]).drawRectangle({ x: 10, y: 10, width: 80, height: 80 });
  const payload = await serializePdf(pdf, false);
  const renderer = await createNodePdfRaster(payload);
  try {
    const tile = await renderer.tile(0, 48, 48, 4, 4, 1);
    expect(Array.from(tile.subarray(0, 4))).toEqual([0, 0, 0, 255]);
  } finally { await renderer.destroy(); }
  const archive = await readZip(createZipArchive({ 'proof.pdf': payload.parts() }), 4 * 1024 * 1024);
  expect(Buffer.from(archive.get('proof.pdf')!).equals(payload.bytes())).toBe(true);
});
