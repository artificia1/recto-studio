import type { ParagraphStyle, ProjectState } from '../types';
import { formattedStoryHeadsMatching } from './storyContent';

const fields = new Set<keyof ParagraphStyle>(['fontFamily', 'fontSizePt', 'lineHeight', 'letterSpacingPt', 'color', 'alignment', 'snapToBaseline', 'dropCapLines', 'opticalMarginAlignment', 'openTypeFeatures', 'pdfTag', 'grepStyles', 'balanceLines', 'shadingColor', 'shadingPaddingMm', 'shadingBorderColor', 'shadingBorderWidthMm', 'spanColumns', 'splitColumns', 'nestedStyles', 'lineStyles', 'keepWithNext', 'keepTogether', 'orphanLines', 'widowLines', 'hyphenate', 'language', 'cjkLineBreak', 'bold', 'italic']);

export function changedParagraphFormatting(before: ParagraphStyle | undefined, after: ParagraphStyle): boolean {
  if (!before) return true;
  for (const field of fields) {
    const previous = before[field], next = after[field];
    if (previous !== next && JSON.stringify(previous) !== JSON.stringify(next)) return true;
  }
  return false;
}

export function storiesUsingParagraphStyles(state: ProjectState, styleIds: ReadonlySet<string>): string[] {
  if (!styleIds.size) return [];
  return formattedStoryHeadsMatching(state,
    content => content.paragraphs.some(paragraph => styleIds.has(paragraph.styleId ?? '')),
    frame => styleIds.has(frame.paragraphStyleId ?? '')).map(head => head.id);
}

export function cascadeStyles(styles: ParagraphStyle[]): ParagraphStyle[] {
  const byId = new Map(styles.map(style => [style.id, style]));
  if (byId.size !== styles.length) throw new Error('Paragraph style IDs must be unique.');
  const resolved = new Map<string, ParagraphStyle>();
  const visiting = new Set<string>();
  const visit = (id: string): ParagraphStyle => {
    if (visiting.has(id)) throw new Error('Paragraph styles cannot inherit in a circle.');
    if (resolved.has(id)) return resolved.get(id)!;
    const style = byId.get(id); if (!style) throw new Error(`Missing paragraph style: ${id}`);
    visiting.add(id);
    const result = structuredClone(style);
    if (style.basedOnId) {
      const parent = visit(style.basedOnId);
      for (const key of style.inheritedProperties || []) {
        if (!fields.has(key)) throw new Error('Only paragraph formatting properties can be inherited.');
        (result as unknown as Record<string, unknown>)[key] = structuredClone(parent[key]);
      }
    }
    visiting.delete(id); resolved.set(id, result); return result;
  };
  return styles.map(style => visit(style.id));
}
