import type { JSX } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { evaluateMathExpression } from '../../utils/mathEval';

interface MathInputProps {
  value: number;
  onChange: (val: number) => void | Promise<void>;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  style?: JSX.CSSProperties;
  placeholder?: string;
  title?: string;
  deferSteps?: boolean;
  'aria-label'?: string;
}

export function MathInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  disabled,
  className,
  style,
  placeholder,
  title,
  deferSteps = false,
  'aria-label': ariaLabel,
}: MathInputProps) {
  const [text, setText] = useState<string>(String(value ?? 0));
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const steppedValue = useRef<number | null>(null);

  useEffect(() => {
    if (!isFocused && !busy) {
      setText(String(value ?? 0));
    }
  }, [value, isFocused, busy]);

  const commitValue = (draft: string) => {
    const evaluated = steppedValue.current ?? (draft === String(value) ? value : evaluateMathExpression(draft, value));
    steppedValue.current = null;
    if (evaluated === value) {
      setText(String(value));
      return;
    }
    if (evaluated !== null) {
      let finalVal = evaluated;
      if (typeof min === 'number') finalVal = Math.max(min, finalVal);
      if (typeof max === 'number') finalVal = Math.min(max, finalVal);
      const commit = finalVal !== value && onChange(finalVal);
      if (commit) {
        setBusy(true);
        void commit.catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : 'Could not apply the change.');
        }).finally(() => setBusy(false));
      }
      setText(String(finalVal));
    } else {
      setText(String(value ?? 0));
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    const input = e.target as HTMLInputElement;
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      steppedValue.current = null;
      input.value = String(value ?? 0);
      input.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const current = steppedValue.current ?? (input.value === String(value) ? value : evaluateMathExpression(input.value, value)) ?? value ?? 0;
      const stepSize = e.shiftKey ? 10 : e.altKey ? 0.1 : step || 1;
      const direction = e.key === 'ArrowUp' ? 1 : -1;
      const stepped = Math.round((current + direction * stepSize) * 100) / 100;
      const next = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, stepped));
      steppedValue.current = next;
      if (!deferSteps && next !== value) onChange(next);
      setText(String(next));
    }
  };

  return (
    <><input
      type="text"
      value={text}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={className}
      style={style}
      placeholder={placeholder}
      aria-label={ariaLabel}
      title={title || 'Enter a number or math expression (e.g. 180/2, +10mm, 210-25)'}
      onFocus={() => setIsFocused(true)}
      onBlur={event => {
        setIsFocused(false);
        commitValue(event.currentTarget.value);
      }}
      onInput={event => {
        setError('');
        steppedValue.current = null;
        setText(event.currentTarget.value);
      }}
      onKeyDown={handleKeyDown}
    />{error && <small role="alert">{error}</small>}</>
  );
}
