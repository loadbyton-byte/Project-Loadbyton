import { useEffect, useRef, useState } from 'react';
import { Input } from './ui.jsx';
import { IconChevronDown } from './icons.jsx';

// A typeahead over a FIXED list — for terminals/depots, which are actual
// gated physical facilities (not arbitrary addresses), so this stays
// constrained to `options` rather than becoming free text or a real
// Google Places search. Gives the "type to search" feel the job form's
// long TERMINALS/DEPOTS lists were missing without loosening what a valid
// answer is.
export default function SearchableSelect({ options, value, onChange, labelFn = (v) => v, placeholder }) {
  const [query, setQuery] = useState(labelFn(value) || '');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => { setQuery(labelFn(value) || ''); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery(labelFn(value) || '');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const matches = options.filter((o) => labelFn(o).toLowerCase().includes(query.toLowerCase()));

  function select(opt) {
    onChange(opt);
    setQuery(labelFn(opt));
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          className="pr-8"
        />
        <IconChevronDown size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
      </div>
      {open && matches.length > 0 && (
        <div
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border py-1 shadow-lg"
          style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}
        >
          {matches.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(opt)}
              className="block w-full px-3 py-2 text-left text-sm transition hover:bg-surface-container"
              style={opt === value ? { color: 'var(--brand-accent)', fontWeight: 600 } : undefined}
            >
              {labelFn(opt)}
            </button>
          ))}
        </div>
      )}
      {open && matches.length === 0 && (
        <div
          className="absolute z-20 mt-1 w-full rounded-lg border px-3 py-2 text-sm text-ink-muted shadow-lg"
          style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}
        >
          No match
        </div>
      )}
    </div>
  );
}
