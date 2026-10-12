#!/usr/bin/env python3
"""Regenerate every web logo/icon asset from the master files in docs/brand/logo/.

    python3 scripts/generate-brand-assets.py

Masters (supplied brand pack):
  logo-transparent-8600px.png  white wordmark, transparent background  -> for DARK surfaces
  logo-on-navy-8600px.png      same wordmark on the brand navy fill
  icon-2048px.png              container app icon (downscaled from the 8192px master)

The pack has no dark-on-light wordmark, so logo-wordmark-light-bg.png is derived
from the transparent master by recolouring its white letters to the brand navy
(#0F2B3D, the fill used in the on-navy master). The artwork only ever contains
pure white and the brand red (#E53935) with anti-aliased alpha, so the recolour
is lossless; the red divider bars are untouched.

Why PNG and not the SVGs from the pack: those SVGs draw the wordmark with live
<text> in `sans-serif`, and an SVG used through <img> cannot load web fonts, so
every OS would render different letterforms. The PNGs are the exact approved art.

Requires: Pillow, numpy.
"""
from pathlib import Path
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "brand" / "logo"
PUB = ROOT / "web" / "public"
BRAND = PUB / "brand"
NAVY = (15, 43, 61)  # #0F2B3D
BRAND.mkdir(parents=True, exist_ok=True)


def save_png(im, path, **kw):
    im.save(path, optimize=True, **kw)
    print(f"  {path.relative_to(ROOT)}  {im.size[0]}x{im.size[1]}  {path.stat().st_size // 1024} KB")


def tight_crop(im, pad_ratio):
    """Crop to the visible artwork plus a small even margin (the masters carry ~50% empty padding)."""
    alpha = np.array(im)[..., 3]
    ys, xs = np.where(alpha > 8)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    pad = int((x1 - x0) * pad_ratio)
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))


def to_width(im, w):
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


# ---------------------------------------------------------------- wordmark
print("wordmark")
white = tight_crop(Image.open(SRC / "logo-transparent-8600px.png").convert("RGBA"), 0.012)
white_w = to_width(white, 1200)
save_png(white_w, BRAND / "logo-wordmark-dark-bg.png")

# dark-on-light: recolour the white letters, keep the red bars as-is
arr = np.array(white_w).copy()
is_white = arr[..., 1] > 150  # red has G=57; white has G=255 (anti-aliased edges keep their hue)
arr[is_white, 0:3] = NAVY
light = Image.fromarray(arr, "RGBA")
save_png(light, BRAND / "logo-wordmark-light-bg.png")

# Generated documents (invoices, settlement, POD...) embed this one as a data URI — see
# server/lib/documents/shell.js. Kept inside server/ because the server Docker images only copy that tree.
DOC_ASSETS = ROOT / "server" / "lib" / "documents" / "assets"
DOC_ASSETS.mkdir(parents=True, exist_ok=True)
save_png(to_width(light, 640), DOC_ASSETS / "logo-wordmark-light-bg.png")

# solid navy tile (social cards, e-mail headers where a transparent PNG is unreliable)
tile = Image.new("RGBA", (white_w.width + 160, white_w.height + 160), NAVY + (255,))
tile.alpha_composite(white_w, (80, 80))
save_png(tile.convert("RGB"), BRAND / "logo-wordmark-on-navy.png")

# ---------------------------------------------------------------- icon
print("icon")
icon = Image.open(SRC / "icon-2048px.png").convert("RGB")
# The container sits inside a lot of dark padding; for small favicons crop in on it.
CX, CY, SIDE = 1021, 1001, 1400
tight = icon.crop((CX - SIDE // 2, CY - SIDE // 2, CX + SIDE // 2, CY + SIDE // 2))
save_png(icon.resize((512, 512), Image.LANCZOS), BRAND / "logo-icon.png")
# PWA / Android: full-bleed with the artwork inside the maskable safe zone
save_png(icon.resize((512, 512), Image.LANCZOS), PUB / "icon-512.png")
save_png(icon.resize((192, 192), Image.LANCZOS), PUB / "icon-192.png")
# iOS applies its own rounded mask to a full-bleed square
save_png(tight.resize((180, 180), Image.LANCZOS), PUB / "apple-touch-icon.png")
for s in (16, 32, 48):
    t = tight.resize((s, s), Image.LANCZOS)
    if s in (16, 32):
        save_png(t, PUB / f"favicon-{s}x{s}.png")
tight.resize((256, 256), Image.LANCZOS).save(
    PUB / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)]
)
print(f"  web/public/favicon.ico  {(PUB / 'favicon.ico').stat().st_size // 1024} KB")

# ---------------------------------------------------------------- Open Graph / social card (1200x630)
print("social card")
og = Image.new("RGB", (1200, 630), NAVY)
mark = white_w.copy()
mark = to_width(mark, 860)
og_rgba = og.convert("RGBA")
og_rgba.alpha_composite(mark, ((1200 - mark.width) // 2, 200))
# the container icon, small, above the wordmark
from PIL import ImageDraw as _D
ico = tight.resize((120, 120), Image.LANCZOS).convert("RGBA")
_mask = Image.new("L", (120, 120), 0)
_D.Draw(_mask).rounded_rectangle((0, 0, 119, 119), radius=28, fill=255)
ico.putalpha(_mask)
og_rgba.alpha_composite(ico, ((1200 - 120) // 2, 52))
try:
    from PIL import ImageDraw, ImageFont
    d = ImageDraw.Draw(og_rgba)
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)
    text = "UAE ROAD FREIGHT & CONTAINER DRAYAGE MARKETPLACE"
    tw = d.textlength(text, font=font)
    d.text(((1200 - tw) / 2, 470), text, font=font, fill=(255, 255, 255, 235))
except OSError:
    pass  # tagline is optional; the logo alone is a valid card
save_png(og_rgba.convert("RGB"), PUB / "og-image.png")
print("done")
