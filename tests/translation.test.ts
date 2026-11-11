import { describe, expect, it } from 'vitest';
import { StateManager } from '../src/state/stateManager';
import { storyText } from '../src/engine/storyContent';
import { languageTag, storyTranslationParts, translationCatalog, translationText, type TranslationPart } from '../src/translation/catalog';
import { buildTranslatedEdition, previewTranslatedEdition } from '../src/translation/edition';
import { combineTranslationMemories, findTranslationMemoryMatches, readTranslationMemory, rememberReviewedTranslations,
  serializeTranslationMemory, type TranslationMemory } from '../src/translation/memory';
import { formatTranslationGlossary, parseTranslationGlossary, translationQualityFindings } from '../src/translation/quality';
import { outstandingTranslationGroups, reviewTranslation, translatedRuns, updateReviewedTranslation, validateTranslation } from '../src/translation/review';
import { writeTranslationExchange, type ReturnedTranslation } from '../src/translation/xliff';
import { translationReviewHtml } from '../src/translation/report';
import { generateEpubPackage } from '../src/epubExport';
import type { ImageElement, TableElement, TextElement } from '../src/types';

function publication(text = 'The chapter measures 1,234.50 mm.') {
  const manager = new StateManager();
  manager.createBlankProject('A4', 'Source publication', false);
  const state = manager.getState();
  state.settings.language = 'en-US';
  const frame: TextElement = {
    id: 'chapter', pageId: state.spreads[0].pages[0].id, type: 'text', name: 'Chapter body', text,
    x: 18, y: 22, width: 115, height: 48, zIndex: 1, locked: false, rotation: 0, opacity: 1,
    fontFamily: 'Georgia, serif', fontSizePt: 11, color: '#111111', lineHeight: 1.3, letterSpacingPt: 0,
    alignment: 'left', columns: 1, columnGutterMm: 4, paddingMm: 2,
    backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0,
  };
  manager.addElement(frame);
  return { manager, state, frame };
}

function returnUnits(groups: ReturnType<typeof translationCatalog>, replacements: (value: string) => string): ReturnedTranslation {
  return {
    sourceLanguage: 'en-US',
    targetLanguage: 'fr-FR',
    units: groups.flatMap(group => group.units.map(unit => ({
      key: unit.key,
      source: unit.source,
      target: unit.source.map(part => part.kind === 'marker' ? part : { ...part, text: replacements(part.text) }),
      state: 'translated' as const,
    }))),
  };
}

