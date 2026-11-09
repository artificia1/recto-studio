import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { parseScribus } from '../src/import/scribusImport';
import { exportDocumentToIdml } from '../src/export/idmlExport';
import { parseIdmlPackage } from '../src/idmlImport';
import { shapeToPath } from '../src/engine/vectorPath';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import { generateFlipbookHtml } from '../src/flipbookExport';
import { createProfileAsset } from '../src/engine/iccProfiles';
import { createNodePdfRaster } from '../src/export/pdfRasterNode';
import type { ShapeElement } from '../src/types';

const scribus = `<SCRIBUSUTF8NEW Version="1.6.7"><DOCUMENT PAGEWIDTH="300" PAGEHEIGHT="400">
<COLOR NAME="Cyan" SPACE="CMYK" C="100" M="0" Y="0" K="0"/>
<Gradient Name="Print ramp" Ext="3"><CSTOP NAME="White" RAMP="0"/><CSTOP NAME="Cyan" RAMP="0.6"/><CSTOP NAME="Black" RAMP="1"/></Gradient>
<PAGE NUM="0" PAGEXPOS="0" PAGEYPOS="0"/>
<PAGEOBJECT OwnPage="0" PTYPE="6" FRTYPE="1" XPOS="20" YPOS="30" WIDTH="120" HEIGHT="80"
  GRTYP="6" GRNAME="Print ramp" GRSTARTX="0" GRSTARTY="40" GRENDX="120" GRENDY="40"/>
</DOCUMENT></SCRIBUSUTF8NEW>`;

it('preserves Scribus gradient positions and process inks through editable IDML round-tripping', async () => {
  const { project, warnings } = parseScribus(scribus);
  expect(warnings).toEqual([]);
  const shape = project.spreads[0].elements[0] as ShapeElement;
  const gradient = shape.fillGradient!;
  expect(gradient.stops).toEqual([{ color: '#ffffff', offset: 0 }, { color: 'cmyk(100,0,0,0)', offset: 0.6 }, { color: 'cmyk(0,0,0,100)', offset: 1 }]);
  const path = shapeToPath(shape);
  project.spreads[0].elements.push({ ...path, id: 'curve', x: 54, zIndex: 2 });
  const roundTrip = await parseIdmlPackage(exportDocumentToIdml(project));
  expect(roundTrip.settings.bleedMm).toBe(0);
  const [oval, curve] = roundTrip.spreads[0].elements;
  if (oval.type !== 'shape' || curve.type !== 'path') throw new Error('Expected an oval and an editable path');
  expect(oval.shapeKind).toBe('ellipse');
  expect(oval.fillGradient?.start.y).toBeCloseTo(0.5);
  expect(oval.fillGradient?.end.x).toBeCloseTo(1);
  expect(curve.fillGradient?.stops).toEqual(gradient.stops);
  expect(curve.nodes[0].handleOut?.x).toBeCloseTo(path.nodes[0].handleOut!.x);
  expect(curve.zIndex).toBeGreaterThan(oval.zIndex);
  expect(generateFlipbookHtml(project)).toContain('gradientUnits="userSpaceOnUse"');
});

it('retains a native CMYK shading and an ICC output intent in the PDF/X-4 candidate', async () => {
  const { project } = parseScribus(scribus);
  const profile = await createProfileAsset(new Uint8Array(readFileSync('tests/fixtures/icc/lcms-test-output.icc')), 'test.icc', 'Test only');
  project.settings.colorManagement = { outputProfile: profile, intent: 'relative', blackPointCompensation: true, preservePureBlack: true, convertPdf: true, tacLimit: 320 };
  const output = await exportDocumentToPdf(project, { pressStandard: 'pdfx4', download: false });
  const pdf = await PDFDocument.load(output.output('arraybuffer'));
  const shadings = pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('Shading'), PDFDict);
  const gradient = shadings.lookup(PDFName.of('RectoShading1'), PDFDict);
  expect(gradient.get(PDFName.of('ColorSpace'))?.toString()).toBe('/DeviceCMYK');
  expect(gradient.get(PDFName.of('ShadingType'))?.toString()).toBe('2');
  const fn = gradient.lookup(PDFName.of('Function'), PDFDict);
  expect(fn.get(PDFName.of('FunctionType'))?.toString()).toBe('3');
  expect(fn.lookup(PDFName.of('Bounds'), PDFArray).get(0)?.toString()).toBe('0.6');
  expect(pdf.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).size()).toBe(1);
  const raster = await createNodePdfRaster(new Uint8Array(output.output('arraybuffer')));
  try {
    const row = await raster.tile(0, 0, 70, 160, 1, 1);
    expect(Array.from(row.subarray(0, 3))).toEqual([255, 255, 255]);
    expect(Array.from(row.subarray(34 * 4, 34 * 4 + 3))).not.toEqual(Array.from(row.subarray(110 * 4, 110 * 4 + 3)));
  } finally { await raster.destroy(); }
}, 60000);

it('reports unsupported Scribus stop opacity instead of silently treating it as opaque', () => {
  const { project, warnings } = parseScribus(scribus.replace('NAME="Cyan" RAMP="0.6"', 'NAME="Cyan" RAMP="0.6" TRANS="0.5"'));
  expect((project.spreads[0].elements[0] as ShapeElement).fillGradient).toBeUndefined();
  expect(warnings.join(' ')).toContain('transparency');
});
