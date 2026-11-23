import type { ProjectState, StoryContent } from '../types';
import { contentOf, storyHeads, textFrames } from './publicationReferences';
import { editStory, storyText } from './storyContent';

export interface ManuscriptQuery { scope?: 'document' | 'spread' | 'story'; paragraphStyleId?: string; characterStyleId?: string }
export interface ManuscriptMatch { elementId: string; spreadIndex: number; matchText: string; index: number; length: number; replacement: string }

export function searchManuscripts(state: ProjectState, regex: RegExp, replacement: string, query: ManuscriptQuery): ManuscriptMatch[] {
  const frames = new Map(textFrames(state).map(frame => [frame.id, frame]));
  const spreadByFrame = new Map<string, number>();
  state.spreads.forEach((spread, index) => {
    for (const element of spread.elements) if (element.type === 'text') spreadByFrame.set(element.id, index);
  });
  const selected = frames.get(state.selectedElementId ?? '');
  let selectedHead = selected;
  const seen = new Set<string>();
  while (selectedHead?.prevFrameId && !seen.has(selectedHead.id)) {
    seen.add(selectedHead.id);
    selectedHead = frames.get(selectedHead.prevFrameId);
  }
  const results: ManuscriptMatch[] = [];
  for (const head of storyHeads(state)) {
    if (head.generated || (query.scope === 'story' && head.id !== selectedHead?.id)) continue;
    const content = contentOf(head), text = storyText(content);
    const spans: { start: number; end: number; paragraph?: string; character?: string; atomic: boolean }[] = [];
    let offset = 0;
    for (const paragraph of content.paragraphs) {
      for (const run of paragraph.runs) { spans.push({ start: offset, end: offset + run.text.length,
        paragraph: paragraph.styleId || head.paragraphStyleId, character: run.characterStyleId, atomic: !!(run.noteId || run.reference) }); offset += run.text.length; }
      offset++;
    }
    regex.lastIndex = 0;
    // RegExp matches are ordered. Advance each cursor once through the story.
    let firstSpan = 0;
    let frame = head;
    const visited = new Set([head.id]);
    for (const match of text.matchAll(regex)) {
      if (results.length >= 100000) throw new Error('Too many matches. Narrow the search.');
      const start = match.index!, end = start + match[0].length;
      while (firstSpan < spans.length && spans[firstSpan].end <= start) firstSpan++;
      let hasOverlap = false;
      let excluded = false;
      for (let i = firstSpan; i < spans.length && spans[i].start < end; i++) {
        const span = spans[i];
        hasOverlap = true;
        if (span.atomic || (query.paragraphStyleId && span.paragraph !== query.paragraphStyleId) ||
          (query.characterStyleId && span.character !== query.characterStyleId)) { excluded = true; break; }
      }
      if (excluded || (!hasOverlap && (query.paragraphStyleId || query.characterStyleId))) continue;
      while (frame.nextFrameId && start >= (frame.storyEnd ?? Infinity) && !visited.has(frame.nextFrameId)) {
        const next = frames.get(frame.nextFrameId);
        if (!next) break;
        visited.add(next.id);
        frame = next;
      }
      const spreadIndex = spreadByFrame.get(frame.id) ?? -1;
      if (query.scope === 'spread' && spreadIndex !== state.activeSpreadIndex) continue;
      // Implement native replacement tokens using the original match context (lookarounds included).
      const expanded = replacement.replace(/\$([$&`']|\d{1,2}|<[^>]+>)/g, (token, group: string) => {
        if (group === '$') return '$'; if (group === '&') return match[0];
        if (group === '`') return text.slice(0, start); if (group === "'") return text.slice(end);
        if (group.startsWith('<')) return match.groups ? match.groups[group.slice(1, -1)] ?? '' : token;
        const n = Number(group); if (n > 0 && n < match.length) return match[n] ?? '';
        if (group.length === 2 && Number(group[0]) > 0 && Number(group[0]) < match.length) return (match[Number(group[0])] ?? '') + group[1];
        return token;
      });
      results.push({ elementId: head.id, spreadIndex, matchText: match[0], index: start, length: match[0].length, replacement: expanded });
    }
  }
  return results;
}

export function replaceManuscriptMatches(content: StoryContent, matches: ManuscriptMatch[]): StoryContent {
  const steps = manuscriptReplacementSteps(content, matches);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** Yield between paragraphs so the editor can prepare a large replacement cooperatively. */
export function* manuscriptReplacementSteps(content: StoryContent, matches: ManuscriptMatch[]): Generator<void, StoryContent> {
  if (matches.length < 2 || matches.some(match => match.matchText.includes('\n') || match.replacement.includes('\n'))) {
    let result = content;
    for (const match of [...matches].sort((a, b) => b.index - a.index)) {
      result = replaceMatch(result, match);
      yield;
    }
    return result;
  }
  const ordered = [...matches].sort((a, b) => a.index - b.index);
  let offset = 0;
  let index = 0;
  const paragraphs: StoryContent['paragraphs'] = [];
  for (const paragraph of content.paragraphs) {
    const start = offset;
    const end = start + paragraph.runs.reduce((length, run) => length + run.text.length, 0);
    offset = end + 1;
    if (index >= ordered.length || ordered[index].index > end) {
      paragraphs.push(paragraph);
      yield;
      continue;
    }
    let local: StoryContent = { version: 1, paragraphs: [paragraph] };
    const first = index;
    while (index < ordered.length && ordered[index].index <= end) {
      const match = ordered[index++];
      if (match.index < start || match.index + match.length > end) throw new Error('Search results changed. Search again before replacing.');
    }
    // Preserve input ordering when two zero-width matches share an offset.
    for (const match of ordered.slice(first, index).sort((a, b) => b.index - a.index)) {
      local = replaceMatch(local, { ...match, index: match.index - start });
      yield;
    }
    paragraphs.push(local.paragraphs[0]);
    yield;
  }
  if (index < ordered.length) throw new Error('Search results changed. Search again before replacing.');
  return { version: 1, paragraphs };
}

function replaceMatch(content: StoryContent, match: ManuscriptMatch): StoryContent {
  const text = storyText(content);
  if (text.slice(match.index, match.index + match.length) !== match.matchText) throw new Error('Search results changed. Search again before replacing.');
  return editStory(content, text.slice(0, match.index) + match.replacement + text.slice(match.index + match.length));
}
