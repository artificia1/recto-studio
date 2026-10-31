import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { isInddBuffer, parseInddToProjectState, carveUtf16Stories } from '../src/engine/inddParser';
import { StateManager } from '../src/state/stateManager';
import { parseIdmlPackage } from '../src/idmlImport';

const signature = [0x06, 0x06, 0xed, 0xf5, 0xd8, 0x1d, 0x46, 0xe5, 0xbd, 0x31, 0xef, 0xe7, 0xfe, 0x74, 0xb7, 0x1d];
function binary(fragments: string[]) {
  const content = fragments.join('\0');
  const data = new Uint8Array(64 + content.length * 2);
  data.set(signature);
  for (let i = 0; i < content.length; i++) { data[64 + i * 2] = content.charCodeAt(i) & 255; data[65 + i * 2] = content.charCodeAt(i) >> 8; }
  return data;
}

describe('honest INDD recovery', () => {
  it('requires the complete signature instead of words or a partial prefix', () => {
    expect(isInddBuffer(new TextEncoder().encode('DOCUMENT application/x-indesign Adobe InDesign'))).toBe(false);
    const data = binary([]); data[15] = 0;
    expect(isInddBuffer(data)).toBe(false);
    expect(() => parseInddToProjectState(data)).toThrow(/signature/);
  });
  it('retains every recovered fragment without inventing original pages or styles', () => {
    const fragments = ['The first recovered manuscript.', 'Another recovered paragraph.', 'A third recovered section.', 'The fourth fragment was previously discarded.'];
    const state = parseInddToProjectState(binary(fragments), 'sample.indd');
    expect(state.settings.title).toBe('sample (Recovered content)');
    expect(state.spreads).toHaveLength(1);
    expect(state.paragraphStyles).toEqual([]);
    const recovered = state.spreads[0].elements.find(item => item.type === 'text' && item.id === 'indd-recovered-text');
    for (const fragment of fragments) expect(recovered?.type === 'text' && recovered.text).toContain(fragment);
  });
  it('does not replace the current document without explicit recovery', async () => {
    const manager = new StateManager();
    manager.createBlankProject('A4', 'Keep this project');
    const current = manager.exportJson();
    const data = binary(['Recoverable manuscript paragraph.']);
    await expect(manager.loadFromIndd(data, 'example.indd')).rejects.toThrow(/IDML/);
    await expect(manager.loadFromIdml(data, 'renamed.idml')).rejects.toThrow(/INDD/);
    await expect(parseIdmlPackage(data)).rejects.toThrow(/INDD/);
    expect(manager.exportJson()).toBe(current);
  });
  it('handles long readable streams without overflowing the argument stack', () => {
    const fragment = 'Long readable content '.repeat(9000);
    expect(carveUtf16Stories(binary([fragment]))).toContain(fragment.trim());
  });
  it('keeps the existing document if nothing useful can be recovered', async () => {
    const manager = new StateManager();
    const current = manager.exportJson();
    await expect(manager.loadFromIndd(binary([]), 'empty.indd', { recoverContent: true })).rejects.toThrow(/No readable/);
    expect(manager.exportJson()).toBe(current);
  });
});

describe('InDesign IDML conversion script contract', () => {
  const script = readFileSync('public/conversion/Recto-Export-IDML.jsx', 'utf8');
  it('exports the active document through the real host API without saving or closing it', () => {
    const destination = { name: 'book.idml', fsName: '/book.idml', exists: false };
    const document = { exportFile: vi.fn(), save: vi.fn(), close: vi.fn() };
    runInNewContext(script, { app: { documents: [document], activeDocument: document }, File: { saveDialog: () => destination },
      ExportFormat: { INDESIGN_MARKUP: 'IDML' }, alert: vi.fn(), confirm: () => true });
    expect(document.exportFile).toHaveBeenCalledWith('IDML', destination, false);
    expect(document.save).not.toHaveBeenCalled();
    expect(document.close).not.toHaveBeenCalled();
  });
  it('does nothing when the user cancels choosing a destination', () => {
    const document = { exportFile: vi.fn() };
    runInNewContext(script, { app: { documents: [document], activeDocument: document }, File: { saveDialog: () => null }, alert: vi.fn() });
    expect(document.exportFile).not.toHaveBeenCalled();
  });
});
