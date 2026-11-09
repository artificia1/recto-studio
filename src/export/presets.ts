import type { ExportOptions } from './pdfExport';

export const PDF_PRESETS = {
  screen: { label: 'Tagged screen PDF', description: 'Compact pages with a reading-order structure tree. Requires accessibility review; PDF/UA certification is not claimed.', options: { tagged: true, compress: true, includeBleed: false, includeCropMarks: false } },
  accessible: { label: 'Accessible PDF/UA-1', description: 'Semantic headings, lists, notes, images and tables with embedded static TTF fonts. Requires content-sized tables, image descriptions and a human reading-order review. Interactive annotations are not supported.', options: { accessibility: 'pdfua1', compress: true, includeBleed: false, includeCropMarks: false } },
  print: { label: 'Desktop printing', description: 'Trim-sized pages for office printers.', options: { compress: true, includeBleed: false, includeCropMarks: false, overprintBlack: false } },
  press: { label: 'Printer review', description: 'Bleed, crop marks and strict publication checks. Send to your printer for approval.', options: { compress: true, includeBleed: true, includeCropMarks: true, strict: true } },
  flattened: { label: 'Flattened CMYK print PDF', description: '300 dpi transparency regions with vectors retained elsewhere. Requires an imported CMYK ICC profile and embedded fonts. Independent PDF/X validation is still required.', options: { transparency: 'flatten', flattenDpi: 300, compress: true, includeBleed: true, includeCropMarks: false, strict: true } },
  pdfx1a: { label: 'PDF/X-1a:2003 candidate', description: 'Flattened CMYK edition with PDF/X identification and embedded ICC v2 output profile. Requires embedded fonts. Must pass independent ISO preflight and printer approval; GWG certification is not claimed.', options: { pressStandard: 'pdfx1a-2003', flattenDpi: 300, compress: true, includeBleed: true, includeCropMarks: false } },
  pdfx4: { label: 'PDF/X-4 candidate', description: 'CMYK print edition preserving live transparency with an embedded output profile. Requires embedded fonts. Must pass independent ISO preflight and printer approval; GWG certification is not claimed.', options: { pressStandard: 'pdfx4', compress: true, includeBleed: true, includeCropMarks: false } },
} satisfies Record<string, { label: string; description: string; options: ExportOptions }>;
export type PdfPreset = keyof typeof PDF_PRESETS;
