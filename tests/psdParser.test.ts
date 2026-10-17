import { describe, it, expect } from 'vitest';
import { writePsdBuffer } from 'ag-psd';
import { psdEngine } from '../src/engine/psdParser';
import { stateManager } from '../src/state';
import { ImageElement } from '../src/types';

describe('Native Layered .psd Frame Parsing (ag-psd)', () => {
  it('parses in-memory multi-layer Photoshop files without flattening', () => {
    const mockPsd = {
      width: 400,
      height: 300,
      children: [
        { name: 'Background Art', hidden: false, opacity: 1, left: 0, top: 0, right: 400, bottom: 300 },
        { name: 'Product Cutout', hidden: false, opacity: 0.9, left: 50, top: 50, right: 350, bottom: 250 },
        { name: 'Headline Overlay', hidden: true, opacity: 1, left: 20, top: 20, right: 200, bottom: 80 },
      ],
    };

    const psdBuf = writePsdBuffer(mockPsd as any);
    const parsed = psdEngine.parse(psdBuf);

    expect(parsed.width).toBe(400);
    expect(parsed.height).toBe(300);
    expect(parsed.layers.length).toBe(3);
    expect(parsed.layers[0].name).toBe('Background Art');
    expect(parsed.layers[0].visible).toBe(true);
    expect(parsed.layers[2].name).toBe('Headline Overlay');
    expect(parsed.layers[2].visible).toBe(false);
  });

  it('binds PSD layers to an ImageElement and toggles layer visibility', () => {
    const page = stateManager.getState().spreads[0].pages[0];
    const imageEl: ImageElement = {
      id: 'test-psd-frame',
      type: 'image',
      pageId: page.id,
      x: 10,
      y: 10,
      width: 80,
      height: 60,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      locked: false,
      src: '',
      fitMode: 'fill',
      borderColor: 'transparent',
      borderWidthMm: 0,
    };

    stateManager.addElement(imageEl);

    const mockPsd = {
      width: 200,
      height: 150,
      children: [
        { name: 'Base Layer', hidden: false, opacity: 1, left: 0, top: 0, right: 200, bottom: 150 },
        { name: 'Foreground Badge', hidden: false, opacity: 1, left: 10, top: 10, right: 100, bottom: 100 },
      ],
    };
    const psdBuf = writePsdBuffer(mockPsd as any);

    const loaded = stateManager.loadPsdForElement(imageEl.id, psdBuf, 'catalog.psd');
    expect(loaded).toBe(true);

    const updatedEl = stateManager.getElementById(imageEl.id) as ImageElement;
    expect(updatedEl.isPsd).toBe(true);
    expect(updatedEl.psdLayers?.length).toBe(2);

    // Toggle layer 2 visibility off
    const toggled = stateManager.togglePsdLayer(imageEl.id, 2, false);
    expect(toggled).toBe(true);
    const afterToggle = stateManager.getElementById(imageEl.id) as ImageElement;
    const layer2 = afterToggle.psdLayers?.find((l) => l.id === 2);
    expect(layer2?.visible).toBe(false);

    stateManager.deleteElement(imageEl.id);
  });
});
