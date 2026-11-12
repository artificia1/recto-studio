import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString, type PDFObject, type PDFPage } from 'pdf-lib';
import { inspectIccHeader, MAX_ICC_BYTES } from '../engine/iccProfiles';
import type { PrinterProfile } from '../engine/printerProfiles';
import { pageResources } from './pdfPress';

const MAX_BYTES = 75 * 1024 * 1024;
const MAX_PAGES = 500;
const MM_PER_POINT = 25.4 / 72;
const boxNames = ['MediaBox', 'CropBox', 'TrimBox', 'BleedBox', 'ArtBox'] as const;
type BoxName = typeof boxNames[number];
type Box = [left: number, bottom: number, right: number, top: number];

interface DeliveryFinding {
  severity: 'error' | 'review';
  message: string;
  page?: number;
}

interface DeliveryPage {
  number: number;
  boxesPt: Partial<Record<BoxName, Box>>;
  rotationDegrees?: number;
  trimSizeMm?: { width: number; height: number };
  bleedMm?: { left: number; bottom: number; right: number; top: number };
}

interface OutputIntent {
  subtype?: string;
  identifier?: string;
  profile?: { sha256: string; version: number; colorSpace: string };
}

interface FontResource {
  name: string;
  subtype?: string;
  embedding: 'embedded' | 'type3-glyphs' | 'missing';
  unicodeMap: boolean;
}

const round = (value: number) => Number(value.toFixed(4));
const named = (object: PDFObject | undefined) => object instanceof PDFName ? object.decodeText() : undefined;
const string = (object: PDFObject | undefined) => object instanceof PDFHexString || object instanceof PDFString
  ? object.decodeText().slice(0, 200) : undefined;
const pointNumber = (object: PDFObject | undefined) => object instanceof PDFNumber ? object.asNumber() : NaN;
const encloses = (outer: Box, inner: Box) => inner[0] >= outer[0] - 0.01 && inner[1] >= outer[1] - 0.01
  && inner[2] <= outer[2] + 0.01 && inner[3] <= outer[3] + 0.01;

async function sha256(data: Uint8Array<ArrayBuffer>) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function inspectPage(pdf: PDFDocument, page: PDFPage, index: number, findings: DeliveryFinding[], printer?: PrinterProfile): DeliveryPage {
  const number = index + 1;
  const boxesPt: DeliveryPage['boxesPt'] = {};
  const add = (severity: DeliveryFinding['severity'], message: string) => findings.push({ severity, page: number, message });
  const unit = page.node.lookup(PDFName.of('UserUnit'));
  const scale = unit === undefined ? 1 : pointNumber(unit);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 75000) {
    add('error', 'The page uses an invalid PDF user-unit scale.');
    return { number, boxesPt };
  }
  for (const key of boxNames) {
    const name = PDFName.of(key);
    const raw = key === 'MediaBox' || key === 'CropBox' ? page.node.getInheritableAttribute(name) : page.node.get(name);
    if (raw === undefined) continue;
    const resolved = pdf.context.lookup(raw);
    const coordinates = resolved instanceof PDFArray && resolved.size() === 4
      ? resolved.asArray().map(value => pointNumber(pdf.context.lookup(value)) * scale) : [];
    const [left, bottom, right, top] = coordinates;
    if (coordinates.length !== 4 || !coordinates.every(Number.isFinite) ||
        !Number.isFinite(right - left) || !Number.isFinite(top - bottom) || right <= left || top <= bottom) {
      add('error', `${key} is invalid or has zero area.`);
      continue;
    }
    boxesPt[key] = [left, bottom, right, top];
  }

  const { MediaBox: media, CropBox: crop, TrimBox: trim, BleedBox: bleed } = boxesPt;
  if (!media) add('error', 'No valid MediaBox was found.');
  if (media) for (const key of boxNames) {
    const box = boxesPt[key];
    if (key !== 'MediaBox' && box && !encloses(media, box)) add('error', `${key} extends beyond the MediaBox.`);
  }
  if (trim && crop && !encloses(crop, trim)) add('review', 'The CropBox clips the TrimBox when the PDF is displayed.');
  if (trim && bleed && !encloses(bleed, trim)) add('error', 'The BleedBox does not enclose the TrimBox.');

  const rotation = pointNumber(pdf.context.lookup(page.node.getInheritableAttribute(PDFName.of('Rotate'))));
  const rotationDegrees = Number.isFinite(rotation) ? (rotation % 360 + 360) % 360 : 0;
  const turn = rotationDegrees === 90 || rotationDegrees === 270;
  const trimSize = trim && [(trim[2] - trim[0]) * MM_PER_POINT, (trim[3] - trim[1]) * MM_PER_POINT];
  const trimSizeMm = trimSize && { width: round(trimSize[turn ? 1 : 0]), height: round(trimSize[turn ? 0 : 1]) };
  const bleedMm = trim && bleed && encloses(bleed, trim) ? {
    left: round(Math.max(0, trim[0] - bleed[0]) * MM_PER_POINT),
    bottom: round(Math.max(0, trim[1] - bleed[1]) * MM_PER_POINT),
    right: round(Math.max(0, bleed[2] - trim[2]) * MM_PER_POINT),
    top: round(Math.max(0, bleed[3] - trim[3]) * MM_PER_POINT),
  } : undefined;

  if (printer && printer.bleedMm > 0) {
    if (!bleedMm || !bleed || !media || !encloses(media, bleed)) {
      add('error', `Valid MediaBox, TrimBox and BleedBox entries are required to verify ${printer.bleedMm} mm of bleed.`);
    } else {
      const minimum = Math.min(...Object.values(bleedMm));
      if (minimum + 0.01 < printer.bleedMm) add('error', `Minimum bleed is ${minimum} mm. ${printer.name} requires ${printer.bleedMm} mm on each edge.`);
    }
  }
  return { number, boxesPt, rotationDegrees, trimSizeMm, bleedMm };
}