describe('translation handoff', () => {
  it('exchanges styled runs, protected anchors, and printable text with independent copy geometry', () => {
    const { manager, state, frame } = publication();
    manager.setStoryContent(frame.id, { version: 1, paragraphs: [{ id: 'stable', runs: [
      { text: 'Heading', bold: true }, { text: ' for the reader' },
    ] }] });
    const note = manager.insertFootnote(frame.id, 'Original note', 7);
    const original = manager.exportJson();
    const groups = translationCatalog(manager.getState());
    const unit = groups.flatMap(group => group.units).find(unit => unit.address.kind === 'paragraph')!;
    const exchange = returnUnits(groups, value => value.replace('Heading', 'Titre').replace('for the reader', 'pour le lecteur')
      .replace('Original note', 'Note traduite').replace('Source publication', 'Édition française'));
    const preview = reviewTranslation(manager.getState(), groups, exchange);
    const { draft } = buildTranslatedEdition(manager.getState(), preview, new Set(preview.candidates.keys()));
    const translated = draft.spreads[0].elements[0] as TextElement;
    expect(translated).toMatchObject({ id: frame.id, pageId: frame.pageId, x: frame.x, width: frame.width });
    expect(translated.storyContent?.paragraphs[0]).toMatchObject({ id: 'stable' });
    expect(translated.storyContent?.paragraphs[0].runs).toEqual([
      { text: 'Titre', bold: true }, expect.objectContaining({ noteId: note.id }), { text: ' pour le lecteur' },
    ]);
    expect(draft.settings.footnotes?.[0]).toMatchObject({ id: note.id, text: 'Note traduite' });
    expect(draft.settings).toMatchObject({ title: 'Édition française', language: 'fr-FR' });
    expect(manager.exportJson()).toBe(original);
    expect(state.settings.language).toBe('en-US');
    const xml = writeTranslationExchange(groups, 'en-us', 'fr-fr');
    expect(xml).toContain('srcLang="en-US" trgLang="fr-FR"');
    expect(xml).toContain('<pc id="1" canCopy="no" canDelete="no">Heading</pc>');
    expect(xml).toContain('disp="Note marker"');
    const missingMarker = exchange.units.find(item => item.key === unit.key)!.target!.filter(part => part.kind !== 'marker');
    expect(validateTranslation(unit, missingMarker)).toContain('exactly once');
  });

  it('keeps page variables and conditional boundaries while detecting replaced protected anchors', () => {
    const { manager, frame } = publication();
    const runs = [{ text: 'From {{page}}: {cond:Teacher}Answer{/cond}', italic: true }];
    manager.setStoryContent(frame.id, { version: 1, paragraphs: [{ id: 'stable', runs }] });
    const note = manager.insertFootnote(frame.id, 'Same note body', 0);
    const groups = translationCatalog(manager.getState());
    const exchange = returnUnits(groups, text => text.replace('From ', 'Depuis ').replace('Answer', 'Réponse'));
    const unit = groups.flatMap(group => group.units).find(item => item.address.kind === 'paragraph')!;
    const target = exchange.units.find(item => item.key === unit.key)!.target!;
    expect(translationText(target, unit.codes)).toContain('{{page}}');
    const conditionMarkers = target.filter(part => part.kind === 'marker');
    const reordered = target.map(part => part.kind === 'marker' && part.id === conditionMarkers.at(-1)!.id
      ? conditionMarkers.at(-2)! : part.kind === 'marker' && part.id === conditionMarkers.at(-2)!.id ? conditionMarkers.at(-1)! : part);
    expect(validateTranslation(unit, reordered)).toContain('boundaries');
    const frameNow = manager.getStoryHead(frame.id)!;
    const noteRun = frameNow.storyContent!.paragraphs[0].runs.find(run => run.noteId === note.id)!;
    noteRun.noteId = 'replacement-note-id';
    const review = reviewTranslation(manager.getState(), translationCatalog(manager.getState()), exchange);
    expect(review.rows.find(row => row.key === unit.key)?.status).toBe('conflict');
  });

  it('finds changed source, missing targets, duplicate codes and unsupported multiline paragraphs', () => {
    const { manager, frame } = publication();
    manager.setStoryContent(frame.id, { version: 1, paragraphs: [{ id: 'stable', runs: [{ text: 'Format', italic: true }] }] });
    const groups = translationCatalog(manager.getState());
    const unit = groups.flatMap(group => group.units).find(item => item.address.kind === 'paragraph')!;
    const exchange = returnUnits(groups, () => 'Texte');
    const entry = exchange.units.find(row => row.key === unit.key)!;
    const target = entry.target!;
    entry.target = [...target, ...target];
    expect(reviewTranslation(manager.getState(), groups, exchange).rows.find(row => row.key === unit.key)?.status).toBe('invalid');
    entry.target = [{ kind: 'format', id: '1', text: 'Deux\nlignes' }];
    expect(() => translatedRuns(unit, entry.target!)).toThrow('paragraph breaks');
    entry.target = undefined;
    expect(reviewTranslation(manager.getState(), groups, exchange).rows.find(row => row.key === unit.key)?.status).toBe('missing');
    manager.setStoryContent(frame.id, { version: 1, paragraphs: [{ id: 'stable', runs: [{ text: 'Edited format', italic: true }] }] });
    expect(reviewTranslation(manager.getState(), translationCatalog(manager.getState()), exchange)
      .rows.find(row => row.key === unit.key)?.status).toBe('conflict');
  });

  it('reports a longer target’s overset with paired frame composition and leaves the source unchanged', () => {
    const { manager, frame } = publication('Short copy.');
    const groups = translationCatalog(manager.getState());
    const exchange = returnUnits(groups, () => 'Une traduction avec beaucoup plus de texte. '.repeat(35));
    const review = reviewTranslation(manager.getState(), groups, exchange);
    const unit = groups.flatMap(group => group.units).find(unit => unit.address.kind === 'paragraph')!;
    const proof = previewTranslatedEdition(manager.getState(), review, new Set([unit.key]));
    expect(proof.layout.newOverset.map(item => item.frameId)).toContain(frame.id);
    const pair = proof.frameProof.compare(frame.id)!;
    expect(pair.before?.overset).toBe(false);
    expect(pair.after?.remaining).toBeGreaterThan(0);
    expect(pair.after?.width).toBe(pair.before?.width);
    expect(storyText(manager.getStoryContent(frame.id))).toBe('Short copy.');
  });

  it('checks localized numeric values and applies a case-insensitive bounded glossary', () => {
    const { manager } = publication();
    const groups = translationCatalog(manager.getState());
    const target = (source: string) => source.startsWith('The chapter') ? 'Le chapitre mesure 1\u202f234,50 mm.' : source;
    const good = reviewTranslation(manager.getState(), groups, returnUnits(groups, target));
    const glossary = parseTranslationGlossary('# terminology\nChapter → chapitre\nmeasures\tmesure');
    expect(translationQualityFindings(good, glossary, true).findings).toEqual([]);
    const wrong = reviewTranslation(manager.getState(), groups, returnUnits(groups, source => target(source).replace('chapitre', 'texte').replace('234,50', '224,50')));
    expect(translationQualityFindings(wrong, glossary, true).findings.map(finding => finding.message)).toEqual([
      'The numeric values differ after accounting for language-specific separators.', 'Review “Chapter”. The glossary prefers “chapitre”.',
    ]);
    expect(() => parseTranslationGlossary('bad → rule → extra')).toThrow('Glossary line 1');
    expect(() => languageTag('not a locale')).toThrow('valid language tag');
  });

  it('translates table cells, image descriptions, and parent-page copy without breaking fields', () => {
    const { manager, frame } = publication();
    const page = manager.getActiveSpread().pages[0];
    const base = { pageId: page.id, x: 15, y: 90, width: 100, height: 70, rotation: 0, opacity: 1, locked: false, zIndex: 2 };
    const table: TableElement = { ...base, id: 'budget', type: 'table', rows: 2, cols: 2, rowSizing: 'content',
      cells: [[{ text: 'Category' }, { text: 'Amount' }], [{ text: 'Paper' }, { text: '100' }]], headerRowCount: 1,
      headerFillColor: '#000000', headerTextColor: '#ffffff', borderColor: '#222222', borderWidthMm: 0.2,
      cellPaddingMm: 1, fontFamily: frame.fontFamily, fontSizePt: 11 };
    const image: ImageElement = { ...base, id: 'chart', type: 'image', y: 165, src: '', fitMode: 'fit',
      originalWidth: 10, originalHeight: 10, altText: 'A simple bar chart', caption: 'Print costs',
      focalPoint: { x: 0.2, y: 0.3 }, borderColor: 'transparent', borderWidthMm: 0 };
    manager.addElement(table);
    manager.addElement(image);
    manager.addTableContinuationPage(table.id);
    const source = manager.getState();
    source.masterSpreads = [{ id: 'print-parent', name: 'Print parent',
      pages: [{ id: 'parent-page', pageNumber: 1, side: 'single' }],
      elements: [{ ...frame, id: 'parent-label', pageId: 'parent-page', text: 'Page {{page}}' }] }];
    source.spreads[0].masterSpreadId = 'print-parent';
    const groups = translationCatalog(source);
    const parent = groups.find(group => group.label.startsWith('Parent page'))!;
    expect(parent.restricted).toBeUndefined();
    expect(parent.units[0].source.some(part => part.kind === 'marker')).toBe(true);
    const replacements = new Map([
      ['Category', 'Catégorie'], ['Paper', 'Papier'], ['A simple bar chart', 'Un graphique à barres'],
      ['Print costs', 'Coûts d’impression'], ['Page ', 'Feuillet '],
    ]);
    const review = reviewTranslation(source, groups, returnUnits(groups, text => replacements.get(text) ?? text));
    const { draft } = buildTranslatedEdition(source, review, new Set(review.candidates.keys()));
    expect(draft.masterSpreads[0].elements[0]).toMatchObject({ text: 'Feuillet {{page}}' });
    expect(draft.spreads[0].elements.find(element => element.id === image.id)).toMatchObject({
      altText: 'Un graphique à barres', caption: 'Coûts d’impression', focalPoint: image.focalPoint, width: image.width,
    });
    const tables = draft.spreads.flatMap(spread => spread.elements).filter(element => element.type === 'table');
    expect(tables).toHaveLength(2);
    expect(tables.every(item => item.cells[0][0].text === 'Catégorie' && item.cells[1][0].text === 'Papier')).toBe(true);
    expect(source.masterSpreads[0].elements[0]).toMatchObject({ text: 'Page {{page}}' });
  });

  it('separates inactive copy and its note body from the public exchange scope', () => {
    const { manager, frame } = publication();
    const source = manager.getState();
    source.conditions = [{ id: 'staff', name: 'Staff draft', visible: false }];
    manager.setStoryContent(frame.id, { version: 1, paragraphs: [
      { conditionId: 'staff', id: 'private', runs: [{ text: 'Private advance figures' }] },
      { id: 'public', runs: [{ text: 'Public copy' }] },
    ] });
    manager.insertFootnote(frame.id, 'Private note body', 3);
    const catalog = translationCatalog(manager.getState());
    const restricted = catalog.filter(group => group.restricted === 'inactive edition');
    expect(restricted.flatMap(group => group.units.map(unit => unit.address.kind))).toEqual(['paragraph', 'note']);
    const visible = catalog.filter(group => !group.restricted);
    const xml = writeTranslationExchange(visible, 'en-US', 'fr-FR');
    expect(xml).toContain('Public copy');
    expect(xml).not.toContain('Private');
  });

  it('exports current outstanding copy and escapes bilingual report fields', () => {
    const { manager, frame } = publication('<script>source</script>');
    manager.setStoryContent(frame.id, { version: 1, paragraphs: [{ id: 'outstanding', runs: [{ text: '<script>source</script>' }] }] });
    const catalog = translationCatalog(manager.getState());
    const returned = returnUnits(catalog, value => value.replace('source', 'target'));
    manager.setStoryContent(frame.id, { version: 1, paragraphs: [{ id: 'outstanding', runs: [{ text: 'Current & reviewed text' }] }] });
    const current = translationCatalog(manager.getState());
    const review = reviewTranslation(manager.getState(), current, returned);
    const selected = new Set(review.candidates.keys());
    const outstanding = outstandingTranslationGroups(current, review, selected);
    expect(outstanding.flatMap(group => group.units.map(unit => translationText(unit.source)))).toEqual(['Current & reviewed text']);
    const report = translationReviewHtml('<Cover & source>', review, selected, []);
    expect(report).toContain('&lt;Cover &amp; source&gt;');
    expect(report).toContain('&lt;script&gt;target&lt;/script&gt;');
    expect(report).not.toContain('<script>');
    expect(report).toContain('Source changed');
  });

  it('reports inconsistent repeated copy and updates only the edited target', () => {
    const { manager, frame } = publication();
    manager.setStoryContent(frame.id, { version: 1, paragraphs: [
      { id: 'opening', runs: [{ text: 'Chapter' }] },
      { id: 'repeat', runs: [{ text: 'Chapter' }] },
    ] });
    const source = manager.getState();
    const catalog = translationCatalog(source);
    const exchange = returnUnits(catalog, text => text === 'Chapter' ? 'Chapitre' : text);
    const review = reviewTranslation(source, catalog, exchange);
    const paragraphs = review.rows.filter(row => row.source === 'Chapter');
    const edited = updateReviewedTranslation(review, paragraphs[1].key, [{ kind: 'text', text: 'Section' }]);
    expect(edited.rows.find(row => row.key === paragraphs[1].key)?.target).toBe('Section');
    expect(review.rows.find(row => row.key === paragraphs[1].key)?.target).toBe('Chapitre');
    const glossary = [{ source: 'Chapter', target: 'Chapitre' }];
    expect(parseTranslationGlossary(formatTranslationGlossary(glossary))).toEqual(glossary);
    const warnings = translationQualityFindings(edited, glossary, false).findings;
    expect(warnings.filter(warning => warning.message.startsWith('Identical source text')).map(warning => warning.key))
      .toEqual(paragraphs.map(row => row.key));
    expect(warnings.some(warning => warning.key === paragraphs[1].key && warning.message.includes('glossary'))).toBe(true);
  });

  it('preserves a paragraph style while setting the translated language in EPUB', () => {
    const { manager, frame } = publication();
    const style = manager.getState().paragraphStyles[0];
    style.language = 'en-US';
    manager.setStoryContent(frame.id, { version: 1, paragraphs: [{ styleId: style.id, runs: [{ text: 'First chapter.' }] }] });
    const state = manager.getState();
    const catalog = translationCatalog(state);
    const returned = returnUnits(catalog, value => value === 'First chapter.' ? 'Premier chapitre.' : value);
    const review = reviewTranslation(state, catalog, returned);
    const key = review.rows.find(row => row.source === 'First chapter.')!.key;
    const { draft } = buildTranslatedEdition(state, review, new Set([key]));
    const paragraph = (draft.spreads[0].elements[0] as TextElement).storyContent!.paragraphs[0];
    expect(paragraph).toMatchObject({ styleId: style.id, language: 'fr-FR' });
    expect(draft.paragraphStyles[0].language).toBe('en-US');
    const epub = generateEpubPackage(draft);
    expect(epub['OEBPS/page_1.xhtml']).toMatch(/<h1[^>]+xml:lang="fr-FR"[^>]*>[^]*Premier chapitre/);
  });
});

