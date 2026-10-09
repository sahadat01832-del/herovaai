#!/usr/bin/env python3
"""Draw the 1200x630 Open Graph card used for link previews.

    python3 scripts/make-og.py            # writes frontend/public/og.png

Kept as a script rather than a one-off so the card can be regenerated when the
wording changes. No network, no design tool, just Pillow.
"""

import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'frontend', 'public', 'og.png')
LOGO = os.path.join(ROOT, 'frontend', 'public', 'logo.png')
FONT_DIR = '/usr/share/fonts/truetype/dejavu'
BOLD = os.path.join(FONT_DIR, 'DejaVuSans-Bold.ttf')
REG = os.path.join(FONT_DIR, 'DejaVuSans.ttf')

W, H = 1200, 630
INK = (244, 245, 243)
MUTED = (154, 163, 168)
GOLD = (192, 168, 114)
BG_TOP = (10, 13, 15)
BG_BOTTOM = (18, 24, 27)


def font(path, size):
    return ImageFont.truetype(path, size)


def main():
    img = Image.new('RGB', (W, H), BG_TOP)
    draw = ImageDraw.Draw(img)

    # Vertical gradient.
    for y in range(H):
        t = y / (H - 1)
        draw.line(
            [(0, y), (W, y)],
            fill=tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)),
        )

    # Warm glow behind the wordmark.
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([-260, -320, 620, 300], fill=(192, 168, 114, 26))
    img = Image.alpha_composite(img.convert('RGBA'), glow).convert('RGB')
    draw = ImageDraw.Draw(img)

    # Logo + wordmark.
    x, y = 84, 74
    if os.path.exists(LOGO):
        logo = Image.open(LOGO).convert('RGBA')
        target_h = 66
        logo = logo.resize((max(1, round(logo.width * target_h / logo.height)), target_h), Image.LANCZOS)
        img.paste(logo, (x, y), logo)
        x += logo.width + 18
    draw.text((x, y + 6), 'HerovaAi', font=font(BOLD, 46), fill=INK)
    draw.text((x, y + 60), 'AI ASSISTANT FOR SHOPS', font=font(REG, 19), fill=GOLD)

    # Headline.
    hl = font(BOLD, 64)
    draw.text((84, 226), 'Answer every customer', font=hl, fill=INK)
    draw.text((84, 306), 'even while you serve one', font=hl, fill=GOLD)

    # Sub-line.
    draw.text(
        (84, 412),
        'WhatsApp replies in your own words — your prices, your hours, your rules.',
        font=font(REG, 27),
        fill=MUTED,
    )
    draw.text(
        (84, 452),
        'Business memory, private local AI, and a live demo you can try now.',
        font=font(REG, 27),
        fill=MUTED,
    )

    # Footer rule + line.
    draw.line([(84, 528), (W - 84, 528)], fill=(58, 66, 70), width=2)
    draw.text((84, 552), 'Free to try — no sign-up needed', font=font(BOLD, 25), fill=GOLD)
    right = 'Ask it anything'
    w = draw.textlength(right, font=font(REG, 25))
    draw.text((W - 84 - w, 552), right, font=font(REG, 25), fill=MUTED)

    img.save(OUT, 'PNG', optimize=True)
    print(f'wrote {OUT} ({img.width}x{img.height}, {os.path.getsize(OUT) // 1024} KB)')


if __name__ == '__main__':
    main()
