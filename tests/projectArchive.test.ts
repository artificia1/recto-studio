import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { assetStore } from '../src/engine/assetStore';
import { neutralAdjustments } from '../src/engine/imageAdjustments';
import { createProjectArchive, readProjectArchive } from '../src/engine/projectArchive';
import { publicationSnapshot } from '../src/engine/publicationReferences';
import { StateManager } from '../src/state/stateManager';
import type { ImageElement, TextElement } from '../src/types';
import { createZipArchive, readZip } from '../src/zip';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function blankProject() {
  const manager = new StateManager();
  manager.createBlankProject('A4', 'Editorial archive', false);
  return manager;
}

function imageFrame(id: string, pageId: string, src: string): ImageElement {
  return {
    id, type: 'image', pageId, src, x: 20, y: 20, width: 80, height: 60, rotation: 0,
    opacity: 1, locked: false, zIndex: 1, fitMode: 'fit', borderColor: 'transparent', borderWidthMm: 0,
  };
}

describe('editable project archives', () => {
  it('preserves inactive edition text, note anchors and nonprinting artwork', async () => {
    const manager = blankProject();
    const condition = manager.addCondition('Teacher edition');
    manager.toggleCondition(condition.id);
    const state = manager.getState();
    const pageId = state.spreads[0].pages[0].id;
    const body: TextElement = {
      id: 'body', type: 'text', pageId, x: 20, y: 20, width: 150, height: 160,
      rotation: 0, opacity: 1, locked: false, zIndex: 1, text: '', fontFamily: 'Times',
      fontSizePt: 11, lineHeight: 1.4, letterSpacingPt: 0, color: '#111111', alignment: 'left',
      columns: 1, columnGutterMm: 4, paddingMm: 0, backgroundColor: 'transparent',
      borderColor: 'transparent', borderWidthMm: 0,
    };
    const publicCopy = 'Published copy';
    const teacherCopy = 'Teacher-only explanation';
    manager.addElement(body);
    manager.setStoryContent(body.id, { version: 1, paragraphs: [
      { runs: [{ text: publicCopy }] },
      { conditionId: condition.id, runs: [{ text: teacherCopy, italic: true }] },
    ] });
    const note = manager.insertFootnote(body.id, 'Teacher-only citation', publicCopy.length + 1 + teacherCopy.length);
    manager.addElement({ ...body, id: 'editorial-note', text: 'Editorial directions', nonprinting: true });
    const source = manager.getState();
    const original = manager.exportJson();

    const print = publicationSnapshot(source);
    expect(print.spreads[0].elements.map(element => element.id)).toEqual([body.id]);
    expect(print.settings.footnotes).toEqual([]);

    const archive = await createProjectArchive(source);
    const restored = await readProjectArchive(await archive.arrayBuffer());

    expect(restored.conditions).toEqual(source.conditions);
    expect(restored.settings.footnotes).toEqual(source.settings.footnotes);
    expect(restored.spreads[0].elements.find(element => element.id === 'editorial-note')).toMatchObject({
      text: 'Editorial directions', nonprinting: true,
    });
    const story = restored.spreads[0].elements.find(element => element.id === body.id) as TextElement;
    expect(story.storyContent?.paragraphs[1]).toMatchObject({
      conditionId: condition.id,
      runs: expect.arrayContaining([expect.objectContaining({ text: teacherCopy, italic: true }), expect.objectContaining({ noteId: note.id })]),
    });
    expect(manager.exportJson()).toBe(original);
  });

  it('saves original image and font bytes with editable adjustments on an unused parent page', async () => {
    const state = blankProject().getState();
    const asset = await assetStore.registerAsset(png, { name: 'Original.png', mimeType: 'image/png' });
    const page = { ...state.spreads[0].pages[0], id: 'unused-parent-page' };
    const artwork: ImageElement = {
      ...imageFrame('parent-art', page.id, 'data:image/png;base64,iVBORw0KGgo='),
      assetId: asset.id, nonprinting: true, adjustments: { ...neutralAdjustments, grayscale: true },
    };
    state.masterSpreads.push({ id: 'unused-parent', name: 'Unused parent', prefix: 'U', pages: [page], elements: [artwork] });
    const fontData = readFileSync(new URL('./fixtures/fonts/OpenSans-Regular.ttf', import.meta.url)).toString('base64');
    state.embeddedFonts = [{ family: 'Open Sans', fileName: 'OpenSans-Regular.ttf', data: fontData }];

    const archive = await createProjectArchive(state);
    const restored = await readProjectArchive(await archive.arrayBuffer());
    const parent = restored.masterSpreads.find(item => item.id === 'unused-parent');

    expect(parent?.elements[0]).toMatchObject({ src: png, adjustments: artwork.adjustments, nonprinting: true });
    expect(restored.embeddedFonts).toEqual(state.embeddedFonts);
    expect(artwork.src).not.toBe(png);
  });

  it('requires an external image to be embedded without attempting a network request', async () => {
    const state = blankProject().getState();
    const spread = state.spreads[0];
    spread.elements.push({ ...imageFrame('linked-image', spread.pages[0].id, 'https://example.invalid/photo.png'), name: 'Photo' });
    const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
    try {
      await expect(createProjectArchive(state)).rejects.toThrow(/embed or relink.*Photo/i);
      expect(request).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
    }
  });

  it('rejects a modified project even when the ZIP itself is valid', async () => {
    const archive = await createProjectArchive(blankProject().getState());
    const entries = await readZip(await archive.arrayBuffer());
    const project = new TextDecoder().decode(entries.get('project.recto'));
    const modified = project.replace('Editorial archive', 'Editorial altered');
    expect(modified).not.toBe(project);
    expect(modified.length).toBe(project.length);
    entries.set('project.recto', new TextEncoder().encode(modified));
    const tampered = createZipArchive(Object.fromEntries(entries));

    await expect(readProjectArchive(tampered.slice().buffer)).rejects.toThrow(/integrity|checksum|hash|digest/i);
  });
});
