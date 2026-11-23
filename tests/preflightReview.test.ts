import { expect, it, vi } from 'vitest';
import { groupPreflightIssues, reviewPreflightChange } from '../src/engine/preflightReview';
import { publicationPreflight } from '../src/engine/publicationPreflight';
import { INITIAL_STATE } from '../src/state/defaults';
import { StateManager } from '../src/state/stateManager';
import type { ImageElement, PreflightIssue } from '../src/types';

it('groups repeat findings and distinguishes cleared frames from new ones', () => {
  const empty = (id: string, pageNumber: number): PreflightIssue => ({
    id, elementId: id, pageNumber, spreadIndex: pageNumber - 1,
    code: 'LOW_RES_IMAGE', message: 'Image frame is empty.', severity: 'error',
  });
  const before = [empty('photo-a', 1), empty('photo-b', 3)];
  const after = [empty('photo-b', 4), { ...empty('photo-a', 1), message: 'Image is below 220 DPI.', severity: 'warning' as const }];
  expect(groupPreflightIssues(before).map(([, issues]) => issues.map(issue => issue.pageNumber))).toEqual([[1, 3]]);
  expect(reviewPreflightChange(before, after)).toEqual({ cleared: [before[0]], introduced: [after[1]], remaining: [after[0]] });
});

it('keeps image findings attached to their own page in a facing spread', () => {
  const state = structuredClone(INITIAL_STATE);
  const placeholder = (id: string, pageId: string): ImageElement => ({ id, pageId, type: 'image', src: '',
    x: 10, y: 10, width: 45, height: 45, rotation: 0, opacity: 1, zIndex: 0, locked: false,
    fitMode: 'fit', borderWidthMm: 0, borderColor: 'transparent' });
  state.spreads[0].elements = [];
  state.spreads[1].elements = state.spreads[1].pages.map(page => placeholder(`placeholder-${page.id}`, page.id));
  const findings = publicationPreflight(state, 'epub');
  expect(findings.map(({ elementId, spreadIndex, pageNumber, code, severity }) => ({ elementId, spreadIndex, pageNumber, code, severity })))
    .toEqual(state.spreads[1].pages.flatMap(page => ['MISSING_ASSET', 'MISSING_ALT_TEXT'].map(code => ({
      elementId: `placeholder-${page.id}`, spreadIndex: 1, pageNumber: page.pageNumber, code, severity: 'error',
    }))));
});

it('applies automatic image fixes as one undo entry and skips locked frames', () => {
  const manager = new StateManager();
  manager.createBlankProject('A4', 'Proof copy', false);
  const pageId = manager.getActiveSpread().pages[0].id;
  const frame: ImageElement = { id: 'open-photo', pageId, type: 'image', src: '',
    x: 20, y: 20, width: 45, height: 45, rotation: 0, opacity: 1, zIndex: 0,
    locked: false, fitMode: 'fit', borderWidthMm: 0, borderColor: 'transparent' };
  manager.addElement(frame);
  manager.addElement({ ...frame, id: 'captioned-photo', y: 75, src: 'data:image/svg+xml,<svg/>', caption: 'Existing caption' });
  manager.addElement({ ...frame, id: 'locked-photo', y: 130, locked: true });
  const revision = manager.getDocumentRevision();
  const reflow = vi.spyOn(manager, 'reflowFormattedStories');
  expect(manager.autoFixAllPreflightIssues()).toBe(2);
  expect(manager.getDocumentRevision()).toBe(revision + 1);
  expect(reflow).not.toHaveBeenCalled();
  expect(manager.getElementById('open-photo')).toMatchObject({ altText: 'Editorial vector artwork illustration' });
  expect(manager.getElementById('captioned-photo')).toMatchObject({ altText: 'Existing caption' });
  expect(manager.getElementById('locked-photo')).toMatchObject({ src: '', locked: true });
  manager.undo();
  expect(manager.getElementById('open-photo')).toMatchObject({ src: '' });
  expect((manager.getElementById('captioned-photo') as ImageElement).altText).toBeUndefined();
  const quickFix = manager.runPreflightCheck().find(issue => issue.code === 'MISSING_ALT_TEXT' && issue.elementId === 'captioned-photo')!;
  expect(manager.autoFixPreflightIssue(quickFix)).toBe(true);
  expect(reflow).not.toHaveBeenCalled();
  reflow.mockRestore();
});
