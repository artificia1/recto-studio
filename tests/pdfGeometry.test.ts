import { describe, it, expect } from 'vitest';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import { stateManager } from '../src/state/stateManager';
import fs from 'fs';

describe('PDF Export Vector Geometry & Print Slug Calculations', () => {
  it('computes print-ready page dimensions with bleed and slug geometry', async () => {
    stateManager.resetToDefault();
    const state = stateManager.getState();
    const { widthMm, heightMm, bleedMm } = state.settings;

    // A4 dimensions: 210 x 297 mm
    expect(widthMm).toBe(210);
    expect(heightMm).toBe(297);
    expect(bleedMm).toBe(3);

    const slugMm = 14;
    const expectedExportWidth = widthMm + bleedMm * 2 + slugMm * 2; // 210 + 6 + 24 = 240 mm
    const expectedExportHeight = heightMm + bleedMm * 2 + slugMm * 2; // 297 + 6 + 24 = 327 mm

    expect(expectedExportWidth).toBe(244);
    expect(expectedExportHeight).toBe(331);

    // Export single spread
    const doc = await exportDocumentToPdf(state, {
      includeBleed: true,
      includeCropMarks: true,
      includeRegistrationMarks: true,
      includeColorBars: true,
      spreadRange: [0],
      download: false,
    });

    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBe(state.spreads[0].pages.length);

    // Verify PDF raw bytes contain PDF header and trailer
    const outputStr = doc.output();
    expect(outputStr.startsWith('%PDF-')).toBe(true);
    expect(outputStr.includes('trailer')).toBe(true);
    expect(outputStr.includes('%%EOF')).toBe(true);

    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(expectedExportWidth);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(expectedExportHeight);
    expect(outputStr).toContain('/TrimBox');
    expect(outputStr).toContain('/BleedBox');
    expect(outputStr).not.toContain('/MarkInfo');
    expect(outputStr).not.toContain('/GTS_PDFX');
    expect(outputStr.includes('/Lang (en-US)')).toBe(true);

    // Clean up temporary generated file if saved to disk
    const filename = `${state.settings.title.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'recto-document'}.pdf`;
    if (fs.existsSync(filename)) {
      fs.unlinkSync(filename);
    }
  });

  it('correctly calculates bleed-free trimmed dimensions when marks and bleed are disabled', async () => {
    stateManager.resetToDefault();
    const state = stateManager.getState();
    const { widthMm, heightMm } = state.settings;

    // When bleed and marks are excluded, output width/height exactly equal trim size
    const doc = await exportDocumentToPdf(state, {
      includeBleed: false,
      includeCropMarks: false,
      includeRegistrationMarks: false,
      includeColorBars: false,
      spreadRange: [0],
      download: false,
    });

    expect(doc).toBeDefined();
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(widthMm);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(heightMm);

    // Clean up temporary generated file
    const filename = `${state.settings.title.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'recto-document'}.pdf`;
    if (fs.existsSync(filename)) {
      fs.unlinkSync(filename);
    }
  });
});
