import { beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ingestManuscript, mapManuscriptStyles, parseDocxContent, parseMarkdownContent } from '../src/contentImport';
import { createZipArchive } from '../src/zip';
import { readZip } from '../src/zip';
import { editStory, formatStory, plainStory, sliceStory, storyText } from '../src/engine/storyContent';
import { layoutStory } from '../src/engine/storyLayout';
import { stateManager } from '../src/state/stateManager';
import { generateEpubPackage } from '../src/epubExport';
import { exportDocumentToPdf } from '../src/export/pdfExport';
import type { StoryContent, TextElement } from '../src/types';

const manuscript = '# Chapter one\n\nOrdinary **bold** and *italic* text.\n\n## A section\n\nLast paragraph.';
const docx = (document: string, styles = '') => createZipArchive({ 'word/document.xml': document, 'word/styles.xml': styles });

describe('Manuscript import and structured content', () => {
  it('retains paragraph-specific styles and inline emphasis', () => {
    const imported = parseMarkdownContent(manuscript);
    expect(imported.content!.paragraphs.map(p => p.styleId)).toEqual(['style-h1', 'style-body', 'style-h2', 'style-body']);
    expect(imported.content!.paragraphs[1].runs).toContainEqual({ text: 'bold', bold: true });
    expect(imported.content!.paragraphs[1].runs).toContainEqual({ text: 'italic', italic: true });
    expect(imported.formattedText).toBe('Chapter one\nOrdinary bold and italic text.\nA section\nLast paragraph.');
    expect(mapManuscriptStyles(imported, { 'Heading 1': 'custom-heading' }).paragraphs[0].styleId).toBe('custom-heading');
  });

  it('retains underscores in words, escapes, Unicode, lists and literal HTML', () => {
    const result = parseMarkdownContent('file_name_here \\*literal\\* **bold *nested* text** 😀\n\n- item\n\n<script>alert(1)</script>');
    expect(result.formattedText).toContain('file_name_here *literal* bold nested text 😀');
    expect(result.content!.paragraphs[0].runs.find(r => r.text === 'nested')).toMatchObject({ bold: true, italic: true });
    expect(result.formattedText).toContain('<script>');
    expect(result.warnings!.length).toBeGreaterThan(0);
  });

  it('reads namespaced Word paragraphs, run styles, entities, tabs, breaks and explicit off values', async () => {
    const imported = await parseDocxContent(docx(`<?xml version="1.0"?><x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:body>
      <x:p><x:pPr><x:pStyle x:val="Chapter"/></x:pPr><x:r><x:t>Chapter &amp; &#x1F600;</x:t></x:r></x:p>
      <x:p><x:r><x:rPr><x:b/><x:i x:val="0"/><x:u x:val="single"/></x:rPr><x:t xml:space="preserve"> bold </x:t><x:tab/><x:t>tab</x:t><x:br/><x:t>line</x:t></x:r></x:p>
      <x:p/><x:p><x:del><x:r><x:delText>deleted</x:delText></x:r></x:del><x:ins><x:r><x:t>accepted</x:t></x:r></x:ins></x:p>
    </x:body></x:document>`, '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="Chapter"><w:name w:val="Heading 1"/></w:style></w:styles>'));
    expect(imported.content!.paragraphs[0]).toMatchObject({ styleId: 'style-h1', runs: [{ text: 'Chapter & 😀' }] });
    expect(imported.content!.paragraphs[1].runs[0]).toMatchObject({ text: ' bold \ttab\nline', bold: true, italic: false, underline: true });
    expect(imported.content!.paragraphs[2].runs[0].text).toBe('');
    expect(imported.formattedText).toContain('accepted');
    expect(imported.formattedText).not.toContain('deleted');
    expect(imported.warnings!.some(w => w.includes('Tracked changes'))).toBe(true);
  });

  it('rejects invalid DOCX and entity declarations without inserting an error as manuscript text', async () => {
    await expect(parseDocxContent(createZipArchive({}))).rejects.toThrow('Not a valid DOCX');
    await expect(parseDocxContent(docx('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///secret">]><document/>'))).rejects.toThrow('entity declarations');
    await expect(parseDocxContent(docx('<document><body></document>'))).rejects.toThrow('malformed');
    await expect(ingestManuscript('unsupported.pdf', new Uint8Array())).rejects.toThrow('Choose a DOCX');
    await expect(readZip(createZipArchive({ manuscript: '123456789' }), 4)).rejects.toThrow('size limit');
  });

  it('preserves whitespace in every slice and retains formatting through text edits', () => {
    const content = formatStory(plainStory('One\n\nTwo 😀 and three\n'), 5, 8, { italic: true });
    const text = storyText(content);
    for (let a = 0; a <= text.length; a++) for (let b = a; b <= text.length; b++) {
      expect(storyText(sliceStory(content, a, b))).toBe(text.slice(a, b));
    }
    for (const value of ['One\n\nTwo 😀 and three\n!', '', 'Prefix\n' + text, 'One\n\nTwo NEW 😀 and three\n']) {
      expect(storyText(editStory(content, value))).toBe(value);
    }
    const edited = editStory(content, 'One\n\nTwo 😀 and changed\n');
    expect(edited.paragraphs[2].runs.find(r => r.text.includes('Two'))?.italic).toBe(true);
  });
});

