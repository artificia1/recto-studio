import type { jsPDF } from 'jspdf';
import type { PDFDocument } from 'pdf-lib';
import { PDFDict, PDFName } from 'pdf-lib';
import type { FillGradient } from '../types';
import { gradientCoordinates } from '../engine/fillGradients';
import { documentColor } from './pdfColors';

interface Shading {
  page: number;
  name: string;
  type: 2 | 3;
  coordinates: number[];
  stops: { offset: number; ink: number[] }[];
}
const shadings = new WeakMap<jsPDF, Shading[]>();

export function hasPdfGradients(doc: jsPDF) { return !!shadings.get(doc)?.length; }

export function drawPdfGradient(doc: jsPDF, gradient: FillGradient, x: number, y: number, width: number, height: number, path: () => void) {
  const records = shadings.get(doc) || [];
  const name = 'RectoShading' + (records.length + 1);
  const { x1, y1, x2, y2, radius } = gradientCoordinates(gradient, x, y, width, height);
  const internal = doc.internal as typeof doc.internal & { write(value: string): void; getVerticalCoordinateString(value: number): string };
  const scale = internal.scaleFactor;
  const start = [x1 * scale, Number(internal.getVerticalCoordinateString(y1))];
  const end = [x2 * scale, Number(internal.getVerticalCoordinateString(y2))];
  const radial = gradient.kind === 'radial';
  const stops = gradient.stops.map(stop => ({ offset: stop.offset, ink: documentColor(doc, stop.color).map(value => value / 100) }));
  if (stops[0].offset > 0) stops.unshift({ ...stops[0], offset: 0 });
  if (stops.at(-1)!.offset < 1) stops.push({ ...stops.at(-1)!, offset: 1 });
  const coordinates = radial ? [...start, 0, ...start, Math.max(0.001, radius * scale)] : [...start, ...end];
  if (!radial && coordinates[0] === coordinates[2] && coordinates[1] === coordinates[3]) coordinates[2] += 0.001;
  records.push({ page: doc.getNumberOfPages(), name, type: radial ? 3 : 2, coordinates, stops });
  shadings.set(doc, records);
  doc.saveGraphicsState();
  path();
  doc.clip();
  doc.discardPath();
  internal.write('/' + name + ' sh');
  doc.restoreGraphicsState();
}

export function installPdfGradients(doc: jsPDF, pdf: PDFDocument) {
  const { context } = pdf;
  const pages = pdf.getPages();
  const key = PDFName.of('Shading');
  // jsPDF can share one resources dictionary across pages. Each entry has a unique name.
  for (const item of shadings.get(doc) || []) {
    const resources = pages[item.page - 1].node.Resources()!;
    let entries = resources.lookupMaybe(key, PDFDict);
    if (!entries) { entries = context.obj({}); resources.set(key, entries); }
    const functions = item.stops.slice(1).map((stop, index) =>
      context.register(context.obj({ FunctionType: 2, Domain: [0, 1], C0: item.stops[index].ink, C1: stop.ink, N: 1 })));
    const fn = functions.length === 1 ? functions[0] : context.register(context.obj({
      FunctionType: 3, Domain: [0, 1], Functions: functions, Bounds: item.stops.slice(1, -1).map(stop => stop.offset),
      Encode: functions.flatMap(() => [0, 1]),
    }));
    entries.set(PDFName.of(item.name), context.register(context.obj({
      ShadingType: item.type, ColorSpace: 'DeviceCMYK', Coords: item.coordinates, Function: fn, Extend: [true, true],
    })));
  }
}
