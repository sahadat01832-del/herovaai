#!/usr/bin/env python3
"""Regenerate the HerovaAi brand images (favicon, touch icon, social card).

Run from the repository root:

    python3 tools/make-assets.py

Writes into assets/ in this repo and into <site-root-repo>/ for the host root
page, so both parts of the site carry the same icon and social card.
"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT_REPO = pathlib.Path("/home/sahadat/herovaai-site-root")
HERE = pathlib.Path(__file__).resolve().parent.parent

BG = (10, 13, 15)
GOLD = (216, 192, 138)
GOLD_DEEP = (179, 154, 99)
INK = (23, 20, 12)
TEXT = (244, 245, 243)
DIM = (154, 163, 160)

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size)
    raise SystemExit("no usable TTF font found; install fonts-dejavu-core")


def gold_panel(size: int, radius_ratio: float = 0.22) -> Image.Image:
    """Gold gradient tile with the 'H' mark, as used in the site header."""
    scale = 4  # supersample for smooth edges
    s = size * scale
    tile = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    grad = Image.new("RGB", (s, s))
    d = ImageDraw.Draw(grad)
    for y in range(s):
        t = y / max(s - 1, 1)
        d.line([(0, y), (s, y)], fill=(
            round(GOLD[0] * (1 - t) + GOLD_DEEP[0] * t),
            round(GOLD[1] * (1 - t) + GOLD_DEEP[1] * t),
            round(GOLD[2] * (1 - t) + GOLD_DEEP[2] * t),
        ))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, s - 1, s - 1], radius=int(s * radius_ratio), fill=255
    )
    tile.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(tile)
    f = font(int(s * 0.58))
    box = d.textbbox((0, 0), "H", font=f)
    d.text(((s - (box[2] - box[0])) / 2 - box[0], (s - (box[3] - box[1])) / 2 - box[1] - s * 0.03),
           "H", font=f, fill=INK)
    return tile.resize((size, size), Image.LANCZOS)


def social_card(width: int = 1200, height: int = 630) -> Image.Image:
    card = Image.new("RGB", (width, height), BG)
    glow = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(glow)
    for i in range(60):
        r = int((width * 0.75) * (1 - i / 60))
        d.ellipse([width * 0.82 - r, height * -0.15 - r, width * 0.82 + r, height * -0.15 + r],
                  fill=(BG[0] + i // 3, BG[1] + i // 3, BG[2] + i // 5))
    card = Image.blend(card, glow, 0.55)

    d = ImageDraw.Draw(card)
    mark = gold_panel(128)
    card.paste(mark, (84, 92), mark)
    d.text((232, 118), "Herova", font=font(64), fill=TEXT)
    d.text((232 + d.textlength("Herova", font=font(64)), 118), "Ai", font=font(64), fill=GOLD)

    d.text((84, 268), "Your shop's assistant,", font=font(58), fill=TEXT)
    d.text((84, 340), "answering customers on WhatsApp.", font=font(58), fill=GOLD)
    d.text((84, 452), "Prices, hours and policies in your own words — customers install nothing.",
           font=font(30), fill=DIM)
    d.text((84, 528), "sahadat01832-del.github.io/herovaai", font=font(28), fill=(140, 148, 145))
    return card


def favicon_svg() -> str:
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="HerovaAi">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#d8c08a"/>
      <stop offset="1" stop-color="#b39a63"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#g)"/>
  <path fill="#17140c" d="M21 16h6v13h10V16h6v32h-6V35H27v13h-6z"/>
</svg>
"""


def main() -> int:
    targets = [HERE / "assets", ROOT_REPO]
    card = social_card()
    icons = {size: gold_panel(size, 0.14) for size in (180, 512)}

    for target in targets:
        if not target.exists():
            print(f"skip (missing): {target}")
            continue
        target.mkdir(parents=True, exist_ok=True)
        card.save(target / "og-image.png", optimize=True)
        icons[180].save(target / "apple-touch-icon.png", optimize=True)
        icons[512].save(target / "icon-512.png", optimize=True)
        (target / "favicon.svg").write_text(favicon_svg())
        icons[180].save(target / "favicon.ico",
                        sizes=[(16, 16), (32, 32), (48, 48)])
        print("wrote brand assets into", target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