describe('translation memory', () => {
  it('holds conflicting variants for a decision and verifies a reusable candidate against current copy', () => {
    const { manager } = publication('Opening');
    const groups = translationCatalog(manager.getState());
    const memory: TranslationMemory = { version: 1, sourceLanguage: 'en-US', targetLanguage: 'fr-FR',
      entries: [{ source: 'Opening', targets: ['Ouverture'] }] };
    const alternative = { ...memory, entries: [{ source: 'Opening', targets: ['Début'] }] };
    const merged = readTranslationMemory(serializeTranslationMemory(combineTranslationMemories(memory, alternative)));
    const offered = findTranslationMemoryMatches(groups, merged);
    expect(offered.exchange.units).toEqual([]);
    expect(offered.conflicts[0].options).toEqual(['Ouverture', 'Début']);
    const chosen = findTranslationMemoryMatches(groups, merged, new Map([[offered.conflicts[0].key, 'Début']]));
    const review = reviewTranslation(manager.getState(), groups, chosen.exchange);
    expect(review.rows[0]).toMatchObject({ target: 'Début', status: 'ready' });
    expect(() => combineTranslationMemories(merged, { ...alternative, targetLanguage: 'de' })).toThrow('same source and target');
  });

  it('remembers only checked plain units and does not reuse styled or protected content', () => {
    const { manager, frame } = publication();
    manager.setStoryContent(frame.id, { version: 1, paragraphs: [{ runs: [{ text: 'Opening', bold: true }] }] });
    const groups = translationCatalog(manager.getState());
    const returned = returnUnits(groups, () => 'Ouverture');
    const review = reviewTranslation(manager.getState(), groups, returned);
    const approved = rememberReviewedTranslations(review, new Set(review.candidates.keys()));
    expect(approved.skipped).toBe(1);
    expect(approved.memory.entries).toEqual([{ source: 'Source publication', targets: ['Ouverture'] }]);
    expect(findTranslationMemoryMatches(groups, approved.memory).protectedUnits).toBe(1);
    const inline = storyTranslationParts([{ text: 'Opening', italic: true }]);
    expect(inline.parts).toEqual([{ kind: 'format', id: '1', text: 'Opening' }] satisfies TranslationPart[]);
  });

  it('matches Unicode-equivalent text and rejects duplicate or malformed memory entries', () => {
    const { manager } = publication('Cafe\u0301');
    const groups = translationCatalog(manager.getState());
    const memory: TranslationMemory = {
      version: 1,
      sourceLanguage: 'en-US',
      targetLanguage: 'fr-FR',
      entries: [{ source: 'Café', targets: ['Le café'] }],
    };
    const loaded = readTranslationMemory(serializeTranslationMemory(memory));
    const matched = findTranslationMemoryMatches(groups, loaded);
    expect(matched.exchange.units).toHaveLength(1);
    expect(matched.exchange.units[0].source).toEqual([{ kind: 'text', text: 'Cafe\u0301' }]);
    expect(matched.exchange.units[0].target).toEqual([{ kind: 'text', text: 'Le café' }]);
    const duplicate = { ...memory, entries: [...memory.entries, { source: 'Cafe\u0301', targets: ['Un café'] }] };
    expect(() => readTranslationMemory(JSON.stringify(duplicate))).toThrow('duplicate source');
    const invalid = { ...memory, entries: [{ source: 'Café', targets: ['Invalid\u0000control'] }] };
    expect(() => readTranslationMemory(JSON.stringify(invalid))).toThrow('entry is invalid');
  });
});
