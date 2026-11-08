import type { StoryContent } from '../types';

export interface AuthoritySuggestion { start: number; end: number; text: string; category: 'cases' | 'statutes' }

/** Limited US-style heuristics. Suggestions require editorial review; no legal validation. */
export function authoritySuggestions(content: StoryContent): AuthoritySuggestion[] {
  const result: AuthoritySuggestion[] = [];
  let offset = 0;
  for (const paragraph of content.paragraphs) {
    if (offset >= 1_000_000) break;
    const original = paragraph.runs.map(run => run.text).join('');
    const text = original.slice(0, 1_000_000 - offset);
    const patterns = [
      { category: 'cases' as const, regex: /\b[A-Z][A-Za-z.'’\-]*(?: [A-Za-z][A-Za-z.'’\-]*){0,9} v\. [A-Z][A-Za-z.'’\-]*(?: [A-Za-z][A-Za-z.'’\-]*){0,9}, \d{1,4} [A-Z][A-Za-z.\d ]{0,20} \d{1,6}(?:, \d{1,6})? \(\d{4}\)/g },
      { category: 'statutes' as const, regex: /\b\d{1,3} U\.S\.C\. §§?\s*[A-Za-z0-9().\-]{1,40}/g },
    ];
    for (const { regex, category } of patterns) for (const match of text.matchAll(regex)) {
      if (result.length >= 200) return result.sort((a, b) => a.start - b.start);
      result.push({ start: offset + match.index!, end: offset + match.index! + match[0].length, text: match[0], category });
    }
    offset += original.length + 1;
  }
  return result.sort((a, b) => a.start - b.start);
}