describe('Story lifecycle', () => {
  let head: TextElement, middle: TextElement, tail: TextElement;
  beforeEach(() => {
    stateManager.createBlankProject('A4', 'Manuscript test', false);
    const pageId = stateManager.getActiveSpread().pages[0].id;
    head = { id: 'head', pageId, type: 'text', text: 'First', x: 10, y: 10, width: 40, height: 25,
      rotation: 0, opacity: 1, zIndex: 1, locked: false, fontFamily: 'Times', fontSizePt: 10, lineHeight: 1.3,
      letterSpacingPt: 0, color: '#111111', alignment: 'left', columns: 1, columnGutterMm: 4,
      paddingMm: 2, borderColor: 'transparent', backgroundColor: 'transparent', borderWidthMm: 0 };
    middle = { ...head, id: 'middle', text: 'Second' };
    tail = { ...head, id: 'tail', text: 'Third' };
    stateManager.addElement(head); stateManager.addElement(middle); stateManager.addElement(tail);
  });
  const current = (id: string) => stateManager.getElementById(id) as TextElement;
  const fullText = () => storyText(stateManager.getStoryContent('head'));

  it('merges existing copy and conserves exact text and formatting across frames', () => {
    stateManager.linkTextFrames('head', 'middle');
    stateManager.linkTextFrames('middle', 'tail');
    expect(fullText()).toBe('First\nSecond\nThird');
    const content = parseMarkdownContent(manuscript.repeat(12)).content!;
    stateManager.setStoryContent('head', content);
    expect(['head', 'middle', 'tail'].map(id => current(id).text).join('')).toBe(storyText(content));
    expect(current('tail').text.length).toBeGreaterThan(0);
    expect(current('tail').storyContent).toBeUndefined();
    stateManager.deleteElement('middle');
    expect(fullText()).toBe(storyText(content));
    expect(current('head').nextFrameId).toBe('tail');
    stateManager.deleteElement('head');
    expect(storyText(stateManager.getStoryContent('tail'))).toBe(storyText(content));
  });

  it('edits a continuation frame without losing other frame content, including empty stories', () => {
    stateManager.linkTextFrames('head', 'middle');
    stateManager.setStoryContent('head', plainStory('One paragraph.\n\n' + 'Long text repeated. '.repeat(60)));
    const original = fullText();
    const start = current('middle').storyStart!;
    stateManager.updateElement('middle', { text: 'Replacement\n\nwith paragraphs' });
    expect(fullText()).toBe(original.slice(0, start) + 'Replacement\n\nwith paragraphs');
    stateManager.setStoryText('middle', '');
    expect(fullText()).toBe('');
    expect(current('head').text + current('middle').text).toBe('');
  });

  it('supports formatting across paragraphs, named character styles and undo/save/reopen', () => {
    stateManager.setStoryContent('head', plainStory('First\nSecond'));
    stateManager.createCharacterStyle({ id: 'emphasis', name: 'Emphasis', italic: true });
    stateManager.formatStoryRange('head', 6, 12, { characterStyleId: 'emphasis' });
    stateManager.styleStoryRange('head', 6, 12, 'style-h1');
    expect(stateManager.getStoryContent('head').paragraphs[1].styleId).toBe('style-h1');
    stateManager.undo();
    expect(stateManager.getStoryContent('head').paragraphs[1].styleId).toBeUndefined();
    stateManager.redo();
    const saved = stateManager.exportJson();
    stateManager.loadFromJson(saved);
    expect(stateManager.getState().characterStyles?.[0].name).toBe('Emphasis');
    expect(stateManager.getStoryContent('head').paragraphs[1].runs[0].characterStyleId).toBe('emphasis');
    const reopened = stateManager.exportJson();
    const malformed = JSON.parse(saved);
    malformed.spreads[0].elements[0].storyContent.paragraphs[0].runs[0].bold = 'yes';
    expect(() => stateManager.loadFromJson(JSON.stringify(malformed))).toThrow('true or false');
    expect(stateManager.exportJson()).toBe(reopened);
  });

  it('splits threads and duplicates frames without retaining hidden copies of the original story', () => {
    stateManager.linkTextFrames('head', 'middle'); stateManager.linkTextFrames('middle', 'tail');
    const content = plainStory('Paragraph one.\n\n' + 'A long manuscript. '.repeat(80));
    stateManager.setStoryContent('head', content);
    const duplicated = stateManager.duplicateElement('head')!;
    expect(storyText(stateManager.getStoryContent(duplicated))).toBe(current('head').text);
    const before = ['head', 'middle', 'tail'].map(id => current(id).text).join('');
    stateManager.unlinkTextFrame('middle');
    expect(['head', 'middle', 'tail'].map(id => storyText(stateManager.getStoryContent(id))).join('')).toBe(before);
  });

  it('flows across spreads and preserves copy when an entire spread is removed', () => {
    stateManager.addSpread();
    const nextPage = stateManager.getActiveSpread().pages[0].id;
    stateManager.addElement({ ...tail, id: 'other-page', pageId: nextPage, text: '' });
    stateManager.linkTextFrames('head', 'other-page');
    const text = 'Chapter 😀\n\n' + 'A manuscript with repeated paragraphs.\n'.repeat(200);
    stateManager.setStoryText('head', text);
    expect(current('head').text + current('other-page').text).toBe(text);
    stateManager.deleteSpread(0);
    expect(storyText(stateManager.getStoryContent('other-page'))).toBe(text);
  });

  it('keeps inspector overrides and paragraph breaks through subsequent edits', () => {
    stateManager.setStoryContent('head', parseMarkdownContent(manuscript).content!);
    stateManager.updateElement('head', { fontSizePt: 15, alignment: 'center' });
    expect(stateManager.getStoryContent('head').paragraphs[1].formatting).toMatchObject({ fontSizePt: 15, alignment: 'center' });
    const text = current('head').text;
    stateManager.updateElement('head', { text: text + '\nAdded paragraph' });
    expect(fullText()).toBe(text + '\nAdded paragraph');
    expect(stateManager.getStoryContent('head').paragraphs[1].runs.some(run => run.bold)).toBe(true);
  });

  it('composes mixed styles using measured widths, columns and visible overset', () => {
    const content = parseMarkdownContent(manuscript).content!;
    const layout = layoutStory(content, { ...head, height: 18, columns: 2, width: 90 }, stateManager.getState().paragraphStyles, [], (text, style) => text.length * style.fontSizePt * 0.15);
    expect(layout.lines.length).toBeGreaterThan(0);
    expect(layout.overset).toBe(true);
    expect(layout.consumed).toBeLessThan(storyText(content).length);
    expect(layout.lines.some(l => l.segments.some(s => s.style.fontSizePt > head.fontSizePt))).toBe(true);
  });

  it('exports rich PDF text and semantic EPUB once per story with escaped content', async () => {
    stateManager.linkTextFrames('head', 'middle');
    const content = parseMarkdownContent('# Heading\n\nText **bold** and *italic* <unsafe>.').content!;
    stateManager.setStoryContent('head', content);
    stateManager.updateElement('head', { width: 180, height: 150 });
    const state = stateManager.getState();
    const files = generateEpubPackage(state);
    const xhtml = Object.entries(files).filter(([name]) => /page_.*xhtml$/.test(name)).map(([, value]) => value).join('');
    expect(xhtml).toContain('<h1'); expect(xhtml).toContain('<strong>bold</strong>'); expect(xhtml).toContain('<em>italic</em>');
    expect(xhtml).toContain('&lt;unsafe&gt;'); expect(xhtml.match(/<strong>bold<\/strong>/g)).toHaveLength(1);
    const pdf = await exportDocumentToPdf(state, { download: false, compress: false });
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(pdf.output()).toContain('(bold)');
    mkdirSync('test-results/export-validation', { recursive: true });
    writeFileSync('test-results/export-validation/manuscript.pdf', new Uint8Array(pdf.output('arraybuffer')));
    writeFileSync('test-results/export-validation/manuscript.epub', createZipArchive(files));
  });
});
