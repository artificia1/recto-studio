import type { ProjectState, TextDataBinding } from '../types';
import { contentOf, textFrames } from './publicationReferences';
import { storyText } from './storyContent';

export interface DataRefreshChange { elementId: string; binding: TextDataBinding; before: string; after: string }
export function validateBinding(binding: TextDataBinding): TextDataBinding {
  for (const value of [binding.source, binding.keyField, binding.recordKey, binding.field]) {
    if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001F]/.test(value)) throw new Error('Binding names and keys must be nonempty text of up to 256 characters.');
  }
  return { source: binding.source, keyField: binding.keyField, recordKey: binding.recordKey, field: binding.field };
}
const scalar = (value: unknown): string => {
  if (typeof value === 'string' && value.length <= 16000) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  throw new Error('Bound fields need a string, finite number or boolean. Preformat prices in the source.');
};

/** Pure preview: no network access, credentials, database queries or document mutations. */
export function previewDataRefresh(state: ProjectState, source: string, records: unknown): DataRefreshChange[] {
  if (!Array.isArray(records) || records.length > 10000) throw new Error('Choose a JSON array of up to 10,000 records.');
  for (const record of records) if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length > 100) throw new Error('Every record must be an object with at most 100 fields.');
  const maps = new Map<string, Map<string, Record<string, unknown>>>();
  const changes: DataRefreshChange[] = [];
  for (const frame of textFrames(state).filter(frame => frame.dataBinding?.source === source)) {
    const binding = validateBinding(frame.dataBinding!);
    let lookup = maps.get(binding.keyField);
    if (!lookup) {
      lookup = new Map();
      for (const record of records as Record<string, unknown>[]) {
        if (!Object.hasOwn(record, binding.keyField)) throw new Error(`A record lacks key field ${binding.keyField}.`);
        const key = scalar(record[binding.keyField]);
        if (lookup.has(key)) throw new Error(`Duplicate record key: ${key}`);
        lookup.set(key, record);
      }
      maps.set(binding.keyField, lookup);
    }
    const record = lookup.get(binding.recordKey);
    if (!record || !Object.hasOwn(record, binding.field)) throw new Error(`Missing record or field for ${binding.recordKey} / ${binding.field}.`);
    const before = storyText(contentOf(frame)), after = scalar(record[binding.field]);
    if (before !== after) changes.push({ elementId: frame.id, binding: { ...binding }, before, after });
  }
  return changes;
}
