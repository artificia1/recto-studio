import { describe, expect, it } from 'vitest';
import { INITIAL_STATE } from '../src/state/defaults';
import { parseProject } from '../src/state/projectValidation';
import { generateEpubPackage } from '../src/epubExport';
import { renderEquation } from '../src/engine/equations';
import { StateManager } from '../src/state/stateManager';
import type { ImageElement } from '../src/types';

function fixture() {
  const state = structuredClone(INITIAL_STATE);
  const equation = { latex: 'x^2', fontSizePt: 18, color: '#111111', displayMode: true };
  const rendered = renderEquation(equation);
  const image: ImageElement = {
    id: 'test-equation', pageId: state.spreads[0].pages[0].id, type: 'image', x: 25, y: 25,
    width: rendered.widthMm, height: rendered.heightMm, rotation: 0, opacity: 1, zIndex: 1, locked: false,
    src: rendered.dataUrl, equation, fitMode: 'fit', borderColor: 'transparent', borderWidthMm: 0,
    altText: 'x squared', originalWidth: 10, originalHeight: 10,
  };
  state.spreads[0].elements = [image];
  state.masterSpreads = [];
  return { state, image };
}

describe('equations in publications', () => {
  it('preserves editable math when a project is reopened and rejects malformed metadata', () => {
    const { state, image } = fixture();
    expect(parseProject(JSON.stringify(state), INITIAL_STATE).spreads[0].elements[0]).toMatchObject(image);
    image.equation!.fontSizePt = -1;
    expect(() => parseProject(JSON.stringify(state), INITIAL_STATE)).toThrow(/fontSizePt/);
  });
  it('packages equation SVGs and their accessible descriptions in EPUB', () => {
    const { state } = fixture();
    const files = generateEpubPackage(state);
    expect(files['OEBPS/package.opf']).toContain('href="images/equation-1.svg" media-type="image/svg+xml"');
    expect(new TextDecoder().decode(files['OEBPS/images/equation-1.svg'] as Uint8Array)).toContain('<path');
    const page = Object.values(files).find(value => typeof value === 'string' && value.includes('<figure>')) as string;
    expect(page).toContain('alt="x squared"');
    expect(page).toContain('src="images/equation-1.svg"');
  });
  it('clears equation source on image replacement and restores it with undo', () => {
    const { state, image } = fixture();
    const manager = new StateManager();
    manager.createBlankProject('A4', 'Equations');
    manager.addElement({ ...image, pageId: manager.getActiveSpread().pages[0].id });
    manager.updateElement(image.id, { src: 'data:image/png;base64,AA==' });
    expect((manager.getElementById(image.id) as ImageElement).equation).toBeUndefined();
    manager.undo();
    expect((manager.getElementById(image.id) as ImageElement).equation).toEqual(image.equation);
  });
  it('does not report SVG math as low resolution', () => {
    const { state, image } = fixture();
    const manager = new StateManager();
    manager.createBlankProject('A4', 'Equations');
    manager.addElement({ ...image, pageId: manager.getActiveSpread().pages[0].id });
    expect(manager.getAssetLinks().find(link => link.elementId === image.id)?.isLowRes).toBe(false);
  });
});
