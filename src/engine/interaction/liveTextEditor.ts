/**
 * In-place text editing on the canvas.
 *
 * A textarea still owns the text, the selection and every input method (keyboard, IME, clipboard,
 * its own undo), but it is invisible. The canvas draws the frame from the textarea's current value
 * with the document's composer, so each paragraph shows its own style while typing, and this class
 * paints the selection, positions the caret and maps clicks and vertical keys onto the composed lines.
 */
import type { StoryContent, TextElement } from '../../types';
import type { StoryLine } from '../storyLayout';
import { editStory, storyText } from '../storyContent';
import { applyTextEdit, caretAt, lineIndexAt, lineOffsetAt, offsetAtPoint, paragraphRangeAt, replayEdits, selectionRects,
  textEdit, verticalTarget, wordRangeAt, type CaretAffinity, type LiveLine, type TextEdit } from '../liveTextEditing';

const PT = 25.4 / 72;
export interface LiveTextComposition {
  content: StoryContent;
  lines: StoryLine[];
  consumed: number;
  overset: boolean;
  live: LiveLine[];
  /** Plain frames hang their text from the top of the line, as the legacy renderer draws them. */
  topBaseline: boolean;
}

/** Frame position on the canvas, in CSS pixels from the canvas corner. */
export interface LiveTextBox { x: number; y: number; pxPerMm: number }

export interface LiveTextHost {
  parent: HTMLElement;
  frame(): TextElement | null;
  /** `content` is the edited formatted story, or null for a plain frame. */
  compose(frame: TextElement, value: string, content: StoryContent | null): LiveTextComposition;
  box(frame: TextElement): LiveTextBox;
  requestRender(): void;
  /** `toUi` is set when focus moved to a control outside the canvas. */
  close(commit: boolean, toUi?: boolean): void;
}

export interface LiveTextOpenOptions {
  /** Restore this selection instead of selecting everything. */
  selection?: { start: number; end: number };
  /** Put the caret under this pointer position (client coordinates). */
  point?: { clientX: number; clientY: number };
}

type DragMode = 'character' | 'word' | 'paragraph';

export class LiveTextEditor {
  public readonly elementId: string;
  public readonly textarea: HTMLTextAreaElement;
  private readonly caret: HTMLDivElement;
  private readonly lifetime = new AbortController();
  private affinity: CaretAffinity = 'start';
  private goalX: number | null = null;
  private known = { start: 0, end: 0 };
  private drag: { mode: DragMode; start: number; end: number } | null = null;
  private composed: { value: string; result: LiveTextComposition } | null = null;
  private committedText: string;
  /** Edits since `committedText`, and the formatted content they produce from the frame's own. */
  private edits: TextEdit[] = [];
  private lastValue: string;
  private draft: { base: StoryContent; content: StoryContent; value: string } | null = null;
  private compositionStart: number | null = null;
  private caretKey = '';
  private closed = false;

  constructor(private readonly host: LiveTextHost, frame: TextElement, canvas: HTMLCanvasElement,
    options: LiveTextOpenOptions = {}) {
    this.elementId = frame.id;
    this.committedText = this.lastValue = frame.text || '';

    const textarea = document.createElement('textarea');
    textarea.className = 'canvas-inline-editor canvas-inline-editor--live';
    textarea.value = this.committedText;
    textarea.spellcheck = false;
    textarea.setAttribute('aria-label', 'Text frame content');
    textarea.style.position = 'absolute';
    textarea.style.boxSizing = 'border-box';
    textarea.style.fontFamily = frame.fontFamily || 'Inter, system-ui, sans-serif';
    this.textarea = textarea;

    this.caret = document.createElement('div');
    this.caret.className = 'canvas-live-caret';
    this.caret.style.display = 'none';

    const listen = { signal: this.lifetime.signal };
    textarea.addEventListener('keydown', event => this.handleKeyDown(event), listen);
    textarea.addEventListener('input', () => {
      this.recordEdit();
      this.affinity = 'start';
      this.goalX = null;
      this.known = { start: textarea.selectionStart, end: textarea.selectionEnd };
      this.host.requestRender();
    }, listen);
    textarea.addEventListener('compositionstart', () => { this.compositionStart = textarea.selectionStart; }, listen);
    textarea.addEventListener('compositionend', () => { this.compositionStart = null; this.host.requestRender(); }, listen);
    textarea.addEventListener('select', () => this.noteSelection(), listen);
    textarea.addEventListener('keyup', () => this.noteSelection(), listen);
    document.addEventListener('selectionchange', () => this.noteSelection(), listen);
    textarea.addEventListener('blur', event => {
      if (this.closed) return;
      const next = event.relatedTarget;
      this.host.close(true, next instanceof HTMLElement && !canvas.contains(next));
    }, listen);

    host.parent.append(textarea, this.caret);
    this.place(frame, host.box(frame));
    textarea.focus({ preventScroll: true });

    const length = textarea.value.length;
    if (options.selection) {
      this.select(Math.min(options.selection.start, length), Math.min(options.selection.end, length));
    } else if (options.point) {
      const bounds = canvas.getBoundingClientRect();
      const hit = this.hit(frame, options.point.clientX - bounds.left, options.point.clientY - bounds.top);
      this.select(hit?.offset ?? length, hit?.offset ?? length, hit?.affinity);
    } else {
      this.select(0, length);
    }
  }

