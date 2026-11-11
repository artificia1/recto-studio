import { useMemo, useState } from 'preact/hooks';
import { savePublicationFile } from '../desktop';
import { languageTag, type TranslationGroup } from '../translation/catalog';
import {
  combineTranslationMemories, findTranslationMemoryMatches, MAX_MEMORY_BYTES, readTranslationMemory,
  serializeTranslationMemory, type TranslationMemory,
} from '../translation/memory';
import type { ReturnedTranslation } from '../translation/xliff';

export function TranslationMemoryPanel({ memory, groups, sourceLanguage, onChange, onReview, disabled }: {
  memory?: TranslationMemory;
  groups: TranslationGroup[];
  sourceLanguage: string;
  onChange: (memory?: TranslationMemory) => void;
  onReview: (exchange: ReturnedTranslation) => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [choices, setChoices] = useState(new Map<string, string>());
  const [limit, setLimit] = useState(20);
  const sameSource = useMemo(() => {
    try { return memory?.sourceLanguage === languageTag(sourceLanguage); }
    catch { return false; }
  }, [sourceLanguage, memory]);
  const suggestions = useMemo(() =>
    memory && sameSource ? findTranslationMemoryMatches(groups, memory, choices) : undefined, [groups, memory, sameSource, choices]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setStatus('');
    setError('');
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  return <details className="translation-quality">
    <summary>Translation memory</summary>
    <p>Reuse exact matches from a saved memory. Each match goes through the same review as a returned translation.</p>
    <label>Open or merge a translation memory<input type="file" accept=".rectotm,application/json" disabled={disabled || busy}
      onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (!file) return;
        void run(async () => {
          if (file.size > MAX_MEMORY_BYTES) throw new Error('Choose a memory file smaller than 8 MiB.');
          const imported = readTranslationMemory(await file.text());
          onChange(memory ? combineTranslationMemories(memory, imported) : imported);
          setChoices(new Map());
          setLimit(20);
          setStatus(memory ? 'Translation memories merged.' : 'Translation memory loaded.');
        });
      }}/></label>
    {memory && <>
      <p><strong>{memory.sourceLanguage} → {memory.targetLanguage}</strong> · {memory.entries.length.toLocaleString()} saved source entries</p>
      <div className="publication-actions">
        <button className="sm-btn" disabled={disabled || busy} onClick={() => void run(async () => {
          if (await savePublicationFile(`translation-memory-${memory.sourceLanguage}-${memory.targetLanguage}.rectotm`,
            serializeTranslationMemory(memory), 'application/json')) setStatus('Translation memory saved.');
        })}>Save memory file</button>
        <button className="sm-btn" disabled={disabled || busy} onClick={() => {
          onChange(undefined);
          setChoices(new Map());
          setError('');
          setStatus('Translation memory closed.');
        }}>Close memory</button>
      </div>
      {!sameSource && <p>The open publication’s source language differs from the memory.</p>}
      {suggestions && <>
        <p>{suggestions.exchange.units.length} exact matches · {suggestions.conflicts.length} with alternatives · {suggestions.unmatched} unmatched · {suggestions.protectedUnits} with protected inline codes</p>
        {suggestions.conflicts.length > 0 && <ul className="translation-units">
          {suggestions.conflicts.slice(0, limit).map(item => <li key={item.key}>
            <p><strong>{item.group}</strong> · <span lang={memory.sourceLanguage} dir="auto">{item.source}</span></p>
            <label>Choose a translation<select disabled={disabled || busy} value={choices.get(item.key) || ''}
              onChange={event => {
                const next = new Map(choices);
                if (event.currentTarget.value) next.set(item.key, event.currentTarget.value);
                else next.delete(item.key);
                setChoices(next);
              }}>
              <option value="">Leave unresolved</option>
              {item.options.map(option => <option key={option} value={option} lang={memory.targetLanguage}>{option}</option>)}
            </select></label>
          </li>)}
        </ul>}
        {suggestions.conflicts.length > limit && <button className="sm-btn" onClick={() => setLimit(limit + 20)}>Show more alternatives</button>}
        {choices.size > 0 && <button className="sm-btn" disabled={disabled || busy} onClick={() => setChoices(new Map())}>Reset alternative choices</button>}
        <button className="sm-btn" disabled={disabled || busy || !suggestions.exchange.units.length}
          onClick={() => onReview(suggestions.exchange)}>Review memory matches</button>
      </>}
    </>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
