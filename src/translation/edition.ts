import type { CanvasElement, ProjectState, StoryContent, TextElement } from '../types';
import { contentOf, publicationSnapshot, reflowStoryState, refreshPublication } from '../engine/publicationReferences';
import { storyText } from '../engine/storyContent';
import { tableThread } from '../engine/tableCells';
import { captureComposedLayout, compareLayouts } from '../engine/layoutChanges';
import { publicationPreflight } from '../engine/publicationPreflight';
import { reviewPreflightChange } from '../engine/preflightReview';
import { resolveParagraphStyle, resolveRunStyle } from '../engine/storyLayout';
import { fontManager } from '../fontManager';
import { translationText } from './catalog';
import { reviewedTargets, translatedRuns, type TranslationReview } from './review';
import { createTranslationFrameProof } from './frameProof';

export interface TranslationFontFinding {
  frameId: string;
  family: string;
  missing: string[];
  unverified: boolean;
}

interface FontUsage { frameId: string; family: string; characters: Set<string> }

function checkFontCoverage(usage: Map<string, FontUsage>) {
  const findings: TranslationFontFinding[] = [];
  const known = new Map<string, ReturnType<typeof fontManager.getFont>>();
  const checked = new Map<string, boolean>();
  for (const { frameId, family, characters } of usage.values()) {
    if (!known.has(family)) known.set(family, fontManager.getFont(family));
    const font = known.get(family);
    if (!font) {
      findings.push({ frameId, family, missing: [], unverified: true });
      continue;
    }
    const missing: string[] = [];
    for (const char of characters) {
      const key = JSON.stringify([family, char]);
      if (!checked.has(key)) checked.set(key, font.hasGlyphForCodePoint(char.codePointAt(0)!));
      if (!checked.get(key)) missing.push(char);
      if (missing.length >= 16) break;
    }
    if (missing.length) findings.push({ frameId, family, missing, unverified: false });
  }
  return findings;
}

function addFontUsage(usages: Map<string, FontUsage>, frameId: string, family: string, text: string) {
  const key = JSON.stringify([frameId, family]);
  let usage = usages.get(key);
  if (!usage) usages.set(key, usage = { frameId, family, characters: new Set() });
  for (const character of text) if (!/[\p{White_Space}\p{Default_Ignorable_Code_Point}]/u.test(character)) {
    usage.characters.add(character);
  }
  if (!usage.characters.size) usages.delete(key);
}

