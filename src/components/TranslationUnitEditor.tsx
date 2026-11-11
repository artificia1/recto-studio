import { useState } from 'preact/hooks';
import type { TranslationPart, TranslationUnit } from '../translation/catalog';

export function TranslationUnitEditor({ unit, target, language, disabled, onSave, onCancel }: {
  unit: TranslationUnit;
  target: TranslationPart[];
  language: string;
  disabled: boolean;
  onSave: (parts: TranslationPart[]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(target));
  const [error, setError] = useState('');
  const changed = draft.some((part, index) => part.kind !== 'marker' &&
    target[index].kind !== 'marker' && part.text !== target[index].text);
  return <div className="translation-inline-edit" role="group" aria-label="Edit returned translation">
    {draft.map((part, index) => part.kind === 'marker'
      ? <p key={index} className="translation-inline-marker">
        {unit.codes.get(part.id)?.text || 'Protected marker'}
        <small> · Protected marker</small>
      </p>
      : <label key={index}>{part.kind === 'format' ? 'Formatted passage' : 'Plain passage'} {index + 1}
        <textarea lang={language} dir="auto" value={part.text} maxLength={24000} disabled={disabled}
          onInput={event => {
            const value = event.currentTarget.value;
            setDraft(draft.map((previous, position) => position === index && previous.kind !== 'marker'
              ? { ...previous, text: value } : previous));
            setError('');
          }}/>
      </label>)}
    {error && <p role="alert">{error}</p>}
    <div className="publication-actions">
      <button className="sm-btn" disabled={disabled || !changed} onClick={() => {
        try { onSave(draft); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      }}>Save unit edit</button>
      <button className="sm-btn" disabled={disabled} onClick={onCancel}>Cancel unit edit</button>
    </div>
  </div>;
}
