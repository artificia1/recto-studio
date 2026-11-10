import type { ProjectState } from '../types';
import { publicationPreflight } from './publicationPreflight';
import { layoutFrameNotes, publicationHeadings, publicationSnapshot, textFrames } from './publicationReferences';
import { layoutStory } from './storyLayout';
import { plainStory } from './storyContent';
import { publicationWrapObjects } from './publicationWrap';

export function compareChapterImpact(before: ProjectState, after: ProjectState) {
  const summarize = (source: ProjectState) => {
    const snapshot = publicationSnapshot(source);
    const pages = snapshot.spreads.flatMap(spread => spread.pages);
    const frameSpreads = new Map(snapshot.spreads.flatMap(spread => spread.elements.map(element => [element.id, spread] as const)));
    const issues = publicationPreflight(snapshot).map(issue => ({
      key: JSON.stringify([issue.code, issue.elementId, issue.message, issue.severity]),
      page: issue.pageNumber, message: issue.message,
    }));
    for (const frame of textFrames(snapshot)) {
      if (frame.nextFrameId || frame.pasteboard || !frame.text) continue;
      const spread = frameSpreads.get(frame.id)!;
      const layout = layoutStory(frame.textContent || plainStory(frame.text, frame.paragraphStyleId), frame,
        snapshot.paragraphStyles, snapshot.characterStyles, undefined, layoutFrameNotes(snapshot, frame).height,
        { obstacles: publicationWrapObjects(snapshot, spread), baselineGrid: snapshot.settings.baselineGrid });
      if (layout.overset) issues.push({ key: `overset:${frame.id}`, page: pages.find(page => page.id === frame.pageId)?.pageNumber || 1,
        message: 'Text overflows its final frame.' });
    }
    return { issues, headings: publicationHeadings(snapshot) };
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
  return { headings, introduced: difference(updated.issues, old.issues), resolved: difference(old.issues, updated.issues) };
}
