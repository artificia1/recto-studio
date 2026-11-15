import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

function check(changeStory = false, useAlreadyOpen = false) {
  const reports = new Map<string, string>();
  const input = { name: encodeURIComponent('handoff “A”\nnotes.idml'), fsName: '/source/handoff.idml', length: 1240 };
  class FileMock {
    static openDialog = () => input;
    constructor(public fsName: string) {}
    open() { return true; }
    write(value: string) { reports.set(this.fsName.split('/').at(-1)!, value); return true; }
    close() {}
  }
  class FolderMock {
    static selectDialog = () => ({ fsName: '/checks' });
    exists = false;
    constructor(public fsName: string) {}
    create() { return true; }
  }
  const document = (id: number, contents: string) => ({
    id, isValid: true, pages: [{ name: '1', bounds: [0, 0, 612, 792] }], spreads: [{ pages: [1] }], masterSpreads: [],
    layers: [{ name: 'Main', visible: true, locked: false, printable: true }],
    stories: [{ contents, overflows: false, textContainers: [{}] }], allPageItems: [],
    allParagraphStyles: [{ name: 'Body' }], allCharacterStyles: [], swatches: [], fonts: [], links: [],
    exportFile: vi.fn(), close: vi.fn(),
  });
  const before = document(1, 'Original text'), after = document(2, changeStory ? 'Different text' : 'Original text');
  const prefs = { measurementUnit: 'millimeters', userInteractionLevel: 'normal' };
  const open = vi.fn().mockReturnValueOnce(before).mockReturnValueOnce(after);
  const context = {
    File: FileMock, Folder: FolderMock, alert: vi.fn(), app: { open, documents: useAlreadyOpen ? [before] : [], scriptPreferences: prefs, version: 'test' },
    UserInteractionLevels: { NEVER_INTERACT: 'none' }, MeasurementUnits: { POINTS: 'points' }, ExportFormat: { INDESIGN_MARKUP: 'idml' }, SaveOptions: { NO: 'no' },
  };
  runInNewContext(readFileSync('public/conversion/Recto-Validate-IDML.jsx', 'utf8'), context);
  return { report: { text: reports.get('roundtrip-report.txt')! }, result: JSON.parse(reports.get('roundtrip-report.json')!), before, after, prefs, open };
}

it('exports and reopens separate IDML, reports drift, and restores InDesign preferences', () => {
  const result = check(true);
  expect(result.report.text).toContain('REVIEW stories');
  expect(result.report.text).not.toContain('Original text');
  expect(result.result).toMatchObject({ status: 'REVIEW', source: 'handoff “A”\nnotes.idml', sourceBytes: 1240,
    checks: expect.arrayContaining([{ group: 'stories', matches: false, opened: 1, reopened: 1 }]) });
  expect(result.before.exportFile).toHaveBeenCalledWith('idml', expect.objectContaining({ fsName: expect.stringMatching(/^\/checks\/Recto-IDML-check-.*\/indesign-roundtrip\.idml$/) }), false);
  expect(result.before.close).toHaveBeenCalledWith('no');
  expect(result.after.close).toHaveBeenCalledWith('no');
  expect(result.prefs).toEqual({ measurementUnit: 'millimeters', userInteractionLevel: 'normal' });
  expect(check().report.text.startsWith('PASS\n')).toBe(true);
});

it('leaves an already-open document alone', () => {
  const result = check(false, true);
  expect(result.report.text).toContain('already open');
  expect(result.result).toMatchObject({ status: 'ERROR', checks: [] });
  expect(result.before.exportFile).not.toHaveBeenCalled();
  expect(result.before.close).not.toHaveBeenCalled();
});
