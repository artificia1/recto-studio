import { expect, it } from 'vitest';
import { composeManuscript, signatureBudget } from '../src/engine/manuscriptCompilation';
import { parseDocxContent, parseMarkdownContent } from '../src/contentImport';
import { pdfStoryMeasure } from '../src/export/pdfExport';
import { validateProjectValue } from '../src/state/projectValidation';
import { INITIAL_STATE } from '../src/state/defaults';
import { createZipArchive } from '../src/zip';
import { storyText } from '../src/engine/storyContent';
import type { TextElement } from '../src/types';

const edition = { trim: 'trade-paperback-6x9' as const, title: 'Book', language: 'en', fontFamily: 'Times', sourceRevision: 'a'.repeat(64) };

it('budgets printer signatures explicitly and leaves the default interior even', () => {
  expect(signatureBudget(211)).toMatchObject({ deliveredPages: 212, blankPages: 1, signatures: null });
  expect(signatureBudget(211, 16, 14)).toMatchObject({ deliveredPages: 224, blankPages: 13, signatures: 14 });
  expect(() => signatureBudget(211, 16, 13)).toThrow('needs 14 signatures');
  expect(() => signatureBudget(490, 32)).toThrow('500-page');
});

it('keeps the manuscript and note anchors across facing pages, without adding folios to padding', () => {
  const paragraph = 'The harbor was quiet when the first boat left the dock. '.repeat(7);
  const input = parseMarkdownContent('# Harbor\n\n' + (paragraph + '\n\n').repeat(60) + 'Last words.[^end]\n\n[^end]: A final footnote.');
  const { state, budget, headings } = composeManuscript(input, { ...edition, pagesPerSignature: 8 }, pdfStoryMeasure());
  expect(budget.manuscriptPages).toBeGreaterThan(2);
  const checked = validateProjectValue(state, INITIAL_STATE);
  expect(checked.spreads[1].pages.map(page => page.side)).toEqual(['left', 'right']);
  const head = checked.spreads[0].elements.find(element => element.id === 'compiled-body-1') as TextElement;
  expect(storyText(head.storyContent!)).toBe(input.formattedText);
  expect(state.settings.footnotes?.map(note => note.text)).toEqual(['A final footnote.']);
  expect(headings[0]).toMatchObject({ title: 'Harbor', pageNumber: 1 });
  expect(checked.spreads.flatMap(spread => spread.elements).some(element => element.id === `compiled-folio-${budget.manuscriptPages + 1}`)).toBe(false);
});

it('compiles structured Word paragraphs through the same layout engine', async () => {
  const word = await parseDocxContent(createZipArchive({
    'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Word manuscript</w:t></w:r></w:p></w:body></w:document>',
  }));
  const { state } = composeManuscript(word, edition, pdfStoryMeasure());
  const frame = state.spreads[0].elements[0] as TextElement;
  expect(frame.storyContent?.paragraphs[0].runs[0]).toMatchObject({ text: 'Word manuscript', italic: true });
});
