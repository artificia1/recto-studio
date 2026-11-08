import type { ProjectState, StoryContent } from '../types';
import { contentOf, storyHeads, textFrames } from './publicationReferences';
import { editStory, storyText } from './storyContent';

export interface ManuscriptQuery { scope?: 'document' | 'spread' | 'story'; paragraphStyleId?: string; characterStyleId?: string }
export interface ManuscriptMatch { elementId: string; spreadIndex: number; matchText: string; index: number; length: number; replacement: string }

export function searchManuscripts(state: ProjectState, regex: RegExp, replacement: string, query: ManuscriptQuery): ManuscriptMatch[] {
  const frames = textFrames(state), selected = frames.find(frame => frame.id === state.selectedElementId);
  let selectedHead = selected;
  const seen = new Set<string>();
  while (selectedHead?.prevFrameId && !seen.has(selectedHead.id)) { seen.add(selectedHead.id); selectedHead = frames.find(frame => frame.id === selectedHead!.prevFrameId); }
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
    for (const match of text.matchAll(regex)) {
      if (results.length >= 100000) throw new Error('Too many matches. Narrow the search.');
      const start = match.index!, end = start + match[0].length;
      const overlapping = spans.filter(span => span.end > start && span.start < end);
      if (overlapping.some(span => span.atomic)) continue;
      if (query.paragraphStyleId && (!overlapping.length || overlapping.some(span => span.paragraph !== query.paragraphStyleId))) continue;
      if (query.characterStyleId && (!overlapping.length || overlapping.some(span => span.character !== query.characterStyleId))) continue;
      let frame = head;
      const visited = new Set<string>();
      while (frame.nextFrameId && start >= (frame.storyEnd ?? Infinity) && !visited.has(frame.id)) {
        visited.add(frame.id); const next = frames.find(item => item.id === frame.nextFrameId); if (!next) break; frame = next;
      }
      const spreadIndex = state.spreads.findIndex(spread => spread.elements.some(item => item.id === frame.id));
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
  let result = content;
  for (const match of [...matches].sort((a, b) => b.index - a.index)) {
    const text = storyText(result);
    if (text.slice(match.index, match.index + match.length) !== match.matchText) throw new Error('Search results changed. Search again before replacing.');
    result = editStory(result, text.slice(0, match.index) + match.replacement + text.slice(match.index + match.length));
  }
  return result;
}
