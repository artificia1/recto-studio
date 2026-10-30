import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';

/** Keep keyboard focus in an open editor and restore it to the invoking control. */
export function useModalFocus(open: boolean, ref: RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open || !ref.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'));
    focusables()[0]?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusables();
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    root.addEventListener('keydown', handle);
    return () => { root.removeEventListener('keydown', handle); if (previous?.isConnected) previous.focus(); };
  }, [open]);
}
