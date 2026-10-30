import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { INITIAL_STATE } from '../src/state/defaults';
import { fontManager } from '../src/fontManager';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import { exportDocumentToEpub } from '../src/epubExport';
import { packageDocument } from '../src/packageExport';
import type { TextElement } from '../src/types';

describe('Publication export fixtures', () => {
  it('writes portrait/landscape PDFs and a custom-font EPUB for independent validation', async () => {
    const state = structuredClone(INITIAL_STATE);
    state.settings.title = 'Publication validation';
    state.masterSpreads = [];
    state.spreads = [state.spreads[0]];
    state.spreads[0].pages = [state.spreads[0].pages[0]];
    const pageId = state.spreads[0].pages[0].id;
    const text = state.spreads[0].elements.find(element => element.type === 'text') as TextElement;
    Object.assign(text, { pageId, x: 20, y: 20, width: 160, height: 35, text: 'Studio export validation', fontFamily: 'Times', fontSizePt: 20, color: '#111111' });
    const family = await fontManager.registerFontBuffer('SourceSansPro-Regular.woff2', readFileSync('tests/fixtures/fonts/SourceSansPro-Regular.woff2'));
    state.embeddedFonts = fontManager.getFontAssets();
    state.spreads[0].elements = [text, { ...text, id: 'custom-font', y: 65, text: 'Custom font sample', fontFamily: family }, {
      id: 'export-shape', type: 'shape', pageId, x: 20, y: 110, width: 60, height: 25,
      rotation: 0, opacity: 1, zIndex: 3, locked: false, shapeKind: 'rectangle', fillColor: '#336699', strokeColor: '#111111', strokeWidthMm: 0.3,
    }];
    const folder = 'test-results/export-validation';
    mkdirSync(folder, { recursive: true });
    for (const landscape of [false, true]) {
      state.settings.widthMm = landscape ? 297 : 210;
      state.settings.heightMm = landscape ? 210 : 297;
      for (const print of [false, true]) {
        const pdf = await exportDocumentToPdf(state, {
          download: false, includeBleed: print, includeCropMarks: print,
          includeRegistrationMarks: print, includeColorBars: print,
          overprintBlack: print,
        });
        expect(pdf.getNumberOfPages()).toBe(1);
        writeFileSync(`${folder}/${landscape ? 'landscape' : 'portrait'}-${print ? 'print' : 'clean'}.pdf`, new Uint8Array(pdf.output('arraybuffer')));
      }
    }
    const { buffer } = exportDocumentToEpub(state, { download: false });
    expect(new TextDecoder().decode(buffer.subarray(30, 38))).toBe('mimetype');
    expect(new DataView(buffer.buffer, buffer.byteOffset).getUint16(8, true)).toBe(0);
    writeFileSync(`${folder}/publication.epub`, buffer);
    const packaged = await packageDocument(state, { download: false });
    writeFileSync(`${folder}/publication.zip`, packaged.buffer);
  });
});
