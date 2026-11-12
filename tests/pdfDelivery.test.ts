import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { degrees, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { inspectDeliveryPdf } from '../src/export/pdfDelivery';
import type { PrinterProfile } from '../src/engine/printerProfiles';

const hexHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const file = (bytes: Uint8Array) => new File([new Uint8Array(bytes)], 'delivery.pdf', { type: 'application/pdf' });
const profileBytes = () => readFileSync(new URL('./fixtures/icc/lcms-test-output.icc', import.meta.url));
const printer: PrinterProfile = { name: 'Book press', bleedMm: 3, minDpi: 300, maxInk: 320 };

function setOutputProfile(pdf: PDFDocument, bytes: Uint8Array) {
  const stream = pdf.context.register(pdf.context.flateStream(bytes, { N: 4 }));
  pdf.catalog.set(PDFName.of('OutputIntents'), pdf.context.obj([{
    Type: 'OutputIntent', S: 'GTS_PDFX', OutputConditionIdentifier: PDFString.of('Test press'), DestOutputProfile: stream,
  }]));
}

describe('delivery PDF inspection', () => {
  it('ties the report to exact file bytes and measures inherited geometry, rotation and asymmetric bleed', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([100, 200]);
    const parent = page.node.Parent()!;
    parent.set(PDFName.of('MediaBox'), page.node.get(PDFName.of('MediaBox'))!);
    page.node.delete(PDFName.of('MediaBox'));
    page.node.set(PDFName.of('UserUnit'), pdf.context.obj(2));
    page.setRotation(degrees(90));
    page.setTrimBox(10, 10, 80, 180);
    page.setBleedBox(1, 2, 96, 197);
    const shortBleed = pdf.addPage([100, 200]);
    shortBleed.setTrimBox(10, 10, 80, 180);
    shortBleed.setBleedBox(9, 1, 90, 198);
    const profile = profileBytes();
    setOutputProfile(pdf, profile);
    const bytes = await pdf.save();

    const report = await inspectDeliveryPdf(file(bytes), { ...printer, iccId: hexHash(profile).toUpperCase() });
    expect(report.source).toMatchObject({ name: 'delivery.pdf', sizeBytes: bytes.length, sha256: hexHash(bytes) });
    expect(report.pages[0]).toMatchObject({
      number: 1, boxesPt: { MediaBox: [0, 0, 200, 400], TrimBox: [20, 20, 180, 380] },
      trimSizeMm: { width: 127, height: 56.4444 },
      bleedMm: { left: 6.35, bottom: 5.6444, right: 4.9389, top: 6.35 },
    });
    expect(report.outputIntents).toEqual([expect.objectContaining({
      identifier: 'Test press', profile: expect.objectContaining({ colorSpace: 'CMYK', sha256: hexHash(profile) }),
    })]);
    expect(report.findings).toEqual([expect.objectContaining({ severity: 'error', page: 2, message: expect.stringContaining('Minimum bleed is 0.3528 mm') })]);
  });

  it('reports resources in nested forms, including an embedded CID font with ToUnicode', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([100, 200]);
    const { context } = pdf;
    const fontProgram = context.register(context.flateStream(readFileSync(new URL('./fixtures/fonts/OpenSans-Regular.ttf', import.meta.url))));
    const cmap = context.register(context.flateStream('/CIDInit /ProcSet findresource begin end'));
    const child = context.register(context.flateStream('BT ET', {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 200], Resources: {
        Font: {
          F1: { Type: 'Font', Subtype: 'Type0', BaseFont: 'OpenSans', ToUnicode: cmap, DescendantFonts: [
            { Type: 'Font', Subtype: 'CIDFontType2', FontDescriptor: { FontFile2: fontProgram } },
          ] },
          F2: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' },
        },
      },
    }));
    page.node.Resources()!.set(PDFName.of('XObject'), context.obj({ Child: child }));
    pdf.catalog.set(PDFName.of('StructTreeRoot'), context.obj({ Type: 'StructTreeRoot' }));
    const report = await inspectDeliveryPdf(file(await pdf.save()));

    expect(report.tagged).toBe(true);
    expect(report.fonts).toEqual([
      { name: 'Helvetica', subtype: 'Type1', embedding: 'missing', unicodeMap: false },
      { name: 'OpenSans', subtype: 'CIDFontType2', embedding: 'embedded', unicodeMap: true },
    ]);
    expect(report.findings).toContainEqual(expect.objectContaining({ message: '1 of 2 font resources have no embedded program.' }));
  });

  it('flags invalid geometry and unreadable profiles without claiming that printer requirements passed', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([100, 200]);
    page.setTrimBox(10, 10, 80, 180);
    page.setBleedBox(10, 20, 80, 170);
    setOutputProfile(pdf, new Uint8Array([1, 2, 3]));
    const report = await inspectDeliveryPdf(file(await pdf.save()), { ...printer, iccId: '0'.repeat(64) });
    expect(report.pages[0].bleedMm).toBeUndefined();
    expect(report.findings).toEqual(expect.arrayContaining([
      { severity: 'error', page: 1, message: 'The BleedBox does not enclose the TrimBox.' },
      { severity: 'review', message: 'No readable embedded ICC profile was found in output intent 1.' },
      { severity: 'error', message: 'The PDF does not embed the required output ICC profile for Book press.' },
    ]));
  });

  it('rejects corrupt and truncated PDF files', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    await expect(inspectDeliveryPdf(file(bytes.subarray(0, bytes.length - 9)))).rejects.toThrow('Choose a complete PDF');
    const broken = new TextEncoder().encode('%PDF-1.7\nInvalid content\n%%EOF');
    await expect(inspectDeliveryPdf(file(broken))).rejects.toThrow('Could not read this PDF');
  });
});
