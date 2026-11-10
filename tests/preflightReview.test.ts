import { expect, it } from 'vitest';
import { groupPreflightIssues, reviewPreflightChange } from '../src/engine/preflightReview';
import type { PreflightIssue } from '../src/types';

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
