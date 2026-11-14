import { DOMParser } from '@xmldom/xmldom';
import type { ProjectState } from '../../src/types';
import { translationCatalog } from '../../src/translation/catalog';
import { buildTranslatedEdition } from '../../src/translation/edition';
import { reviewTranslation } from '../../src/translation/review';
import { readTranslationExchange } from '../../src/translation/xliff';
import { assertEditable, resolveStory } from './publication';

export function proposeTranslation(source: ProjectState, xml: string, selected?: string[]) {
  const exchange = readTranslationExchange(xml, text => {
    const parser = new DOMParser({ onError: (_level, message) => { throw new Error(message); } });
    return parser.parseFromString(text, 'application/xml').documentElement;
  });
  const catalog = translationCatalog(source);
  const review = reviewTranslation(source, catalog, exchange);
  const rows = new Map(review.rows.map(row => [row.key, row]));
  const units = new Map(catalog.flatMap(group => group.units.map(unit => [unit.key, { unit, group }] as const)));
  const allFrames = new Map([...source.spreads, ...source.masterSpreads].flatMap(spread =>
    spread.elements.map(frame => [frame.id, frame] as const)));
  const locked = new Set(source.layers.filter(layer => layer.locked).map(layer => layer.id));
  const safeKeys = new Set<string>();
  const blocked: { key: string; reason: string }[] = [];
  for (const key of new Set(selected ?? review.rows.map(row => row.key))) {
    const row = rows.get(key);
    const target = units.get(key);
    if (!row || row.status !== 'ready' || !target) {
      blocked.push({ key, reason: row?.detail || `The unit status is ${row?.status || 'unknown'}.` });
      continue;
    }
    const frame = row.frameId && allFrames.get(row.frameId);
    if (target.group.restricted || frame && (frame.locked || locked.has(frame.layerId || 'layer-1'))) {
      blocked.push({ key, reason: 'The target is locked, hidden, or outside the active edition.' });
      continue;
    }
    if (target.unit.address.kind === 'paragraph' && row.frameId) {
      try { assertEditable(source, resolveStory(source, row.frameId).frames); }
      catch { blocked.push({ key, reason: 'A linked story frame is locked or the thread is incomplete.' }); continue; }
    }
    safeKeys.add(key);
  }
  const summary = { sourceLanguage: review.sourceLanguage, targetLanguage: review.targetLanguage,
    totalReturned: review.rows.length, readyCount: safeKeys.size,
    blocked: { total: blocked.length, items: blocked.slice(0, 25) },
    units: review.rows.slice(0, 25).map(({ key, status, label, page, detail }) => ({ key, status, label, page, detail })) };
  // An explicit selection is atomic. The caller can opt in to a subset by
  // providing another list after reviewing the rejected units.
  if (!safeKeys.size || blocked.length) return { summary, translated: null };
  const translated = buildTranslatedEdition(source, review, safeKeys);
  return { summary, translated };
}
