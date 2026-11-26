/**
 * Where a paragraph style should go when it is applied from the UI while a text frame is being edited.
 * Pure functions, so the rules can be unit-tested without a DOM.
 */

/**
 * Paragraph indices (text split on '\n') touched by a caret or selection in a textarea.
 * A caret belongs to exactly one paragraph. A selection covers every paragraph it contains a
 * character of, where a paragraph's trailing '\n' counts as part of it; a selection that merely
 * ends where the next paragraph begins does not reach into that next paragraph.
 */
export function paragraphIndicesForRange(value: string, start: number | null, end: number | null): number[] | null {
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  const selStart = Math.min(start, end);
  const selEnd = Math.max(start, end);
  const collapsed = selStart === selEnd;
  const lines = value.split('\n');

  const indices: number[] = [];
  let charStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const charEnd = charStart + lines[i].length; // index of this paragraph's '\n' (or end of text)
    const touches = collapsed
      ? selStart >= charStart && selStart <= charEnd
      : selStart <= charEnd && selEnd > charStart;
    if (touches) indices.push(i);
    charStart = charEnd + 1;
  }
  return indices.length > 0 ? indices : null;
}

export type ParagraphStyleTarget =
  | { kind: 'frame' }
  | { kind: 'range'; start: number; end: number };

/**
 * `text` is the frame's own text (what the editor shows) and `selStart`/`selEnd` are offsets into it.
 * `storyStart` is where this frame's text begins inside the whole story: threaded frames share one
 * story, and story ranges are measured from its beginning, not from the frame.
 *
 * When the selection reaches every paragraph of the frame the style goes to the frame as a whole, like
 * selecting the frame in InDesign. Otherwise it targets only the touched paragraphs.
 */
export function planParagraphStyleTarget(
  text: string,
  selStart: number,
  selEnd: number,
  storyStart: number = 0,
): ParagraphStyleTarget {
  const touched = paragraphIndicesForRange(text, selStart, selEnd);
  const total = text.split('\n').length;
  if (!touched || touched.length >= total) return { kind: 'frame' };
  return {
    kind: 'range',
    start: storyStart + Math.min(selStart, selEnd),
    end: storyStart + Math.max(selStart, selEnd),
  };
}