function inspectFonts(pdf: PDFDocument): FontResource[] {
  const found = new Map<PDFDict, FontResource>();
  for (const resources of pageResources(pdf)) {
    if (!(resources instanceof PDFDict)) continue;
    const dictionary = resources.lookup(PDFName.of('Font'));
    if (!(dictionary instanceof PDFDict)) continue;
    for (const [key, ref] of dictionary.entries()) {
      const font = pdf.context.lookup(ref);
      if (!(font instanceof PDFDict) || found.has(font)) continue;
      const descendants = font.lookup(PDFName.of('DescendantFonts'));
      const descendant = descendants instanceof PDFArray && descendants.size() ? descendants.lookup(0) : undefined;
      const actual = descendant instanceof PDFDict ? descendant : font;
      const subtype = named(actual.lookup(PDFName.of('Subtype')));
      const descriptor = actual.lookup(PDFName.of('FontDescriptor'));
      const embedded = descriptor instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some(key => {
        const program = descriptor.lookup(PDFName.of(key));
        return program instanceof PDFRawStream && program.getContentsSize() > 0;
      });
      const glyphs = subtype === 'Type3' ? actual.lookup(PDFName.of('CharProcs')) : undefined;
      const cmap = font.lookup(PDFName.of('ToUnicode'));
      found.set(font, {
        name: (named(font.lookup(PDFName.of('BaseFont'))) || named(actual.lookup(PDFName.of('BaseFont'))) || key.decodeText()).slice(0, 200),
        subtype,
        embedding: embedded ? 'embedded' : glyphs instanceof PDFDict && glyphs.keys().length ? 'type3-glyphs' : 'missing',
        unicodeMap: cmap instanceof PDFRawStream && cmap.getContentsSize() > 0,
      });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function readIccStream(stream: PDFRawStream) {
  const stored = stream.getContents();
  const filter = stream.dict.lookup(PDFName.of('Filter'));
  if (stored.byteLength > MAX_ICC_BYTES) throw new Error('The output profile stream is too large.');
  if (filter === undefined) return new Uint8Array(stored);
  const algorithm = named(filter instanceof PDFArray && filter.size() === 1 ? filter.lookup(0) : filter);
  const parameters = stream.dict.lookup(PDFName.of('DecodeParms'));
  if (algorithm !== 'FlateDecode' || parameters !== undefined) throw new Error('Unsupported output profile compression.');

  const reader = new Blob([new Uint8Array(stored)]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_ICC_BYTES) {
        await reader.cancel();
        throw new Error('The expanded output profile is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function inspectOutputIntents(pdf: PDFDocument, findings: DeliveryFinding[]) {
  const list = pdf.catalog.lookup(PDFName.of('OutputIntents'));
  const intents: OutputIntent[] = [];
  if (list === undefined) return intents;
  if (!(list instanceof PDFArray) || list.size() > 32) {
    findings.push({ severity: 'review', message: 'The output intent list is invalid or exceeds the inspection limit.' });
    return intents;
  }
  const seen = new Map<PDFRawStream, OutputIntent['profile']>();
  for (let index = 0; index < list.size(); index++) {
    const intent = list.lookup(index);
    if (!(intent instanceof PDFDict)) {
      findings.push({ severity: 'review', message: `Output intent ${index + 1} is invalid.` });
      continue;
    }
    const subtype = named(intent.lookup(PDFName.of('S')));
    const identifier = string(intent.lookup(PDFName.of('OutputConditionIdentifier')));
    const stream = intent.lookup(PDFName.of('DestOutputProfile'));
    let profile: OutputIntent['profile'];
    if (stream instanceof PDFRawStream) {
      if (!seen.has(stream)) {
        try {
          const bytes = await readIccStream(stream);
          const header = inspectIccHeader(bytes);
          const channels = pointNumber(stream.dict.lookup(PDFName.of('N')));
          if (channels !== (header.colorSpace === 'CMYK' ? 4 : 3)) throw new Error('Invalid ICC channel count.');
          seen.set(stream, { sha256: await sha256(bytes), version: header.version, colorSpace: header.colorSpace.trim() });
        } catch {
          seen.set(stream, undefined);
        }
      }
      profile = seen.get(stream);
    }
    if (!profile) findings.push({ severity: 'review', message: `No readable embedded ICC profile was found in output intent ${index + 1}.` });
    intents.push({ subtype, identifier, profile });
  }
  return intents;
}

export async function inspectDeliveryPdf(file: File, printer?: PrinterProfile) {
  if (file.size > MAX_BYTES) throw new Error('Choose a delivery PDF up to 75 MiB.');
  const data = new Uint8Array(await file.arrayBuffer());
  const decoder = new TextDecoder();
  const version = decoder.decode(data.subarray(0, 1024)).match(/%PDF-(\d\.\d)/)?.[1];
  if (!version || !/%%EOF[\x00\t\f\r\n ]*$/.test(decoder.decode(data.subarray(-1024)))) {
    throw new Error('Choose a complete PDF file.');
  }
  let pdf: PDFDocument;
  let pdfPages: PDFPage[];
  try {
    pdf = await PDFDocument.load(data, { updateMetadata: false, throwOnInvalidObject: true });
    pdfPages = pdf.getPages();
  } catch {
    throw new Error('Could not read this PDF. Choose a complete, unlocked copy.');
  }
  if (!pdfPages.length || pdfPages.length > MAX_PAGES) throw new Error('Delivery inspection supports PDFs with 1 to 500 pages.');
  const findings: DeliveryFinding[] = [];
  const pages = pdfPages.map((page, index) => inspectPage(pdf, page, index, findings, printer));
  const fonts = inspectFonts(pdf);
  const unembedded = fonts.filter(font => font.embedding === 'missing').length;
  if (unembedded) findings.push({ severity: 'review', message: `${unembedded} of ${fonts.length} font resources have no embedded program.` });
  const outputIntents = await inspectOutputIntents(pdf, findings);
  const requiredProfile = printer?.iccId?.toLowerCase();
  if (printer && requiredProfile) {
    if (!outputIntents.some(intent => intent.profile?.sha256 === requiredProfile)) {
      findings.push({ severity: 'error', message: `The PDF does not embed the required output ICC profile for ${printer.name}.` });
    } else if (outputIntents.some(intent => intent.profile?.sha256 !== requiredProfile)) {
      findings.push({ severity: 'review', message: 'The required ICC profile is present alongside other output intents. Confirm the intended output condition with the printer.' });
    }
  }

  return {
    format: 'recto-pdf-delivery-report',
    version: 1,
    source: { name: file.name, sizeBytes: data.byteLength, sha256: await sha256(data), pdfHeaderVersion: version,
      pdfCatalogVersion: named(pdf.catalog.lookup(PDFName.of('Version'))) },
    printer: printer && { name: printer.name, minimumBleedMm: printer.bleedMm, iccSha256: printer.iccId },
    pages, outputIntents, fonts, tagged: pdf.catalog.lookup(PDFName.of('StructTreeRoot')) instanceof PDFDict,
    findings,
    unchecked: ['Rendered appearance and artwork bleed', 'Effective image resolution', 'Total ink coverage', 'PDF standards conformance'],
  };
}

export type PdfDeliveryReport = Awaited<ReturnType<typeof inspectDeliveryPdf>>;
