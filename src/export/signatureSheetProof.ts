import { degrees, PDFDocument, rgb, StandardFonts, type PDFEmbeddedPage } from 'pdf-lib';
import type { ImpositionOptions, ImpositionPlan } from './impositionEngine';
import { serializePdf } from './pdfWriter';

/** Put the canonical interior's vector pages in printer order for review. */
export async function exportSignatureSheetProof(interior: PDFDocument, plan: ImpositionPlan, options?: ImpositionOptions) {
  const output = await PDFDocument.create();
  output.setTitle('Signature sheet proof');
  const mmToPoint = 72 / 25.4;
  const panelWidth = plan.pageWidthMm * mmToPoint;
  const panelHeight = plan.pageHeightMm * mmToPoint;
  const sheetWidth = plan.sheetWidthMm * mmToPoint;
  const sheetHeight = plan.sheetHeightMm * mmToPoint;
  const slug = options && options.includeCutMarks !== false ? 12 * mmToPoint : 0;
  const font = slug && options?.includeSheetMetadata !== false ? await output.embedFont(StandardFonts.Helvetica) : undefined;
  const pages = interior.getPages();
  const panels = new Map<number, PDFEmbeddedPage>();
  for (const side of plan.sheetSides) {
    const sheet = output.addPage([sheetWidth + 2 * slug, sheetHeight + 2 * slug]);
    sheet.setTrimBox(slug, slug, sheetWidth, sheetHeight);
    const positions = side.panels
      ? side.panels.map((number, index) => ({ number, x: index % 4 * panelWidth, y: index < 4 ? panelHeight : 0, inverted: index < 4 }))
      : [{ number: side.leftPageNumber, x: side.leftCreepMm * mmToPoint, y: 0, inverted: false },
        { number: side.rightPageNumber, x: panelWidth + side.rightCreepMm * mmToPoint, y: 0, inverted: false }];
    for (const { number, x, y, inverted } of positions) {
      if (number === null) continue;
      let panel = panels.get(number);
      if (!panel) {
        const original = pages[number - 1];
        if (!original) throw new Error('The signature plan references a missing page.');
        const trim = original.getTrimBox();
        panel = await output.embedPage(original, {
          left: trim.x, bottom: trim.y, right: trim.x + trim.width, top: trim.y + trim.height,
        });
        panels.set(number, panel);
      }
      sheet.drawPage(panel, { x: slug + x + (inverted ? panelWidth : 0), y: slug + y + (inverted ? panelHeight : 0),
        width: panelWidth, height: panelHeight, ...(inverted ? { rotate: degrees(180) } : {}) });
    }
    if (slug) {
      const line = (x0: number, y0: number, x1: number, y1: number, dashed = false) => sheet.drawLine({
        start: { x: slug + x0, y: slug + y0 }, end: { x: slug + x1, y: slug + y1 },
        thickness: 0.35, color: rgb(0.35, 0.35, 0.35), ...(dashed ? { dashArray: [2, 2] } : {}),
      });
      for (const x of [0, sheetWidth]) for (const y of [0, sheetHeight]) {
        const sx = x ? 1 : -1, sy = y ? 1 : -1;
        line(x + 3 * sx, y, x + 14 * sx, y);
        line(x, y + 3 * sy, x, y + 14 * sy);
      }
      if (options?.includeFoldLine !== false) {
        if (side.panels) {
          for (let column = 1; column <= 3; column++) line(column * panelWidth, 0, column * panelWidth, sheetHeight, true);
          line(0, panelHeight, panelWidth, panelHeight, true);
          line(3 * panelWidth, panelHeight, sheetWidth, panelHeight, true);
          line(panelWidth, panelHeight, 3 * panelWidth, panelHeight);
        } else line(panelWidth, -14, panelWidth, -3, true);
      }
      if (font) sheet.drawText(`Sheet ${side.sheetIndex + 1} / ${plan.sheetsCount} | ${side.side.toUpperCase()}` +
        (side.panels ? ' | Dashed: fold. Solid center: slit.' : ''), { x: slug, y: slug + sheetHeight + 11, size: 7, font });
    }
  }
  return serializePdf(output, true);
}
