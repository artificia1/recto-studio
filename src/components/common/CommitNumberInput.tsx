import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

interface CommitNumberInputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onInput' | 'onChange' | 'onBlur' | 'onFocus' | 'onKeyDown' | 'min' | 'max'> {
  value: number;
  min?: number;
  max?: number;
  onCommit: (value: number) => void | Promise<void>;
}

export function CommitNumberInput({ value, min, max, onCommit, ...props }: CommitNumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const currentValue = useRef(value);
  currentValue.current = value;
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  return <><input {...props} type="number" value={draft} min={min} max={max}
    disabled={props.disabled || busy} aria-busy={busy || undefined}
    onFocus={() => { focused.current = true; }}
    onInput={event => { setError(''); setDraft(event.currentTarget.value); }}
    onBlur={event => {
      focused.current = false;
      const number = event.currentTarget.valueAsNumber;
      if (!Number.isFinite(number) || number === value) {
        setDraft(String(value));
        return;
      }
      const next = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, number));
      setDraft(String(next));
      if (next === value || busy) return;
      const commit = onCommit(next);
      if (commit) {
        setBusy(true);
        void commit.catch((reason: unknown) => {
          setDraft(String(currentValue.current));
          setError(reason instanceof Error ? reason.message : 'Could not apply the change.');
        }).finally(() => setBusy(false));
      }
    }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') event.currentTarget.value = String(value);
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        event.currentTarget.blur();
      }
    }}/>{error && <small role="alert">{error}</small>}</>;
}
