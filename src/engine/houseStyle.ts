import type { ProjectState, StoryContent } from '../types';
import { contentOf, storyHeads, textFrames } from './publicationReferences';

export interface HouseStyleRules {
  terms: string;
  spacing: boolean;
  units: boolean;
  paragraphPrefix: string;
  paragraphStyle: string;
}

export interface HouseStyleFinding {
  id: string;
  storyId: string;
  frameId: string;
  paragraph: number;
  run: number;
  start: number;
  text: string;
  replacement?: string;
  reason: string;
  excerpt: string;
}

export const defaultHouseStyleRules: HouseStyleRules = {
  terms: '', spacing: false, units: false, paragraphPrefix: '', paragraphStyle: '',
};

const word = /[\p{L}\p{M}\p{N}_]/u;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const limit = 500;

export function checkHouseStyle(state: ProjectState, rules: HouseStyleRules) {
  const terms = new Map<string, string>();
  for (const [index, line] of rules.terms.split('\n').entries()) {
    if (!line.trim()) continue;
    const parts = line.split('→').map(part => part.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0] === parts[1] ||
      parts.some(part => part.length > 100) || terms.has(parts[0])) {
      throw new Error(`Enter a unique rule as “current → preferred” on line ${index + 1}.`);
    }
    terms.set(parts[0], parts[1]);
  }
  if (terms.size > 50) throw new Error('Use up to 50 preferred-term rules.');
  const expressions = [...terms].sort(([a], [b]) => b.length - a.length).map(([term, replacement]) => ({
    pattern: new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${escape(term)}(?![\\p{L}\\p{M}\\p{N}_])`, 'gu'),
    replacement, reason: 'Preferred wording',
  }));
  if (rules.spacing) expressions.push({ pattern: /(?<=\S) {2,}(?=\S)/g, replacement: ' ', reason: 'Repeated spaces' });
  if (rules.units) expressions.push({ pattern: /(?<=\p{N}) (?=(?:mm|cm|km|kg|mg|mL|°C|°F)\b)/gu,
    replacement: '\u00a0', reason: 'Nonbreaking space before unit' });
  const prefix = rules.paragraphPrefix.trim();
  const style = state.paragraphStyles.find(item => item.name === rules.paragraphStyle);
  if (prefix && !style) throw new Error('Choose an existing paragraph style for the prefix rule.');
  const findings: HouseStyleFinding[] = [];
  const frames = new Map(textFrames(state).map(frame => [frame.id, frame]));
  const lockedLayers = new Set(state.layers.filter(layer => layer.locked).map(layer => layer.id));
  for (const head of storyHeads(state)) {
    if (head.generated || head.pasteboard || head.dataBinding) continue;
    const chain = [head];
    const seen = new Set([head.id]);
    while (chain.at(-1)!.nextFrameId) {
      const next = frames.get(chain.at(-1)!.nextFrameId!);
      if (!next || seen.has(next.id)) break;
      chain.push(next);
      seen.add(next.id);
    }
    const locked = chain.some(frame => frame.locked || (frame.layerId && lockedLayers.has(frame.layerId)));
    let frameIndex = 0;
    let offset = 0;
    const locate = (position: number) => {
      // Rules can report positions in a different order from the text.
      let index = frameIndex;
      while (index + 1 < chain.length && position >= (chain[index].storyEnd ?? Infinity)) index++;
      return chain[index].id;
    };
    for (const [paragraph, content] of contentOf(head).paragraphs.entries()) {
      const text = content.runs.map(run => run.text).join('');
      while (frameIndex + 1 < chain.length && offset >= (chain[frameIndex].storyEnd ?? Infinity)) frameIndex++;
      if (prefix && style && text.trimStart().startsWith(prefix) && (content.styleId || head.paragraphStyleId) !== style.id) {
        findings.push({ id: JSON.stringify([head.id, paragraph, 'style']), storyId: head.id,
          frameId: locate(offset), paragraph, run: -1, start: 0, text: prefix,
          reason: `Expected paragraph style “${style.name}”`, excerpt: text.trim().slice(0, 110) });
        if (findings.length === limit) return { findings, limited: true };
      }
      let runOffset = 0;
      for (const [runIndex, run] of content.runs.entries()) {
        const runStart = runOffset;
        runOffset += run.text.length;
        if (run.noteId || run.reference || run.indexId || !run.text.trim()) continue;
        const accepted: { start: number; end: number }[] = [];
        for (const { pattern, replacement, reason } of expressions) {
          for (const match of run.text.matchAll(pattern)) {
            const start = match.index, end = start + match[0].length;
            const position = runStart + start;
            if (pattern.unicode && reason === 'Preferred wording' &&
              (word.test(Array.from(text.slice(Math.max(0, position - 2), position)).at(-1) || '') ||
               word.test(Array.from(text.slice(runStart + end, runStart + end + 2))[0] || ''))) continue;
            if (accepted.some(range => start < range.end && end > range.start)) continue;
            accepted.push({ start, end });
            findings.push({ id: JSON.stringify([head.id, paragraph, runIndex, start]), storyId: head.id,
              frameId: locate(offset + position), paragraph, run: runIndex, start, text: match[0],
              replacement: locked ? undefined : replacement, reason: locked ? `${reason} · locked story` : reason,
              excerpt: text.slice(Math.max(0, position - 35), runStart + end + 35) });
            if (findings.length === limit) return { findings, limited: true };
          }
        }
      }
      offset += text.length + 1;
    }
  }
  return { findings, limited: false };
}

export function buildHouseStyleEdits(state: ProjectState, findings: HouseStyleFinding[]) {
  const heads = new Map(storyHeads(state).map(head => [head.id, head]));
  const drafts = new Map<string, StoryContent>();
  for (const finding of [...findings].sort((a, b) => b.start - a.start)) {
    if (finding.replacement === undefined) continue;
    const head = heads.get(finding.storyId);
    if (!head) throw new Error('The story changed. Run the house style check again.');
    let draft = drafts.get(head.id);
    if (!draft) drafts.set(head.id, draft = structuredClone(contentOf(head)));
    const run = draft.paragraphs[finding.paragraph]?.runs[finding.run];
    const end = finding.start + finding.text.length;
    if (!run || run.noteId || run.reference || run.indexId || run.text.slice(finding.start, end) !== finding.text) {
      throw new Error('The story changed. Run the house style check again.');
    }
    run.text = run.text.slice(0, finding.start) + finding.replacement + run.text.slice(end);
  }
  return [...drafts].map(([elementId, content]) => ({ elementId, content }));
}
