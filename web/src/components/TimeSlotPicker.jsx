import React, { useState } from 'react';
import { Label } from './ui.jsx';

// 12 fixed 2-hour windows spanning the full day — replaces the native
// datetime-local picker's own OS-level time popup (browser-, OS- and even
// locale-dependent, and on some mobile browsers genuinely does render as a
// blocking "please fill this field" prompt rather than an inline control)
// with a plain, predictable slot list. A shipper picks a window a driver
// can realistically hit, not a to-the-minute timestamp nobody actually
// needs — the job's real deadline is still computed elsewhere from
// whichever slot's start time gets chosen.
const SLOTS = Array.from({ length: 12 }, (_, i) => {
  const startH = i * 2;
  const endH = startH + 2;
  const pad = (h) => String(h % 24).padStart(2, '0');
  return { startHour: startH, label: `${pad(startH)}:00 – ${pad(endH === 24 ? 0 : endH)}:00${endH === 24 ? ' (midnight)' : ''}` };
});

function todayLocalDateString() {
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

function parseValue(value) {
  if (!value) return { dateStr: '', hourStr: '' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { dateStr: '', hourStr: '' };
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  const local = new Date(d.getTime() - tzOffsetMs);
  return { dateStr: local.toISOString().slice(0, 10), hourStr: String(local.getHours()) };
}

// value/onChange carry a plain ISO string, same contract the native
// datetime-local input this replaces used — callers elsewhere in the form
// (deadline math, submit payload) don't need to know this is now
// date+slot under the hood.
//
// Date and hour are kept as LOCAL state, not derived from `value` on every
// render — picking a date alone doesn't yet produce a valid ISO instant
// (no hour chosen), so a controlled-from-value implementation would emit
// '' back up and immediately erase the date the user just picked, one
// click before they could choose a slot. Local state avoids that; `value`
// only seeds the initial render (e.g. editing a job that already has one).
export default function TimeSlotPicker({ label, value, onChange, required, minDateToday = true }) {
  const [{ dateStr, hourStr }, setPicked] = useState(() => parseValue(value));

  const today = todayLocalDateString();
  const isToday = dateStr === today;
  const currentHour = new Date().getHours();

  function commit(nextDateStr, nextHour) {
    setPicked({ dateStr: nextDateStr, hourStr: nextHour === '' || nextHour === undefined ? '' : String(nextHour) });
    if (!nextDateStr || nextHour === '' || nextHour === undefined) { onChange(''); return; }
    // Build in local time, not UTC — a slot picked as "08:00" in the
    // shipper's own timezone should mean 08:00 there, matching what the
    // native datetime-local input already did before this replaced it.
    const local = new Date(`${nextDateStr}T${String(nextHour).padStart(2, '0')}:00:00`);
    onChange(local.toISOString());
  }

  return (
    <div>
      <Label>{label}</Label>
      <input
        type="date"
        required={required}
        min={minDateToday ? today : undefined}
        value={dateStr}
        onChange={(e) => commit(e.target.value, hourStr)}
        className="input"
      />
      <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {SLOTS.map((s) => {
          const disabled = !dateStr || (isToday && s.startHour + 2 <= currentHour);
          const active = hourStr !== '' && Number(hourStr) === s.startHour;
          return (
            <button
              key={s.startHour}
              type="button"
              disabled={disabled}
              onClick={() => commit(dateStr, s.startHour)}
              className="rounded-md border px-2 py-2 text-center text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                borderColor: active ? 'var(--brand-accent)' : 'var(--border-default)',
                background: active ? 'var(--brand-accent-bg)' : 'var(--bg-surface)',
                color: active ? 'var(--brand-accent)' : 'var(--ink)',
              }}
            >
              {s.label.replace(':00', '').replace(' (midnight)', '')}
            </button>
          );
        })}
      </div>
      {!dateStr && <p className="mt-1 text-xs text-ink-muted">Pick a date first, then a 2-hour window.</p>}
    </div>
  );
}
