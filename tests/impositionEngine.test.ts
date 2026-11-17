import { PDFDict, PDFDocument, PDFName, rgb } from 'pdf-lib';
import { expect, it } from 'vitest';
import { loadRasterWasm } from '../src/engine/rasterWasm';
import { bindingModes, planImposition } from '../src/export/impositionEngine';
import { exportSignatureSheetProof } from '../src/export/signatureSheetProof';

it('matches native and cold planner output for the four binding modes', async () => {
  const cases = bindingModes.flatMap(bindingMode => [1, 5, 8, 23, 32, 501].map(pageCount => ({
    pageCount, bindingMode, baseline: planImposition(pageCount, 55, 75, { bindingMode, signatureSize: 16 }),
  })));
  expect((await loadRasterWasm())?.imposition_plan).toBeTypeOf('function');
  for (const { pageCount, bindingMode, baseline } of cases) {
    const actual = planImposition(pageCount, 55, 75, { bindingMode, signatureSize: 16 });
    expect(actual).toEqual(baseline);
    const pages = actual.sheetSides.flatMap(side => side.panels || [side.leftPageNumber, side.rightPageNumber]).filter(page => page !== null);
    expect(pages.sort((a, b) => a - b)).toEqual(Array.from({ length: pageCount }, (_, index) => index + 1));
  }
  expect(planImposition(5, 55, 75, { bindingMode: 'consecutive-2up' })).toMatchObject({ sheetsCount: 2, maxCreepMm: 0 });
  expect(planImposition(16, 55, 75, { creepMmPerSheet: 0.08 }).maxCreepMm).toBeCloseTo(0.24);
});

it('keeps all eight vector panels on a single imposed mini-zine sheet', async () => {
  const interior = await PDFDocument.create();
  for (let i = 0; i < 8; i++) {
    const page = interior.addPage([155.9, 212.6]);
    page.drawRectangle({ x: 15, y: 25, width: 10 + i, height: 50, color: rgb(0, 0.5, 0.75) });
  }
  const plan = planImposition(8, 55, 75, { bindingMode: 'mini-zine-8page' });
  expect(plan.sheetSides[0].panels).toEqual([5, 4, 3, 2, 6, 7, 8, 1]);
  const payload = await exportSignatureSheetProof(interior, plan, { includeCutMarks: false });
  const proof = await PDFDocument.load(payload.bytes());
  expect(proof.getPageCount()).toBe(1);
  const sheet = proof.getPage(0);
  expect(sheet.getWidth() * 25.4 / 72).toBeCloseTo(220);
  expect(sheet.getHeight() * 25.4 / 72).toBeCloseTo(150);
  expect(sheet.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict).keys()).toHaveLength(8);
});
