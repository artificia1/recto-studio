import type { ProjectState, StoryRun } from '../types';
import { MAX_UNIT_LENGTH, languageTag, translationText, type TranslationGroup, type TranslationPart, type TranslationUnit } from './catalog';
import type { ReturnedTranslation, ReturnedUnit } from './xliff';

export type TranslationStatus = 'ready' | 'draft' | 'missing' | 'unchanged' | 'conflict' | 'invalid' | 'unknown';

export interface TranslationReviewRow {
  key: string;
  label: string;
  group: string;
  page?: number;
  frameId?: string;
  status: TranslationStatus;
  source: string;
  target?: string;
  detail?: string;
}

export interface TranslationReview {
  sourceLanguage: string;
  targetLanguage: string;
  rows: TranslationReviewRow[];
  candidates: Map<string, { unit: TranslationUnit; returned: ReturnedUnit }>;
}

function equivalentParts(a: TranslationPart[], b: TranslationPart[]) {
  return a.length === b.length && a.every((part, index) => {
    const other = b[index];
    if (part.kind !== other.kind) return false;
    if (part.kind === 'text') return other.kind === 'text' && part.text === other.text;
    if (part.kind === 'marker') return other.kind === 'marker' && part.id === other.id;
    return other.kind === 'format' && part.id === other.id && part.text === other.text;
  });
}

export function validateTranslation(unit: TranslationUnit, target: TranslationPart[]): string | undefined {
  const codeKinds = new Map(unit.source.flatMap(part => part.kind === 'text' ? [] : [[part.id, part.kind] as const]));
  const seen = new Set<string>();
  for (const part of target) {
    if (part.kind === 'text') continue;
    if (seen.has(part.id) || codeKinds.get(part.id) !== part.kind) {
      return 'An inline code was duplicated, added or changed.';
    }
    seen.add(part.id);
  }
  if (seen.size !== codeKinds.size) return 'Keep each formatting code and protected marker exactly once.';
  const controls = (parts: TranslationPart[]) => parts.flatMap(part =>
    part.kind === 'marker' && /^\{\/?cond[:}]/i.test(unit.codes.get(part.id)?.text || '') ? [part.id] : []);
  if (controls(unit.source).join(',') !== controls(target).join(',')) return 'Keep conditional-text boundaries in their original order.';
  const text = translationText(target, unit.codes);
  if (!target.some(part => part.kind !== 'marker' && part.text.trim())) return 'Enter a translation for this unit.';
  if (text.length > MAX_UNIT_LENGTH) return 'The translated unit exceeds 24,000 characters.';
  if (!/^[\u0009\u000a\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]*$/u.test(text)) return 'The target contains characters unavailable in XML.';
  if ((unit.address.kind === 'paragraph' || unit.address.kind === 'parent') &&
    target.some(part => part.kind !== 'marker' && part.text.includes('\n'))) {
    return 'A paragraph unit cannot introduce new paragraph breaks.';
  }
  return undefined;
}

export function translatedRuns(unit: TranslationUnit, target: TranslationPart[]): StoryRun[] {
  const problem = validateTranslation(unit, target);
  if (problem) throw new Error(problem);
  return target.map(part => {
    if (part.kind === 'text') return { text: part.text };
    const original = unit.codes.get(part.id)!;
    return part.kind === 'marker' ? structuredClone(original) : { ...original, text: part.text };
  });
}

export function reviewTranslation(state: ProjectState, catalog: TranslationGroup[], exchange: ReturnedTranslation): TranslationReview {
  const language = languageTag(state.settings.language || 'en');
  if (exchange.sourceLanguage !== language) {
    throw new Error(`This exchange is from ${exchange.sourceLanguage}. The open publication uses ${language}.`);
  }
  const byKey = new Map(catalog.flatMap(group => group.units.map(unit => [unit.key, unit] as const)));
  const candidates: TranslationReview['candidates'] = new Map();
  const rows: TranslationReviewRow[] = [];
  const labels = new Map(catalog.map(group => [group.id, group.label]));
  for (const returned of exchange.units) {
    const unit = byKey.get(returned.key);
    if (!unit) {
      rows.push({ key: returned.key, group: 'Missing from publication', label: 'Unknown unit', status: 'unknown',
        source: translationText(returned.source), detail: 'The source object or paragraph was removed, or this file belongs to another publication.' });
      continue;
    }
    const row: TranslationReviewRow = {
      key: unit.key, group: labels.get(unit.group) || unit.group, label: unit.label, page: unit.page, frameId: unit.frameId,
      source: translationText(unit.source, unit.codes), target: returned.target && translationText(returned.target, unit.codes), status: 'missing',
    };
    if (!equivalentParts(unit.source, returned.source)) {
      row.status = 'conflict';
      row.detail = 'Source text or inline codes changed since export. Export a fresh unit and reconcile the translation.';
    } else if (returned.targetError) {
      row.status = 'invalid';
      row.detail = returned.targetError;
    } else if (returned.target?.some(part => part.kind !== 'marker' && part.text.trim())) {
      row.detail = validateTranslation(unit, returned.target);
      if (row.detail) row.status = 'invalid';
      else if (equivalentParts(unit.source, returned.target) && returned.state === 'initial') {
        row.status = 'unchanged';
        row.detail = 'The target repeats the source and is still marked initial.';
      } else {
        row.status = returned.state === 'initial' ? 'draft' : 'ready';
        candidates.set(unit.key, { unit, returned });
      }
    }
    rows.push(row);
  }
  return { sourceLanguage: exchange.sourceLanguage, targetLanguage: exchange.targetLanguage, rows, candidates };
}

export function reviewedTargets(review: TranslationReview, selected: ReadonlySet<string>) {
  const targets = new Map<string, TranslationPart[]>();
  for (const key of selected) {
    const candidate = review.candidates.get(key);
    if (!candidate?.returned.target) throw new Error('Select only translations that passed review.');
    targets.set(key, candidate.returned.target);
  }
  return targets;
}

/** Re-export outstanding units using today's source and original stable addresses. */
export function outstandingTranslationGroups(catalog: TranslationGroup[], review: TranslationReview, selected: ReadonlySet<string>) {
  const unresolved = new Set(review.rows.filter(row => row.status !== 'unknown' && !selected.has(row.key)).map(row => row.key));
  return catalog.map(group => ({ ...group, units: group.units.filter(unit => unresolved.has(unit.key)) })).filter(group => group.units.length);
}

export function updateReviewedTranslation(review: TranslationReview, key: string, target: TranslationPart[]): TranslationReview {
  const candidate = review.candidates.get(key);
  if (!candidate) throw new Error('Choose a valid returned unit before editing its translation.');
  const error = validateTranslation(candidate.unit, target);
  if (error) throw new Error(error);
  const candidates = new Map(review.candidates);
  candidates.set(key, { unit: candidate.unit, returned: { ...candidate.returned, target, state: 'reviewed' } });
  return { ...review, candidates, rows: review.rows.map(row => row.key === key
    ? { ...row, target: translationText(target, candidate.unit.codes), status: 'ready', detail: undefined }
    : row) };
}