/** Materialize only the checked units on an independent project copy. */
export function buildTranslatedEdition(source: ProjectState, review: TranslationReview, selected: ReadonlySet<string>) {
  if (!selected.size) throw new Error('Select at least one translation.');
  const targets = reviewedTargets(review, selected);
  const draft = structuredClone(source);
  draft.settings.language = review.targetLanguage;
  const frames = new Map<string, CanvasElement>(draft.spreads.flatMap(spread => spread.elements.map(element => [element.id, element])));
  const notes = new Map((draft.settings.footnotes || []).map(note => [note.id, note]));
  const stories = new Map<TextElement, StoryContent>();
  const parentStories = new Map<TextElement, StoryContent>();
  const tables = new Set<string>();
  const fontUsage = new Map<string, FontUsage>();
  const changedFrames = new Set<string>();
  for (const [key, target] of targets) {
    const { unit } = review.candidates.get(key)!;
    const address = unit.address;
    const text = translationText(target, unit.codes);
    const frame = 'frameId' in address ? frames.get(address.frameId) : undefined;
    if (unit.frameId) changedFrames.add(unit.frameId);
    switch (address.kind) {
      case 'title':
        draft.settings.title = text;
        break;
      case 'note': {
        const note = notes.get(address.noteId);
        if (!note) throw new Error('A note is no longer available. Refresh the review.');
        note.text = text;
        const owner = note.elementId && frames.get(note.elementId);
        if (owner && owner.type === 'text') addFontUsage(fontUsage, owner.id, draft.settings.footnoteSettings?.fontFamily || owner.fontFamily, text);
        break;
      }
      case 'caption':
        if (frame?.type !== 'text' || frame.generated?.kind !== 'caption') throw new Error('The caption changed. Refresh the review.');
        frame.generated.title = text;
        addFontUsage(fontUsage, frame.id, frame.fontFamily, text);
        break;
      case 'image':
        if (frame?.type !== 'image') throw new Error('The image changed. Refresh the review.');
        frame[address.field] = text;
        break;
      case 'parent': {
        const parentFrame = draft.masterSpreads.find(parent => parent.id === address.parentId)
          ?.elements.find(element => element.id === address.frameId);
        if (parentFrame?.type !== 'text') throw new Error('The parent page changed. Refresh the review.');
        let content = parentStories.get(parentFrame);
        if (!content) parentStories.set(parentFrame, content = parentFrame.storyContent || parentFrame.textContent || contentOf(parentFrame));
        const paragraph = content.paragraphs[address.index];
        if (!paragraph) throw new Error('The parent paragraph changed. Refresh the review.');
        paragraph.runs = translatedRuns(unit, target);
        paragraph.language = review.targetLanguage;
        break;
      }
      case 'cell': {
        if (frame?.type !== 'table' || !frame.cells[address.row]?.[address.column]) throw new Error('The table changed. Refresh the review.');
        frame.cells[address.row][address.column].text = text;
        tables.add(frame.id);
        addFontUsage(fontUsage, frame.id, frame.fontFamily, text);
        break;
      }
      case 'paragraph': {
        if (frame?.type !== 'text' || frame.prevFrameId) throw new Error('The story changed. Refresh the review.');
        let content = stories.get(frame);
        if (!content) stories.set(frame, content = contentOf(frame));
        const paragraph = address.paragraphId
          ? content.paragraphs.find(item => item.id === address.paragraphId)
          : content.paragraphs[address.index];
        if (!paragraph) throw new Error('The paragraph changed. Refresh the review.');
        paragraph.runs = translatedRuns(unit, target);
        paragraph.language = review.targetLanguage;
        const style = resolveParagraphStyle(paragraph, draft.paragraphStyles);
        for (const run of paragraph.runs) {
          if (run.noteId || run.reference || run.indexId) continue;
          const format = resolveRunStyle(frame, style, run, draft.characterStyles || []);
          addFontUsage(fontUsage, frame.id, format.fontFamily, run.text);
        }
        break;
      }
    }
  }
  for (const [frame, content] of stories) {
    frame.storyContent = content;
    frame.rawStoryText = storyText(content);
    reflowStoryState(draft, frame.id);
  }
  for (const [frame, content] of parentStories) {
    frame.text = frame.rawStoryText = storyText(content);
    frame.textContent = frame.storyContent = content;
  }
  refreshPublication(draft);
  for (const id of tables) {
    const head = frames.get(id);
    if (head?.type !== 'table') continue;
    for (const frame of tableThread(draft.spreads, head).slice(1)) frame.cells = structuredClone(head.cells);
  }
  return { draft, changedFrames, fonts: checkFontCoverage(fontUsage) };
}

export function previewTranslatedEdition(source: ProjectState, review: TranslationReview, selected: ReadonlySet<string>) {
  const { draft, fonts, changedFrames } = buildTranslatedEdition(source, review, selected);
  // Keep authored frames and IDs. Composition updates visible copy, references and note positions.
  const before = publicationSnapshot(source);
  const composed = publicationSnapshot(draft);
  return { edition: draft, fonts, changedFrames, layout: compareLayouts(captureComposedLayout(before), captureComposedLayout(composed)),
    preflight: reviewPreflightChange(publicationPreflight(before), publicationPreflight(composed)),
    frameProof: createTranslationFrameProof(before, composed, changedFrames) };
}
