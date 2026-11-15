import { describe, it, expect } from 'vitest';
import { colorToCmyk, exportDocumentToPdf } from '../src/export/pdfExport';
import { StateManager } from '../src/state/stateManager';
import { TextElement } from '../src/types';

describe('Pure Vector DeviceCMYK Operators & 100% K Black Plate', () => {
  it('implements the Pure Black Golden Rule mapping black strictly to 100% K (0, 0, 0, 100)', () => {
    expect(colorToCmyk('#000000')).toEqual([0, 0, 0, 100]);
    expect(colorToCmyk('#000')).toEqual([0, 0, 0, 100]);
    expect(colorToCmyk('black')).toEqual([0, 0, 0, 100]);
    expect(colorToCmyk('rgb(0,0,0)')).toEqual([0, 0, 0, 100]);
    expect(colorToCmyk('#ffffff')).toEqual([0, 0, 0, 0]);
  });

  it('accurately converts primary and secondary process colors to CMYK', () => {
    // Pure Cyan
    expect(colorToCmyk('#00ffff')).toEqual([100, 0, 0, 0]);
    // Pure Magenta
    expect(colorToCmyk('#ff00ff')).toEqual([0, 100, 0, 0]);
    // Pure Yellow
    expect(colorToCmyk('#ffff00')).toEqual([0, 0, 100, 0]);
  });

  it('emits PostScript DeviceCMYK "k" and "K" operators into PDF stream', async () => {
    const manager = new StateManager();
    manager.createBlankProject('A4', 'Process ink test', false);
    const page = manager.getActiveSpread().pages[0];
    const textEl: TextElement = {
      id: 'test-cmyk-body-text',
      type: 'text',
      pageId: page.id,
      x: 20,
      y: 20,
      width: 100,
      height: 40,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      locked: false,
      text: 'Commercial offset press body text must be pure black.',
      fontFamily: 'Inter',
      fontSizePt: 11,
      lineHeight: 1.3,
      letterSpacingPt: 0,
      color: '#000000',
      alignment: 'left',
      columns: 1,
      columnGutterMm: 4,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderWidthMm: 0,
      paddingMm: 2,
    };

    manager.addElement(textEl);

    const doc = await exportDocumentToPdf(manager.getState(), {
      includeCropMarks: true,
      includeRegistrationMarks: true,
      includeColorBars: true,
      spreadRange: 'current',
      compress: false,
      download: false,
      fetchExternalAssets: false,
    });

    const pdfOutput = doc.output();

    // Verify presence of DeviceCMYK operators
    const hasCmykFill = pdfOutput.includes(' k\n') || pdfOutput.includes(' k ');
    const hasCmykStroke = pdfOutput.includes(' K\n') || pdfOutput.includes(' K ');
    const hasPureKText = /0\.?0* 0\.?0* 0\.?0* 1\.?0* k/.test(pdfOutput);

    expect(hasCmykFill).toBe(true);
    expect(hasCmykStroke).toBe(true);
    expect(hasPureKText).toBe(true);
  });
});
