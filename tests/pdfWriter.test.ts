import { jsPDF } from 'jspdf';
import { PDFDocument, PDFNumber, PDFRef, PDFStreamWriter, PDFWriter } from 'pdf-lib';
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

it('writes native compressed cross references for multiple object streams and sparse IDs', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Embedded in the edition');
  for (let i = 0; i < 115; i++) pdf.context.register(pdf.context.obj({ Record: i }));
  pdf.context.assign(PDFRef.of(400, 7), pdf.context.obj({ Sparse: true }));
  const expected = await pdf.save({ useObjectStreams: true, updateFieldAppearances: false });
  expect((await loadRasterWasm())?.pdf_stream_xref).toBeTypeOf('function');
  const fallback = vi.spyOn(PDFStreamWriter, 'forContext');
  try {
    const payload = await serializePdf(pdf, true);
    expect(fallback).not.toHaveBeenCalled();
    expect(Buffer.from(payload.bytes()).equals(expected)).toBe(true);
    expect((await loadPdfChunks(payload)).getPageCount()).toBe(1);
  } finally { fallback.mockRestore(); }
});

it('streams a classic xref larger than the single-batch limit and preserves sparse subsections', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  for (let i = 0; i < 33_000; i++) pdf.context.register(PDFNumber.of(i));
  pdf.context.assign(PDFRef.of(40_000, 7), PDFNumber.of(123));
  expect((await loadRasterWasm())?.pdf_classic_rows).toBeTypeOf('function');
  const fallback = vi.spyOn(PDFWriter, 'forContext');
  try {
    const payload = await serializePdf(pdf, false);
    expect(fallback).not.toHaveBeenCalled();
    const footer = Buffer.from(payload.range(-128, payload.size)).toString();
    const xref = Number(footer.match(/startxref\n(\d+)/)?.[1]);
    const header = Buffer.from(payload.range(xref, xref + 60)).toString();
    expect(header).toMatch(/^xref\n0 33005\n0000000000 65535 f /);
    const tail = Buffer.from(payload.range(-256, payload.size)).toString();
    const offset = Number(tail.match(/40000 1\n(\d{10}) 00007 n /)?.[1]);
    expect(Buffer.from(payload.range(offset, offset + 16)).toString()).toBe('40000 7 obj\n123\n');
    expect((await PDFDocument.load(payload.bytes())).getPageCount()).toBe(1);
  } finally { fallback.mockRestore(); }
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
