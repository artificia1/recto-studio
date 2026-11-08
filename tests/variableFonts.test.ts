import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fontManager, FontManager } from '../src/fontManager';
import { variationCss } from '../src/engine/fontVariations';
import { embeddedFontCss } from '../src/export/fontAssets';
import { StateManager } from '../src/state/stateManager';
import { parseProject } from '../src/state/projectValidation';
import { generateEpubPackage } from '../src/epubExport';

describe('real variable font instances', () => {
  it('uses different outlines and advance widths, persists coordinates and restores them', async () => {
    const bytes = readFileSync('tests/fixtures/fonts/Roboto-Variable.ttf');
    const base = await fontManager.registerFontBuffer('Roboto-Variable.ttf', bytes);
    expect(fontManager.getFont(base)!.variationAxes).toHaveProperty('wght');
    const narrow = await fontManager.createVariation(base, { wdth: 75, wght: 300 });
    const wide = await fontManager.createVariation(base, { wdth: 100, wght: 900 });
    expect(narrow).not.toBe(wide);
    expect(fontManager.getFont(narrow)!.layout('Hamburgefonts').advanceWidth).toBeLessThan(fontManager.getFont(wide)!.layout('Hamburgefonts').advanceWidth);
    const lightPath = fontManager.getFont(narrow)!.glyphForCodePoint(65).path.toSVG();
    expect(lightPath).not.toBe(fontManager.getFont(wide)!.glyphForCodePoint(65).path.toSVG());
    const manager = new StateManager(); manager.createBlankProject();
    manager.getState().embeddedFonts = fontManager.getFontAssets().filter(asset => asset.family === wide);
    const project = parseProject(manager.exportJson(), manager.getState());
    expect(project.embeddedFonts![0].variations).toEqual({ wdth: 100, wght: 900 });
    const restored = new FontManager(); await restored.restoreFonts(project.embeddedFonts);
    expect(restored.getFont(wide)!.glyphForCodePoint(65).path.toSVG()).toBe(fontManager.getFont(wide)!.glyphForCodePoint(65).path.toSVG());
    expect(embeddedFontCss(project.embeddedFonts)).toContain('"wght" 900');
    expect(generateEpubPackage(project)['OEBPS/styles.css']).toContain('"wdth" 100');
    const edit = new StateManager();
    const target = edit.getActiveSpread().elements.find(element => element.type === 'text')!;
    const previousFamily = (target as import('../src/types').TextElement).fontFamily;
    edit.commitHistory(); edit.applyImportedFont(target.id, wide);
    expect((edit.getElementById(target.id) as import('../src/types').TextElement).fontFamily).toBe(wide);
    edit.undo(); expect((edit.getElementById(target.id) as import('../src/types').TextElement).fontFamily).toBe(previousFamily);
  });
  it('rejects unknown axes, nonfinite values, out-of-range values and CSS payloads', async () => {
    const manager = new FontManager();
    const family = await manager.registerFontBuffer('Roboto-Variable.ttf', readFileSync('tests/fixtures/fonts/Roboto-Variable.ttf'));
    await expect(manager.createVariation(family, { wght: 99999 })).rejects.toThrow('Invalid value');
    await expect(manager.createVariation(family, { opsz: 12 })).rejects.toThrow('Invalid value');
    await expect(manager.createVariation(family, { wght: NaN })).rejects.toThrow('Invalid value');
    expect(() => variationCss({ 'x";': 1 })).toThrow();
    const asset = manager.getFontAssets()[0];
    await expect(new FontManager().restoreFonts([{ ...asset, family: 'Forged instance', variations: { wght: 900 } }])).rejects.toThrow('does not match');
  });
});