  public get value(): string { return this.textarea.value; }
  public get selection(): { start: number; end: number } {
    return { start: this.textarea.selectionStart, end: this.textarea.selectionEnd };
  }
  public get dragging(): boolean { return this.drag !== null; }

  /** The end of the selection that moves; the anchor is the end that stays. */
  private get focusOffset(): number {
    return this.textarea.selectionDirection === 'backward' ? this.textarea.selectionStart : this.textarea.selectionEnd;
  }
  private get anchorOffset(): number {
    return this.textarea.selectionDirection === 'backward' ? this.textarea.selectionEnd : this.textarea.selectionStart;
  }

  private select(anchor: number, focus: number, affinity: CaretAffinity = 'start') {
    const start = Math.min(anchor, focus), end = Math.max(anchor, focus);
    this.textarea.setSelectionRange(start, end, focus < anchor ? 'backward' : 'forward');
    this.known = { start, end };
    this.affinity = affinity;
    this.host.requestRender();
  }

  /** The textarea moved its own caret (typing, Left/Right, word jumps): drop our line bookkeeping. */
  private noteSelection() {
    const { selectionStart: start, selectionEnd: end } = this.textarea;
    if (start === this.known.start && end === this.known.end) return;
    this.known = { start, end };
    this.affinity = 'start';
    this.goalX = null;
    this.host.requestRender();
  }

  /** Each input event is one contiguous change; fold it into the formatted draft straight away. */
  private recordEdit() {
    const value = this.textarea.value;
    if (value === this.lastValue) return;
    // After typing, deleting or pasting the caret sits at the end of what changed.
    const edit = textEdit(this.lastValue, value, this.textarea.selectionEnd);
    this.edits.push(edit);
    this.lastValue = value;
    const base = this.host.frame()?.textContent;
    if (this.draft && this.draft.base === base) {
      this.draft = { base, value, content: applyTextEdit(this.draft.content, edit) };
    }
  }

  /**
   * The frame's formatted content with this session's edits applied, or null for a plain frame.
   * Paragraph styles and character formatting outside each edit are exactly the document's.
   */
  public content(frame: TextElement): StoryContent | null {
    const base = frame.textContent;
    if (!base) { this.draft = null; return null; }
    const value = this.textarea.value;
    if (this.draft?.base === base) {
      if (this.draft.value !== value) this.draft = { base, value, content: editStory(this.draft.content, value) };
    } else if (storyText(base) === this.committedText) {
      // The document recomposed this frame (or the session just began): replay our edits on its content.
      this.draft = { base, value, content: replayEdits(base, this.edits) };
    } else {
      this.draft = { base, value, content: editStory(base, value) };
    }
    return this.draft.content;
  }

  /** Compose the frame from the current text. The canvas calls this on every paint. */
  public compose(frame: TextElement): LiveTextComposition {
    const value = this.textarea.value;
    const result = this.host.compose(frame, value, this.content(frame));
    this.composed = { value, result };
    return result;
  }

  /** Lines for input handling: reuse the last paint unless the text changed since. */
  private lines(frame: TextElement): LiveLine[] {
    if (this.composed?.value === this.textarea.value) return this.composed.result.live;
    return this.compose(frame).live;
  }

  private hit(frame: TextElement, canvasX: number, canvasY: number) {
    const box = this.host.box(frame);
    return offsetAtPoint(this.lines(frame), frame, (canvasX - box.x) / box.pxPerMm, (canvasY - box.y) / box.pxPerMm);
  }

  private place(frame: TextElement, box: LiveTextBox) {
    // The textarea covers the frame, but never leaves the visible canvas: a focused field outside it
    // would make the browser scroll the canvas container to reveal it on the next keystroke.
    const span = (start: number, size: number, limit: number) => {
      const from = Math.max(0, Math.min(start, limit - 24));
      return [from, Math.max(24, Math.min(start + size, limit) - from)];
    };
    const [left, width] = span(Math.round(box.x), Math.max(80, Math.round(frame.width * box.pxPerMm)), this.host.parent.clientWidth);
    const [top, height] = span(Math.round(box.y), Math.max(40, Math.round(frame.height * box.pxPerMm)), this.host.parent.clientHeight);
    const style = this.textarea.style;
    style.left = `${left}px`;
    style.top = `${top}px`;
    style.width = `${width}px`;
    style.height = `${height}px`;
  }

