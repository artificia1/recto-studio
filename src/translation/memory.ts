import {
  languageTag, MAX_UNIT_LENGTH, translationText, type TranslationGroup, type TranslationPart,
} from './catalog';
import type { ReturnedTranslation, ReturnedUnit } from './xliff';
import type { TranslationReview } from './review';

interface MemoryPair { source: string; targets: string[] }

export interface TranslationMemory {
  version: 1;
  sourceLanguage: string;
  targetLanguage: string;
  entries: MemoryPair[];
}

export const MAX_MEMORY_BYTES = 8 * 1024 * 1024;
const MAX_MEMORY_ENTRIES = 6000;
const MAX_ALTERNATIVES = 8;
const plain = (text: string): TranslationPart[] => [{ kind: 'text', text }];
const normalized = (text: string) => text.replace(/\r\n?/g, '\n').normalize('NFC');
const validText = (value: unknown): value is string => typeof value === 'string' && !!value.trim() &&
  value.length <= MAX_UNIT_LENGTH && /^[\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]*$/u.test(value);

function validPair(source: string, target: string) {
  const sourceLanguage = languageTag(source);
  const targetLanguage = languageTag(target);
  if (sourceLanguage === targetLanguage) throw new Error('Choose two different languages for the translation memory.');
  return { sourceLanguage, targetLanguage };
}

export function readTranslationMemory(value: string): TranslationMemory {
  if (value.length > MAX_MEMORY_BYTES || new Blob([value]).size > MAX_MEMORY_BYTES) throw new Error('Choose a memory file smaller than 8 MiB.');
  const parsed = JSON.parse(value);
  if (!parsed || parsed.version !== 1 || typeof parsed.sourceLanguage !== 'string' ||
    typeof parsed.targetLanguage !== 'string' || !Array.isArray(parsed.entries) || parsed.entries.length > MAX_MEMORY_ENTRIES) {
    throw new Error('Choose a valid Recto translation memory.');
  }
  const languages = validPair(parsed.sourceLanguage, parsed.targetLanguage);
  const sources = new Set<string>();
  const entries: MemoryPair[] = parsed.entries.map((entry: MemoryPair) => {
    if (!entry || !validText(entry.source) || !Array.isArray(entry.targets) || !entry.targets.length ||
      entry.targets.length > MAX_ALTERNATIVES || !entry.targets.every(validText)) {
      throw new Error('A translation memory entry is invalid.');
    }
    const source = normalized(entry.source);
    if (sources.has(source)) throw new Error('A translation memory contains duplicate source entries.');
    sources.add(source);
    return { source, targets: [...new Set(entry.targets.map(normalized))] };
  });
  return { version: 1, ...languages, entries };
}

export function serializeTranslationMemory(memory: TranslationMemory): string {
  const content = JSON.stringify(memory);
  if (new Blob([content]).size > MAX_MEMORY_BYTES) throw new Error('The combined translation memory exceeds 8 MiB.');
  return content;
}

export function combineTranslationMemories(current: TranslationMemory, incoming: TranslationMemory): TranslationMemory {
  if (current.sourceLanguage !== incoming.sourceLanguage || current.targetLanguage !== incoming.targetLanguage) {
    throw new Error('Both memories must use the same source and target languages.');
  }
  const entries = new Map(current.entries.map(entry => [entry.source, new Set(entry.targets)]));
  for (const { source, targets } of incoming.entries) {
    let choices = entries.get(source);
    if (!choices) entries.set(source, choices = new Set());
    for (const target of targets) choices.add(target);
    if (choices.size > MAX_ALTERNATIVES) throw new Error('Resolve older conflicting translations before merging more alternatives.');
  }
  if (entries.size > MAX_MEMORY_ENTRIES) throw new Error('The combined translation memory exceeds 6,000 entries.');
  const result = { ...current, entries: [...entries].map(([source, targets]) => ({ source, targets: [...targets] })) };
  serializeTranslationMemory(result);
  return result;
}

export function rememberReviewedTranslations(review: TranslationReview, selected: ReadonlySet<string>) {
  const entries = new Map<string, Set<string>>();
  let skipped = 0;
  for (const key of selected) {
    const candidate = review.candidates.get(key);
    if (!candidate?.returned.target || candidate.unit.codes.size) {
      skipped++;
      continue;
    }
    const source = normalized(translationText(candidate.unit.source));
    const target = normalized(translationText(candidate.returned.target));
    let alternatives = entries.get(source);
    if (!alternatives) entries.set(source, alternatives = new Set());
    alternatives.add(target);
    if (alternatives.size > MAX_ALTERNATIVES) throw new Error('More than eight translations share one source. Review the conflicting variants first.');
  }
  if (entries.size > MAX_MEMORY_ENTRIES) throw new Error('A translation memory supports up to 6,000 source entries.');
  const memory: TranslationMemory = {
    version: 1, sourceLanguage: review.sourceLanguage, targetLanguage: review.targetLanguage,
    entries: [...entries].map(([source, alternatives]) => ({ source, targets: [...alternatives] })),
  };
  serializeTranslationMemory(memory);
  return { memory, skipped };
}

export interface TranslationMemoryConflict {
  key: string;
  source: string;
  options: string[];
  group: string;
}

export function findTranslationMemoryMatches(groups: TranslationGroup[], memory: TranslationMemory,
  choices: ReadonlyMap<string, string> = new Map()) {
  const entries = new Map(memory.entries.map(entry => [entry.source, entry.targets]));
  const conflicts: TranslationMemoryConflict[] = [];
  const units: ReturnedUnit[] = [];
  let unmatched = 0;
  let protectedUnits = 0;
  for (const group of groups) for (const unit of group.units) {
    if (unit.codes.size) {
      protectedUnits++;
      continue;
    }
    const source = translationText(unit.source);
    const targets = entries.get(normalized(source));
    if (!targets?.length) {
      unmatched++;
      continue;
    }
    const choice = choices.get(unit.key);
    if (targets.length > 1 && (choice === undefined || !targets.includes(choice))) {
      conflicts.push({ key: unit.key, source, options: targets, group: group.label });
      continue;
    }
    units.push({ key: unit.key, source: unit.source, target: plain(choice ?? targets[0]), state: 'translated' });
  }
  const exchange: ReturnedTranslation = { sourceLanguage: memory.sourceLanguage, targetLanguage: memory.targetLanguage, units };
  return { exchange, conflicts, unmatched, protectedUnits };
}
