# Ecosystem brand notes

Companion to `BRAND_GUIDELINES.md` for the six-domain family (master plan §10). Source of the shared kit: `Loadbyton-OS` `public/brand` at commit `bd8510a`; the OS repository itself records the kit as **pending owner approval**.

## What was added

| Asset | Location | Used by |
|---|---|---|
| Outlined SVG masters (parent wordmark: navy, white, black, mono; BY mark) | `web/public/brand/v2/masters`, `v2/by-mark.svg` | `BrandWordmark` when `VITE_BRAND_V2=true` |
| Product and sector line icons, `.store` lockups | `web/public/brand/v2/{products,icons,store}` | available to pages; not yet used |
| Self-hosted fonts (Geist, Inter, JetBrains Mono, Noto Sans Arabic; SIL OFL, licences beside them) | `web/public/brand/fonts`, `web/src/styles/fonts.css` | whole site |
| Branch accent tokens | `web/src/styles/ecosystem.css` | network menu, footer, interstitial |

The PNG wordmarks the site uses today are unchanged. The SVG masters draw the letters as paths, so every device renders identical letterforms (the reason the PNGs were chosen over the older live-text SVGs).

## Palette reconciliation

| Token | Master plan | .com today | Store kit | Decision here |
|---|---|---|---|---|
| Navy | `#0F2B3D` | `#0F2B3D` | `#0F2B3D` | same |
| Red | `#E53935` / buttons `#C62828` | `#E53935` | `#E53935` / `#C62828` | same; filled red buttons with text use `--lb-red-accessible` |
| Paper | `#F8FAFC` | `#F8FAFC` | `#F5F6F4` (+ cream `#FFFDF7`) | **master plan wins** (`#F8FAFC`); the Store kit differs and should converge |
| Amber (text on light) | – | `#F57C00` (2.7:1) | `#8A5A00` (5.9:1) | text uses `--lb-amber-text` `#8A5A00`; `#F57C00` stays a fill colour only |
| Display face | – | Geist | `brand.config.json` says Geist; the Store's `FRONTEND_SYSTEM.md` says Inter | Geist (Store doc should be corrected) |

## Branch accents (secondary navigation cues only)

Measured WCAG 2.x contrast of each accent: on white / on `#F8FAFC` / white text on the accent.

| Branch | Accent | White | Paper | White-on-accent |
|---|---|---|---|---|
| Freight | `#2563EB` | 5.17 | 4.94 | 5.17 |
| Store | `#087F8C` | 4.75 | 4.54 | 4.75 |
| Shop | `#B45309` | 5.02 | 4.80 | 5.02 |
| Network | `#1D4ED8` | 6.70 | 6.41 | 6.70 |
| People | `#15803D` | 5.02 | 4.79 | 5.02 |
| Developers | `#6D28D9` | 7.10 | 6.79 | 7.10 |

All clear 4.5:1 for text, Store narrowly on paper. Dark theme uses lighter tints. Rules: never recolour the wordmark bars by division; never use an accent as the only carrier of status; `#E53935` with white text is 4.23:1, so use `#C62828` (5.62:1) for filled buttons that carry text. The new pages pass axe with no contrast exemption (`web/e2e/ecosystem.spec.js`).

## Open

* **Logo variant.** The Store kit's BY is red; the .com guidelines describe white/navy BY in some applications. Pick one before `VITE_BRAND_V2` goes on.
* **Trademark** clearance and registrant proof for the other four domains are not assessed.
* **Photography.** None is supplied for the new pages; they use the existing campaign images.
