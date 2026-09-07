# Change 1 — Dashboard UI Modernization: Mockup for Sign-off

> Gate-respecting artifact. No dashboard visual redesign code ships until this
> mockup is approved. The iOS Safari technical fixes (viewport-fit, 100dvh,
> safe-area, tap-highlight) already shipped in Phase 6 and are NOT part of
> this sign-off — only the visual redesign below waits on approval.

## 1. Design source (licensed-free, no new deps)

- Base kit: Tailwind UI (free tier patterns) + shadcn-style tokens already in
  `web/src/index.css` (primitive → semantic → component, 3-layer system).
- No Figma-kit binary checked in; references are class-level mappings so any
  designer can reproduce in Figma using the same tokens.
- Icons: existing hand-authored `web/src/components/icons.jsx` (no new set).

## 2. What changes (mockup scope)

| Area | Current | Mockup (proposed) |
|---|---|---|
| Dashboard header | Page-title + stat tiles, LTR-hardcoded (now `isRtl`-aware post-Phase 6) | Same IA, larger display type (`font-display`), tier pill inline, sticky filter bar |
| Stat tiles | 4 neutral cards | 4 cards with semantic status colors (`--status-*`), 48px tap targets, `me-` logical spacing for RTL |
| Job list rows | Dense table-ish rows | Card rows: job code + status badge left, price/ETA right (mirrors in RTL), single primary action per row |
| Post-job CTA | Inline form toggle | Persistent primary button + progressive-disclosure form (Terms checkbox only when backend 400s, per Phase 2 pattern) |
| Dark mode | Nav toggle exists | No new colors — reuse `data-theme` tokens; contrast verified against Phase 6 dark-mode fix list |
| iOS | `100dvh` + safe-area shipped | Mockup adds nothing that breaks those: no fixed-vh heroes, no hover-only reveals, bottom CTA respects `env(safe-area-inset-bottom)` |

## 3. What explicitly does NOT change

- No IA/route changes (`/dashboard`, `/jobs/:id`, `/driver-home` stay).
- No new translation system — reuse `web/src/lib/i18n.jsx` `t()` (Phase 6/6b pattern).
- No native app, no new chart lib. Analytics stays server-computed + CSS bars.
- `TERMINALS`/`DEPOTS` constants stay (Phase 6 kept them for JobEdit/Templates/Contracts).

## 4. iOS verification still owed (not claimed)

Desktop build cannot verify safe-area/dvh. Before calling Change 1 done:
- [ ] Real iPhone Safari pass (or Simulator): post-job form, dashboard scroll, ChatPopup button vs LiveMap controls.
- [ ] RTL pass on Dashboard + JobDetail + DriverHome (Arabic strings from Phase 6/6b).

## 5. Sign-off checklist (Aarif)

- [ ] Approved: card-row direction (price-right vs price-below on small screens).
- [ ] Approved: stat-tile set (Active / Completed / Spend / Savings — keep or swap Savings for Reliability?).
- [ ] Approved: primary-action-per-row rule (Discuss & award vs View).
- [ ] Approved: dark-mode tile contrast on real device.
- [ ] Decision: keep free UI-kit mapping (no licensed kit purchase).

On approval, implementation is a frontend-only pass over
`Dashboard.jsx`, `JobDetail.jsx`, `DriverHome.jsx`, `index.css` tokens —
no schema/backend changes (same scoping as Phase 6).
