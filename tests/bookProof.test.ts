import { describe, expect, it } from 'vitest';
import { assembleArchivedBook, type BookArchive } from '../src/engine/bookArchive';
import { approveBookProof, approvedProofPdf, compareBookProof, makeBookProof, readApprovedBookProof } from '../src/engine/bookProof';
import { defaultBookDelivery } from '../src/engine/bookDelivery';
import { matchProofPages } from '../src/engine/proofComparison';
import { emptyProductionProject, productionSpread, textFixture } from './fixtures/productionPublications';

const fingerprint = (signature: string) => ({ signature, textSignature: signature, width: 595, height: 842 });

describe('approved book proof', () => {
  it('matches stable chapters across inserted pages and recalculates the cover using blank pages', async () => {
    const first = emptyProductionProject('Opening'), second = emptyProductionProject('Bibliography');
    first.spreads.push(productionSpread(0, 'one'));
    for (let index = 1; index < 31; index++) first.spreads.push(productionSpread(index, 'one'));
    second.spreads.push(productionSpread(0, 'two'));
    second.spreads[0].elements.push(textFixture('source', second.spreads[0].pages[0].id, 'References for the publication'));
    const draft: BookArchive = { title: 'Edited book', delivery: defaultBookDelivery, references: [], chapters: [
      { id: 'one', name: 'Opening', state: first, recto: false },
      { id: 'two', name: 'Bibliography', state: second, recto: true },
    ] };
    const baseline = assembleArchivedBook(draft);
    const before = await makeBookProof(baseline.source, baseline.pages, draft.delivery);
    const proof = await approveBookProof(before.snapshot, before.bytes);
    expect(await approvedProofPdf(proof)).toEqual(before.bytes);
    await expect(approvedProofPdf({ ...proof, sha256: '0'.repeat(64) })).rejects.toThrow(/checksum/);
    expect(() => readApprovedBookProof({ ...proof, pages: [proof.pages[0], { ...proof.pages[0], pageNumber: 2 }] })).toThrow(/invalid/);
    expect(() => readApprovedBookProof({ ...proof, pages: [{ ...proof.pages[0], pageId: 'unrelated-page' }, ...proof.pages.slice(1)] })).toThrow(/invalid/);

    first.spreads.push(productionSpread(31, 'one'), productionSpread(32, 'one'));
    const revised = assembleArchivedBook(draft);
    expect(revised.pages.slice(-4).map(page => page.pageId)).toEqual(['one-page-31', 'one-page-32', undefined, 'two-page-0']);
    const after = await makeBookProof(revised.source, revised.pages, draft.delivery);
    const opening = Array.from({ length: 31 }, (_, index) => 'opening-' + index);
    const result = compareBookProof(proof, after.snapshot, [...opening, 'blank', 'bibliography'].map(fingerprint),
      [...opening, 'new1', 'new2', 'blank', 'bibliography'].map(fingerprint));
    expect(result).toMatchObject({ beforePages: 33, afterPages: 35, changed: 2, moved: 2, coverReview: true });
    expect(result.rows[34]).toEqual({ before: 32, after: 34, change: 'unchanged', moved: true });
  }, 60_000);

  it('keeps ambiguous external pages unpaired and matches a unique page after a move', () => {
    const a = ['blank', 'unique', 'blank', 'changed'].map(fingerprint);
    const b = ['unique', 'new', 'blank', 'blank', 'replacement'].map(fingerprint);
    const results = matchProofPages(a, b);
    expect(results[0]).toEqual({ before: 1, after: 0, change: 'unchanged', moved: true });
    expect(results.slice(1).every(row => row.change === 'uncertain' && (row.before === null || row.after === null))).toBe(true);
  });
});
