# Loadbyton — Brand Guidelines

Loadbyton is infrastructure, not a marketing gimmick: it holds escrow, enforces a
state machine, and audits every action. The brand has to read as **credible
enough to trust with money and cargo**, while staying approachable enough for a
carrier dispatcher on a phone at a gate. This document is the source of truth for
the mark, the palette, the type system, and how they're used across the product.
Tokens referenced here are defined in `design-tokens.json` / `design-tokens.css`
in this folder — the app consumes those files directly; nothing here should ever
drift from them.

---

## 1. The mark

**Concept — the "LOAD | BY | TON" wordmark.** The mark is a set-in-stone
wordmark, not a pictogram: `LOAD` and `TON` in heavy navy type, with `BY` set
as a stacked two-letter monogram (`B` over `Y`) between them, the whole thing
split by two thin **Loadbyton Red divider bars**. Those bars are the mark's
one fixed signature — the same construction repeats at every size, from the
navy-tile "LB" icon mark down to the browser-tab favicon. Navy and red are
fixed on every surface; the wordmark is not a `currentColor` glyph that
recolors to match its container.

- `web/public/brand/logo-mark.svg` — the icon-only monogram: a rounded navy
  tile with "LB" in red. Used at nav/sidebar scale (~28–30px) and anywhere the
  mark needs to stand alone without the full wordmark.
- `web/public/brand/logo-full.svg` — full lockup (`LOAD | BY | TON`) for light
  surfaces: navy type, red divider bars, transparent background.
- `web/public/brand/logo-full-on-dark.svg` — same lockup on a solid navy fill,
  white type, red divider bars — for the dark navy surface (nav bar, footer,
  hero panels).
- `web/public/favicon.svg` — the icon mark simplified for 16–32px browser-tab
  scale: navy tile, red "LB", nothing else.

**Clear space & minimum size.** Keep clear space around the wordmark or the
icon mark equal to the height of one divider bar on every side. Below ~24px,
use the icon mark or favicon variant rather than shrinking the full wordmark
— at that scale the "BY" monogram stops being legible as two letters.

**Don't:**
- Don't recolor the divider bars to anything but `--brand-accent` (Loadbyton
  Red) — they're the same token the UI's accent buttons and CTAs use, by
  design (see §2 on why this rebrand merges rather than reserves a second red).
- Don't stretch, skew, or rotate the wordmark or the icon tile, and don't
  round the icon tile's corners past its own 16px radius.
- Don't place the dark-surface (white-type) lockup on anything lighter than
  `--lb-ink-700`, or the light-surface (navy-type) lockup on anything darker
  than `--lb-slate-100` — either direction loses contrast fast.
- Don't add a drop shadow, bevel, or outline — the mark is flat by design,
  matching the app's sharper, more geometric shape language (tighter radii,
  flatter shadows — see `--lb-radius-*`/`--lb-shadow-*` in `design-tokens.css`).

---

## 2. Color

Three layers, defined in `design-tokens.json`: **primitive** (raw hex, named by
hue and step), **semantic** (role-based — `bg.surface`, `text.primary`,
`brand.accent`, `status.warning`…), and **component** (button/card/badge/input,
composed from semantic tokens). Product code should reach for **semantic**, not
primitive, tokens — that's what makes the light/dark themes swap cleanly.

| Role | Light | Dark | Used for |
|---|---|---|---|
| `brand.primary` | Loadbyton Navy `#0F2B3D` | Paper `#F8FAFC` | Primary buttons, active nav, brand chrome |
| `brand.secondary` | Blue `#3B82F6` | Blue `#93C5FD` | Text links only — kept distinct from `brand.primary` precisely so a link still reads as a link on a monochrome UI |
| `brand.accent` | Loadbyton Red `#E53935` | Red `#FF5449` | The **one** accent — award/confirm actions, the primary marketing CTA, and (see below) `status.danger` too. Nothing else. |
| `status.success` | Green `#2E7D32` | Green `#43A047` | Delivered, released, verified |
| `status.warning` | Amber `#F57C00` | Amber `#FFA733` | Pending review, demurrage exposure — deliberately a different hue from `brand.accent` (gold vs. red) so the two are never mistaken for each other at a glance |
| `status.danger` | Loadbyton Red `#E53935` | Red `#FF5449` | Disputed, rejected, overdue |

