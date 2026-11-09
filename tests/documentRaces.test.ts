import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetStore } from '../src/engine/assetStore';
import { exportDocumentToIdml } from '../src/export/idmlExport';
import { StateManager } from '../src/state/stateManager';
import { readZip } from '../src/zip';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function publication(title: string) {
  const manager = new StateManager();
  manager.createBlankProject('A4', title, false);
  return manager;
}

function projectFile(title: string) {
  return new File([JSON.stringify(publication(title).getState())], `${title}.recto`);
}

function imagePublication() {
  const manager = publication('Artwork');
  manager.addElement({
    id: 'photo', pageId: manager.getActiveSpread().pages[0].id, type: 'image', x: 10, y: 10,
    width: 80, height: 80, rotation: 0, opacity: 1, zIndex: 1, locked: false, src: png,
    fitMode: 'fit', borderColor: 'transparent', borderWidthMm: 0, name: 'old.psd', isPsd: true,
    assetId: 'previous-session-asset', alphaContour: [{ minX: 0.2, maxX: 0.8 }], actualDpi: 96,
  });
  return manager;
}

describe('Background document and asset work', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens the most recently requested project even if an earlier read finishes last', async () => {
    const manager = publication('Current');
    const file = projectFile('Slow');
    const contents = await file.text();
    let finish!: (contents: string) => void;
    vi.spyOn(file, 'text').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const slow = expect(manager.importProjectFile(file)).rejects.toThrow(/opening|superseded/i);
    await manager.importProjectFile(projectFile('Latest'));
    finish(contents);
    await slow;
    expect(manager.getState().settings.title).toBe('Latest');
  });

  it('keeps edits made while a project file is being read', async () => {
    const manager = publication('Current');
    const file = projectFile('Slow');
    const contents = await file.text();
    let finish!: (contents: string) => void;
    vi.spyOn(file, 'text').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const opening = expect(manager.importProjectFile(file)).rejects.toThrow(/document changed/i);
    manager.updateSettings({ title: 'Edited while opening' });
    finish(contents);
    await opening;
    expect(manager.getState().settings.title).toBe('Edited while opening');
  });

  it('keeps the latest image replacement and restores previous metadata on undo', async () => {
    const manager = imagePublication();
    const result = { proxyDataUrl: png, originalWidth: 1, originalHeight: 1 };
    let finish!: (value: typeof result) => void;
    const decode = vi.spyOn(assetStore, 'generateScreenProxy').mockResolvedValue(result)
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const slow = manager.registerImageAsset('photo', png, 'slow.png');
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    expect(await manager.registerImageAsset('photo', png, 'latest.png')).toBe(true);
    finish(result);
    expect(await slow).toBe(false);
    expect(manager.getElementById('photo')).toMatchObject({
      name: 'latest.png', src: png, originalWidth: 1, isPsd: undefined, actualDpi: undefined, alphaContour: undefined,
    });
    manager.undo();
    expect(manager.getElementById('photo')).toMatchObject({ name: 'old.psd', isPsd: true, actualDpi: 96 });
  });

  it('exports the saved full-resolution image after its in-memory asset cache is gone', async () => {
    const manager = imagePublication();
    const files = await readZip(exportDocumentToIdml(manager.getState()));
    const image = [...files].find(([name]) => /^Links\/\d+-\d+-old\.png$/.test(name))?.[1];
    expect(image?.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });
});
