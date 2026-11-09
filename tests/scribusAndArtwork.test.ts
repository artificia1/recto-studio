import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { captureArtwork, instantiateArtwork, parseReusableArtwork } from '../src/engine/reusableArtwork';
import { importScribusFile, parseScribus } from '../src/import/scribusImport';
import { INITIAL_STATE } from '../src/state/defaults';
import { parseProject } from '../src/state/projectValidation';
import { scribusFixture } from './scribusFixture';

describe('Scribus 1.6 interchange', () => {
  it('keeps editable stories, shapes, paths, groups and parent page assignments', () => {
    const result = parseScribus(scribusFixture);
    const state = parseProject(JSON.stringify(result.project), INITIAL_STATE);
    expect(result).toMatchObject({ imported: 6, skipped: 1 });
    expect(state.settings.title).toBe('Scribus handoff');
    expect(state.settings.widthMm).toBeCloseTo(215.9);
    expect(state.settings.heightMm).toBeCloseTo(279.4);
    const [a, b] = state.spreads;
    expect(a.masterSpreadId).toBe(state.masterSpreads[0].id);
    expect(b.masterSpreadId).toBe(a.masterSpreadId);
    expect(state.masterSpreads[0].elements[0]).toMatchObject({ shapeKind: 'line', strokeColor: 'cmyk(100,28,0,3)' });
    expect(a.elements[0]).toMatchObject({ type: 'text', x: 12.7, y: 12.7, text: 'Opening & proof copy\nSecond paragraph', nextFrameId: b.elements[0].id, fontFamily: 'Georgia' });
    expect(a.elements[0]).toMatchObject({ storyContent: { paragraphs: [
      { runs: [{ text: 'Opening & proof ' }, { text: 'copy', fontFamily: 'Georgia', bold: true }] }, { runs: [{ text: 'Second paragraph' }] },
    ] } });
    expect(b.elements[0]).toMatchObject({ prevFrameId: a.elements[0].id, storyId: 'sla-story-' + a.elements[0].id });
    expect(a.elements[1]).toMatchObject({ type: 'shape', fillColor: 'cmyk(100,28,0,3)', groupId: expect.any(String) });
    expect(a.elements[2]).toMatchObject({ type: 'path', groupId: a.elements[1].groupId, closed: true, nodes: [expect.any(Object), { handleOut: expect.any(Object) }, { handleIn: expect.any(Object) }] });
    expect(a.elements[3]).toMatchObject({ type: 'image', src: '', name: 'external.jpg' });
    expect(result.warnings.join(' ')).toMatch(/relinking.*unsupported object type 16/);
  });

  it('opens compressed documents and rejects unsupported XML and versions', async () => {
    const file = new File([new Uint8Array(gzipSync(scribusFixture))], 'book.sla.gz');
    await expect(importScribusFile(file)).resolves.toMatchObject({ imported: 6 });
    expect(() => parseScribus('<!DOCTYPE x SYSTEM "file:///private">' + scribusFixture)).toThrow('external entities');
    expect(() => parseScribus(scribusFixture.replace('1.6.7', '1.7.4'))).toThrow('Scribus 1.6');
  });

  it('preserves source text when linked frames already contain content', () => {
    const xml = scribusFixture.replace('<StoryText><DefaultStyle/></StoryText>', '<StoryText><ITEXT CH="Independent text"/></StoryText>');
    const result = parseScribus(xml);
    expect(result.project.spreads[0].elements[0]).toMatchObject({ type: 'text' });
    expect(result.project.spreads[0].elements[0]).not.toHaveProperty('nextFrameId');
    expect(result.project.spreads[1].elements[0]).toMatchObject({ text: 'Independent text' });
  });
});

describe('Reusable artwork', () => {
  it('round-trips grouped selections with fresh IDs and relative positions', () => {
    const { project } = parseScribus(scribusFixture);
    const source = project.spreads[0].elements[1];
    project.selectedElementIds = [source.id];
    const entry = captureArtwork(project, 'Reusable motif');
    const file = parseReusableArtwork(JSON.stringify(entry));
    const first = instantiateArtwork(file, 12, 18), second = instantiateArtwork(file, 20, 30);
    expect(first).toHaveLength(2);
    expect(first[0].type).toBe('shape');
    expect(first[0].x).toBeCloseTo(12);
    expect(first[0].y).toBeCloseTo(18);
    expect(first[0].groupId).toBe(first[1].groupId);
    expect(first[0].groupId).not.toBe(second[0].groupId);
    expect(first[0].id).not.toBe(second[0].id);
    expect(first[1]).toMatchObject({ type: 'path', closed: true });
  });

  it('rejects text threads and remote image URLs without fetching them', () => {
    const { project } = parseScribus(scribusFixture);
    project.selectedElementIds = [project.spreads[0].elements[0].id];
    expect(() => captureArtwork(project, 'Text thread')).toThrow();
    const image = project.spreads[0].elements[3];
    if (image.type !== 'image') throw new Error('Expected image fixture');
    image.src = 'https://example.invalid/artwork.png';
    project.selectedElementIds = [image.id];
    expect(() => captureArtwork(project, 'External artwork')).toThrow('Embed linked artwork');
  });
});