**Why navy + red:** this is a deliberate reversal of the previous system's
argument for near-black-plus-one-accent (a blue-family primary reads as
"another SaaS dashboard," it said). The brand kit this app now ships makes the
opposite bet on purpose: navy is the industry's own visual language for
"handles money and cargo carefully" — the same instinct that put navy on bank
statements and bills of lading long before this app existed — and pairing it
with a single decisive red accent keeps the "one brand color for structure,
one accent held in reserve" discipline the previous system got right, just on
a different hue pair. The result reads as *enterprise freight infrastructure*
rather than a consumer app wearing freight as a skin — the register this
rebrand's sharper, more geometric shape language and Geist's corporate
register are both reaching for too.

**One merge, stated plainly:** `brand.accent` and `status.danger` are the
*same* red (`#E53935` / `#FF5449`) in this system — the brand kit's own CSS
aliases its error color to the accent, and this app keeps that merge rather
than re-splitting it into two reds. That means an orange-red "Award bid"
button and a red "Disputed" badge share a hue; `status.warning`'s amber is
the one color that exists specifically so a *pending/at-risk* state still
reads as visually distinct from both.

**Discipline still applies:** `brand.accent` is not a "series 4" color — it
never gets reused to mean something else on the same screen. A chart accent,
a badge system, and the accent button all draw from the same reserved red, so
red always means the same category of "needs a decision, is time-sensitive,
or went wrong."

---

## 3. Typography

- **Display — Geist** (400/500/600/700/900). Replaced Manrope with this
  rebrand: the Loadbyton Brand Kit specifies Geist as its headline face, and
  it keeps the properties that made both Manrope and Space Grotesk work in
  this display slot before it — geometric enough to read as infrastructure,
  holds up across a wide weight range from stat-number sizes down to page
  titles, tightens cleanly at hero sizes (32px+) — while sitting in a
  cleaner, more neutral enterprise-dashboard register than either
  predecessor. Headlines, page titles, the wordmark, stat numbers. Still
  never used as body text at paragraph sizes — that discipline stays
  regardless of which face is in the display slot.
- **Body — Inter** (400/500/600). Everything you read at length: forms, tables,
  descriptions, nav labels.
- **Mono — JetBrains Mono** (replaced IBM Plex Mono in the Industrial Trust
  redesign pass — same role, a slightly more geometric/technical face).
  Reserved for data that lines up: job codes (`LBT-DXB-2608-4921`), AED
  amounts, IBANs, timestamps, audit-log entries. Gives the ledger-adjacent
  parts of the product a deliberately technical, tabular feel —
  `font-variant-numeric: tabular-nums` wherever figures stack in a column.

Type scale (rem, 16px base): `xs` 0.75 · `sm` 0.875 · `base` 1 · `md` 1.125 ·
`lg` 1.25 · `xl` 1.5 · `2xl` 1.875 · `3xl` 2.375 · `4xl` 3 · `5xl` 3.75.

---

## 4. Voice

Loadbyton talks like an ops dispatcher, not a marketing deck: **direct, specific,
numerate.** A button says what happens ("Award bid", not "Confirm"). A status
says the state, not a feeling ("Escrow held" not "You're all set!"). Error copy
names what's wrong and what to do about it — never "Something went wrong."
Numbers are always numbers — AED amounts, ETAs in minutes, hours to auto-release —
never vague ("soon," "a while").

---

## 5. Applying this to the app

- `web/tailwind.config.js` maps Tailwind's color scale onto the semantic CSS
  variables in `design-tokens.css` — never hardcode a hex in a component.
  `[data-theme="dark"]` / `[data-theme="light"]` on `<html>` drives the theme
  switch; absent an explicit choice, `prefers-color-scheme` decides.
  See `web/src/index.css` for the mirrored, wired-up copy of these tokens.
- Status pills, badges, and the demurrage/escrow indicators pull from
  `status.*` tokens exclusively — never from `brand.accent` directly, even
  though they're visually similar in light mode, so the two can diverge later
  without a rename.
