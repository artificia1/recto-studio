import { readFileSync } from 'node:fs';
import { StateManager } from '../../src/state/stateManager';
import { fontManager } from '../../src/fontManager';
import { mergeTableCellDown } from '../../src/engine/tableCells';
import type { TextElement, TableElement } from '../../src/types';

export async function accessiblePublication() {
  const family = await fontManager.registerFontBuffer('OpenSans-Regular.ttf', readFileSync('tests/fixtures/fonts/OpenSans-Regular.ttf'));
  const manager = new StateManager(); manager.createBlankProject('A4', 'Accessible editorial publication', false);
  const state = manager.getState(); state.embeddedFonts = fontManager.getFontAssets(); state.settings.language = 'en-US';
  state.paragraphStyles.push({ ...state.paragraphStyles[0], id: 'ua-heading', name: 'Heading', fontFamily: family, pdfTag: 'H1', fontSizePt: 18 });
  state.paragraphStyles.push({ ...state.paragraphStyles[0], id: 'ua-list', name: 'List', fontFamily: family, pdfTag: 'LI' });
  const pageId = manager.getActiveSpread().pages[0].id;
  const body: TextElement = { id: 'body', type: 'text', pageId, x: 15, y: 15, width: 175, height: 100, rotation: 0, opacity: 1, locked: false, zIndex: 1, text: '',
    fontFamily: family, fontSizePt: 11, lineHeight: 1.4, letterSpacingPt: 0, color: '#111111', alignment: 'left', columns: 2, columnGutterMm: 6,
    paddingMm: 0, backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0 };
  manager.addElement(body);
  manager.setStoryContent('body', { version: 1, paragraphs: [{ styleId: 'ua-heading', runs: [{ text: 'Accessible publishing' }] },
    { runs: [{ text: 'A publication with Unicode text: café, naïve, and readable copy.' }] },
    { styleId: 'ua-list', runs: [{ text: '• First list item' }] }, { styleId: 'ua-list', runs: [{ text: '• Second list item' }] }] });
  const table: TableElement = { id: 'table', type: 'table', pageId, x: 15, y: 135, width: 175, height: 65, rotation: 0, opacity: 1, locked: false, zIndex: 2,
    rows: 3, cols: 2, rowSizing: 'content', cells: mergeTableCellDown([[{ text: 'Category' }, { text: 'Amount' }], [{ text: 'Group A' }, { text: '100' }], [{ text: 'Group B' }, { text: '200' }]], 1, 0),
    headerRowCount: 1, headerFillColor: '#222222', headerTextColor: '#ffffff', borderColor: '#333333', borderWidthMm: 0.2,
    cellPaddingMm: 2, fontFamily: family, fontSizePt: 10 };
  manager.addElement(table);
  return { manager, family, body, table };
}
