import type { ExportOptions } from './pdfExport';

export const PDF_PRESETS = {
  screen: { label: 'Tagged screen PDF', description: 'Compact pages with a reading-order structure tree. Requires accessibility review; PDF/UA certification is not claimed.', options: { tagged: true, compress: true, includeBleed: false, includeCropMarks: false } },
  print: { label: 'Desktop printing', description: 'Trim-sized pages for office printers.', options: { compress: true, includeBleed: false, includeCropMarks: false, overprintBlack: false } },
  press: { label: 'Printer review', description: 'Bleed, crop marks and strict publication checks. Send to your printer for approval.', options: { compress: true, includeBleed: true, includeCropMarks: true, strict: true } },
} satisfies Record<string, { label: string; description: string; options: ExportOptions }>;
export type PdfPreset = keyof typeof PDF_PRESETS;