  /** Paint the selection under the text and move the caret. Called by the canvas before it draws the lines. */
  public paint(ctx: CanvasRenderingContext2D, frame: TextElement, composition: LiveTextComposition, box: LiveTextBox) {
    this.place(frame, box);
    const { start, end } = this.selection;
    const focused = document.activeElement === this.textarea;
    if (end > start) {
      ctx.save();
      ctx.fillStyle = focused ? 'rgba(13, 153, 255, 0.32)' : 'rgba(128, 128, 128, 0.3)';
      for (const rect of selectionRects(composition.live, start, end)) {
        ctx.fillRect(box.x + rect.x * box.pxPerMm, box.y + rect.y * box.pxPerMm, rect.width * box.pxPerMm, rect.height * box.pxPerMm);
      }
      ctx.restore();
    }
    if (this.compositionStart !== null && end > this.compositionStart) {
      // Mark text an input method is still composing, as a native field would.
      ctx.save();
      ctx.fillStyle = frame.color || '#111111';
      for (const rect of selectionRects(composition.live, this.compositionStart, end)) {
        ctx.fillRect(box.x + rect.x * box.pxPerMm, box.y + (rect.y + rect.height) * box.pxPerMm - 2, rect.width * box.pxPerMm, 1);
      }
      ctx.restore();
    }

    const position = focused && start === end ? caretAt(composition.live, this.focusOffset, this.affinity) : null;
    const size = position ? position.fontSizePt * PT : 0;
    // Story text sits on a baseline one type size below the line top; plain text hangs from the top.
    const top = position ? position.y + size * (composition.topBaseline ? 0 : 0.15) : 0;
    if (!position || top + size < 0 || top > frame.height) {
      this.caret.style.display = 'none';
      this.caretKey = '';
      return;
    }
    const left = box.x + position.x * box.pxPerMm, y = box.y + top * box.pxPerMm, height = size * 1.12 * box.pxPerMm;
    const key = `${left.toFixed(1)}:${y.toFixed(1)}:${height.toFixed(1)}`;
    this.caret.style.display = 'block';
    this.caret.style.left = `${left - 0.75}px`;
    this.caret.style.top = `${y}px`;
    this.caret.style.height = `${height}px`;
    this.caret.style.backgroundColor = position.color || '#111111';
    if (key !== this.caretKey) {
      // Keep the caret solid while it moves; the blink restarts from its visible phase.
      this.caretKey = key;
      this.caret.style.animation = 'none';
      void this.caret.offsetWidth;
      this.caret.style.animation = '';
    }
  }

  /** Where the caret is drawn, in canvas CSS pixels. For tests and tooling. */
  public caretBox(): { x: number; y: number; height: number } | null {
    if (this.caret.style.display === 'none') return null;
    return { x: parseFloat(this.caret.style.left) + 0.75, y: parseFloat(this.caret.style.top), height: parseFloat(this.caret.style.height) };
  }

