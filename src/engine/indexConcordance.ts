import type { ProjectState, StoryContent, StoryRun } from '../types';
import { storyText } from './storyContent';
import { contentOf, storyHeads } from './publicationReferences';

export interface ConcordanceTerm { term: string; topic: string; subtopics: string[]; see?: string; seeAlso?: string[] }
export function parseConcordance(source: string): ConcordanceTerm[] {
  if (source.length > 200_000) throw new Error('The concordance is limited to 200,000 characters.');
  const rows = source.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (rows.length > 500) throw new Error('Use up to 500 concordance terms at a time.');
  return rows.map((line, index) => {
    const [term, path = term, crossReference = ''] = line.split('\t').map(value => value.trim());
    const [topic, ...subtopics] = path.split('>').map(value => value.trim());
    if (!term || term.length > 300 || !topic || subtopics.length > 3 || subtopics.some(value => !value)) throw new Error(`Invalid concordance row ${index + 1}. Use a term, then a tab and up to four topic levels.`);
    const seeAlso = /^see also:/i.test(crossReference) ? crossReference.slice(9).split(';').map(value => value.trim()).filter(Boolean) : undefined;
    const see = /^see:/i.test(crossReference) ? crossReference.slice(4).trim() : undefined;
    if (crossReference && !see && !seeAlso?.length) throw new Error(`Row ${index + 1}: use “See:” or “See also:” followed by a topic.`);
    return { term, topic, subtopics, ...(see ? { see } : {}), ...(seeAlso ? { seeAlso } : {}) };
  });
}

interface Match { elementId: string; start: number; end: number; term: ConcordanceTerm }
export function concordanceMatches(state: ProjectState, terms: ConcordanceTerm[], wholeWords = true): Match[] {
  const matches: Match[] = [];
  for (const head of storyHeads(state)) {
    const layer = state.layers.find(layer => layer.id === head.layerId);
    if (head.generated || head.pasteboard || head.locked || layer?.locked) continue;
    const content = contentOf(head), text = storyText(content);
    const protectedRanges: { start: number; end: number }[] = [];
    let offset = 0;
    for (const paragraph of content.paragraphs) {
      for (const run of paragraph.runs) { if (run.indexId || run.noteId || run.reference) protectedRanges.push({ start: offset, end: offset + run.text.length }); offset += run.text.length; }
      offset++;
    }
    const accepted: { start: number; end: number }[] = [...protectedRanges];
    for (const term of terms) {
      const pattern = new RegExp(term.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
      for (const match of text.matchAll(pattern)) {
        const start = match.index!, end = start + match[0].length;
        if (wholeWords && ((/^[\p{L}\p{N}]/u.test(match[0]) && /[\p{L}\p{N}_]$/u.test(text.slice(Math.max(0, start - 2), start))) || (/[\p{L}\p{N}]$/u.test(match[0]) && /^[\p{L}\p{N}_]/u.test(text.slice(end, end + 2))))) continue;
        if (accepted.some(range => start < range.end && end > range.start)) continue;
        matches.push({ elementId: head.id, start, end, term }); accepted.push({ start, end });
        if (matches.length > 10_000) throw new Error('More than 10,000 matches. Apply a smaller concordance.');
      }
    }
  }
  return matches;
}

/** Marks ranges without changing manuscript text or losing inline formatting. */
export function applyConcordance(state: ProjectState, terms: ConcordanceTerm[], wholeWords = true): number {
  const matches = concordanceMatches(state, terms, wholeWords);
  const frames = new Map(storyHeads(state).map(frame => [frame.id, frame]));
  state.indexEntries ||= [];
  const grouped = new Map<string, (Match & { id: string })[]>();
  for (const match of matches) {
    const list = grouped.get(match.elementId) || [];
    list.push({ ...match, id: crypto.randomUUID() }); grouped.set(match.elementId, list);
  }
  for (const [elementId, ranges] of grouped) {
    const frame = frames.get(elementId)!, content = frame.storyContent || contentOf(frame);
    ranges.sort((a, b) => a.start - b.start);
    let offset = 0, cursor = 0;
    const marked: StoryContent = { version: 1, paragraphs: content.paragraphs.map(paragraph => {
      const runs = paragraph.runs.flatMap(run => {
        const start = offset, end = offset + run.text.length; offset = end;
        while (cursor < ranges.length && ranges[cursor].end <= start) cursor++;
        let index = cursor, position = start;
        const pieces: StoryRun[] = [];
        while (index < ranges.length && ranges[index].start < end) {
          const range = ranges[index++], a = Math.max(start, range.start), b = Math.min(end, range.end);
          if (a > position) pieces.push({ ...run, text: run.text.slice(position - start, a - start) });
          pieces.push({ ...run, text: run.text.slice(a - start, b - start), indexId: range.id }); position = b;
        }
        if (position < end) pieces.push({ ...run, text: run.text.slice(position - start) });
        return pieces.length ? pieces : [run];
      }); offset++; return { ...paragraph, runs };
    }) };
    frame.storyContent = marked; frame.rawStoryText = storyText(marked);
    const pageNumber = state.spreads.flatMap(spread => spread.pages).find(page => page.id === frame.pageId)?.pageNumber || 1;
    for (const match of ranges) state.indexEntries.push({ id: match.id, topic: match.term.topic, subtopics: match.term.subtopics, see: match.term.see, seeAlso: match.term.seeAlso, pageNumber, elementId: frame.id });
  }
  return matches.length;
}
