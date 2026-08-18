import { useEffect, useRef } from 'react';

// Elements the trap cycles between: links, buttons, form controls, and any
// explicit positive tabindex (tabindex="-1" elements stay out of the cycle,
// since they're only meant to be focused programmatically).
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

// Traps keyboard focus inside `ref` while `active` is true and calls
// `onEscape` on Escape. On activation the first focusable child (falling
// back to the container itself) receives focus; on deactivation or unmount
// focus returns to whatever had it before the trap opened.
export function useFocusTrap(ref, active, onEscape) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active || !ref.current) return undefined;

    const container = ref.current;
    const previouslyFocused = document.activeElement;

    function getFocusables() {
      return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisible);
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = getFocusables();
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const inside = container.contains(document.activeElement);

      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    }

    (getFocusables()[0] || container).focus();
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previouslyFocused && previouslyFocused !== document.body && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [ref, active]);
}