  private handleKeyDown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.host.close(false);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      this.host.close(true);
      return;
    }
    const frame = this.host.frame();
    if (!frame) return;
    const apple = /Mac|iPhone|iPad/.test(navigator.platform);
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    let handled = false;
    // The textarea wraps its own text differently from the page, so anything line-based is ours.
    if (plain && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      handled = this.moveVertically(frame, event.key === 'ArrowUp' ? -1 : 1, event.shiftKey);
    } else if (plain && (event.key === 'PageUp' || event.key === 'PageDown')) {
      handled = this.moveVertically(frame, event.key === 'PageUp' ? -1 : 1, event.shiftKey, true);
    } else if (plain && (event.key === 'Home' || event.key === 'End')) {
      handled = this.moveToLineEdge(frame, event.key === 'End', event.shiftKey);
    } else if (apple && event.metaKey && !event.ctrlKey && !event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      handled = this.moveToLineEdge(frame, event.key === 'ArrowRight', event.shiftKey);
    }
    if (handled) event.preventDefault();
  }

  private moveVertically(frame: TextElement, direction: -1 | 1, extend: boolean, page = false): boolean {
    const lines = this.lines(frame);
    const position = caretAt(lines, this.focusOffset, this.affinity);
    // An overset caret has no line to move from; let the textarea handle the key.
    if (!position) return false;
    const goal = this.goalX ?? position.x;
    let edge = position.line;
    // Page keys travel to the first or last line of the column the caret is in.
    while (page && lines[edge + direction]?.column === lines[position.line].column) edge += direction;
    const target = edge !== position.line ? lineOffsetAt(lines[edge], goal)
      : verticalTarget(lines, position.line, direction, goal, this.textarea.value.length);
    this.select(extend ? this.anchorOffset : target.offset, target.offset, target.affinity);
    this.goalX = goal;
    return true;
  }

  private moveToLineEdge(frame: TextElement, end: boolean, extend: boolean): boolean {
    const lines = this.lines(frame);
    const index = lineIndexAt(lines, this.focusOffset, this.affinity);
    if (index === -1) return false;
    const line = lines[index];
    const offset = end ? line.end : line.start;
    this.goalX = null;
    this.select(extend ? this.anchorOffset : offset, offset, end && !line.hard ? 'end' : 'start');
    return true;
  }

  /** A press on the canvas. Returns false when it missed the frame, so the canvas handles it. */
  public pointerDown(canvasX: number, canvasY: number, event: { shiftKey?: boolean; detail?: number }): boolean {
    const frame = this.host.frame();
    if (!frame) return false;
    const box = this.host.box(frame);
    const x = (canvasX - box.x) / box.pxPerMm, y = (canvasY - box.y) / box.pxPerMm;
    if (x < 0 || y < 0 || x > frame.width || y > frame.height) return false;
    const hit = this.hit(frame, canvasX, canvasY);
    if (!hit) return true;
    const clicks = event.detail || 1;
    const text = this.textarea.value;
    this.goalX = null;
    if (document.activeElement !== this.textarea) this.textarea.focus({ preventScroll: true });
    if (clicks >= 3) {
      const range = paragraphRangeAt(text, hit.offset);
      this.drag = { mode: 'paragraph', ...range };
      this.select(range.start, range.end);
    } else if (clicks === 2) {
      const range = wordRangeAt(text, hit.offset);
      this.drag = { mode: 'word', ...range };
      this.select(range.start, range.end);
    } else {
      const anchor = event.shiftKey ? this.anchorOffset : hit.offset;
      this.drag = { mode: 'character', start: anchor, end: anchor };
      this.select(anchor, hit.offset, hit.affinity);
    }
    return true;
  }

  /** Pointer movement. Extends a drag selection; reports whether the pointer is over the frame's text. */
  public pointerMove(canvasX: number, canvasY: number, buttons?: number): 'drag' | 'over' | null {
    const frame = this.host.frame();
    if (!frame) return null;
    // The button was released where no mouseup reached us (outside the window): the drag is over.
    if (buttons === 0) this.drag = null;
    if (this.drag) {
      const hit = this.hit(frame, canvasX, canvasY);
      if (hit) {
        const text = this.textarea.value;
        const range = this.drag.mode === 'word' ? wordRangeAt(text, hit.offset)
          : this.drag.mode === 'paragraph' ? paragraphRangeAt(text, hit.offset) : { start: hit.offset, end: hit.offset };
        // Dragging backwards keeps the far end of the word or paragraph the drag began on.
        if (range.start < this.drag.start) this.select(this.drag.end, range.start);
        else this.select(this.drag.start, Math.max(range.end, this.drag.end), this.drag.mode === 'character' ? hit.affinity : 'start');
      }
      return 'drag';
    }
    const box = this.host.box(frame);
    const x = (canvasX - box.x) / box.pxPerMm, y = (canvasY - box.y) / box.pxPerMm;
    return x >= 0 && y >= 0 && x <= frame.width && y <= frame.height ? 'over' : null;
  }

  public pointerUp(): boolean {
    if (!this.drag) return false;
    this.drag = null;
    return true;
  }

  /** Follow text changes made elsewhere (inspector, reflow, collaborators) while nothing is pending here. */
  public syncWithState(frame: TextElement) {
    // The frame, its styles or its neighbours may have changed: compose afresh for the next input.
    this.composed = null;
    const current = frame.text || '';
    if (current === this.committedText) return;
    if (this.textarea.value === this.committedText) {
      const { selectionStart, selectionEnd, selectionDirection } = this.textarea;
      this.textarea.value = current;
      this.textarea.setSelectionRange(Math.min(selectionStart, current.length), Math.min(selectionEnd, current.length), selectionDirection || 'none');
      this.known = { start: this.textarea.selectionStart, end: this.textarea.selectionEnd };
      this.edits = [];
    } else {
      // Pending typing meets a text change from elsewhere: keep the typing as one edit over the new text.
      this.edits = [textEdit(current, this.textarea.value)];
    }
    this.committedText = current;
    this.lastValue = this.textarea.value;
    this.draft = null;
  }

  public destroy() {
    this.closed = true;
    this.lifetime.abort();
    this.textarea.remove();
    this.caret.remove();
  }
}
