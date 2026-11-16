import { PDFDocument, type PDFEmbeddedPage } from 'pdf-lib';
import type { ImpositionPlan } from './impositionEngine';
import { serializePdf } from './pdfWriter';

/** Put the canonical interior's vector pages in printer order for review. */
export async function exportSignatureSheetProof(interior: PDFDocument, plan: ImpositionPlan) {
  const output = await PDFDocument.create();
  output.setTitle('Signature sheet proof');
  const mmToPoint = 72 / 25.4;
  const panelWidth = plan.pageWidthMm * mmToPoint;
  const sheetWidth = plan.sheetWidthMm * mmToPoint;
  const sheetHeight = plan.sheetHeightMm * mmToPoint;
  const pages = interior.getPages();
  const panels = new Map<number, PDFEmbeddedPage>();
  for (const side of plan.sheetSides) {
    const sheet = output.addPage([sheetWidth, sheetHeight]);
    for (const [number, x] of [[side.leftPageNumber, 0], [side.rightPageNumber, panelWidth]] as const) {
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
      sheet.drawPage(panel, { x, y: 0, width: panelWidth, height: sheetHeight });
    }
  }
  return serializePdf(output, true);
}
