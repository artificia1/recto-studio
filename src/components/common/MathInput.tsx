import { useState, useEffect } from 'preact/hooks';
import { evaluateMathExpression } from '../../utils/mathEval';

interface MathInputProps {
  value: number;
  onChange: (val: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  style?: any;
  placeholder?: string;
  title?: string;
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
}: MathInputProps) {
  const [text, setText] = useState<string>(String(value ?? 0));
  const [isFocused, setIsFocused] = useState<boolean>(false);

  useEffect(() => {
    if (!isFocused) {
      setText(String(value ?? 0));
    }
  }, [value, isFocused]);

  const commitValue = () => {
    const evaluated = evaluateMathExpression(text, value);
    if (evaluated !== null) {
      let finalVal = evaluated;
      if (typeof min === 'number') finalVal = Math.max(min, finalVal);
      if (typeof max === 'number') finalVal = Math.min(max, finalVal);
      onChange(finalVal);
      setText(String(finalVal));
    } else {
      setText(String(value ?? 0));
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      commitValue();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setText(String(value ?? 0));
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const current = evaluateMathExpression(text, value) ?? value ?? 0;
      const delta = e.shiftKey ? 10 : (e.altKey ? 0.1 : (step || 1));
      let next = Math.round((current + delta) * 100) / 100;
      if (typeof max === 'number') next = Math.min(max, next);
      onChange(next);
      setText(String(next));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const current = evaluateMathExpression(text, value) ?? value ?? 0;
      const delta = e.shiftKey ? 10 : (e.altKey ? 0.1 : (step || 1));
      let next = Math.round((current - delta) * 100) / 100;
      if (typeof min === 'number') next = Math.max(min, next);
      onChange(next);
      setText(String(next));
    }
  };

  return (
    <input
      type="text"
      value={text}
      disabled={disabled}
      className={className}
      style={style}
      placeholder={placeholder}
      title={title || 'Enter a number or math expression (e.g. 180/2, +10mm, 210-25)'}
      onFocus={() => setIsFocused(true)}
      onBlur={() => {
        setIsFocused(false);
        commitValue();
      }}
      onInput={(e) => setText((e.target as HTMLInputElement).value)}
      onKeyDown={handleKeyDown}
    />
  );
}
