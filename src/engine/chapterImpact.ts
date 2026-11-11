import type { ProjectState } from '../types';
import { publicationPreflight } from './publicationPreflight';
import { publicationHeadings, publicationSnapshot } from './publicationReferences';
import { captureComposedLayout, compareLayouts } from './layoutChanges';

export function compareChapterImpact(before: ProjectState, after: ProjectState) {
  const summarize = (source: ProjectState) => {
    const snapshot = publicationSnapshot(source);
    const layout = captureComposedLayout(snapshot);
    const issues = publicationPreflight(snapshot).map(issue => ({
      key: JSON.stringify([issue.code, issue.elementId, issue.message, issue.severity]),
      page: issue.pageNumber, message: issue.message,
    }));
    for (const { frameId, page } of layout.overset.values()) {
      issues.push({ key: `overset:${frameId}`, page, message: 'Text overflows its final frame.' });
    }
    return { issues, headings: publicationHeadings(snapshot), layout };
  };
  const old = summarize(before), updated = summarize(after);
  const headingKey = (heading: (typeof old.headings)[number]) => heading.paragraphId || heading.elementId;
  const headingRows = (headings: typeof old.headings) => {
    const counts = new Map<string, number>();
    return new Map(headings.map(heading => {
      const key = headingKey(heading), occurrence = (counts.get(key) || 0) + 1;
      counts.set(key, occurrence);
      return [JSON.stringify([key, occurrence]), heading] as const;
    }));
  };
  const oldHeadings = headingRows(old.headings), newHeadings = headingRows(updated.headings);
  const headings = [...new Set([...oldHeadings.keys(), ...newHeadings.keys()])].flatMap(key => {
    const before = oldHeadings.get(key), after = newHeadings.get(key);
    return before?.title === after?.title && before?.pageNumber === after?.pageNumber ? [] : [{ key, before, after }];
  });
  const difference = (left: typeof old.issues, right: typeof old.issues) => {
    const counts = new Map<string, number>();
    right.forEach(issue => counts.set(issue.key, (counts.get(issue.key) || 0) + 1));
    return left.filter(issue => {
      const count = counts.get(issue.key) || 0;
      if (count) counts.set(issue.key, count - 1);
      return !count;
    });
  };
  return { headings, introduced: difference(updated.issues, old.issues), resolved: difference(old.issues, updated.issues),
    layout: compareLayouts(old.layout, updated.layout) };
}
