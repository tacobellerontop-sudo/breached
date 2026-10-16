"""Draws the Breached icon and writes branding/breached.ico and PNGs.

    python3 scripts/build/make-icon.py

A black tile with a bold white "B" split by a diagonal break, with the green
accent in the gap. Needs Pillow."""

import os
from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
GREEN = (0, 200, 60, 255)
S = 1024  # drawn big, scaled down


def tile(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius, fill=255)
    return mask


def draw(small=False):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bg = Image.new("RGBA", (S, S), (12, 12, 12, 255))
    img.paste(bg, (0, 0), tile(S, 200))
    # Thin lighter rim so it shows on dark taskbars.
    rim = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(rim)
    d.rounded_rectangle((0, 0, S - 1, S - 1), 200, outline=255, width=14)
    img.paste((60, 60, 60, 255), (0, 0), rim)

    # The letter, centred.
    font = ImageFont.truetype(FONT, 800)
    letter = Image.new("L", (S, S), 0)
    ld = ImageDraw.Draw(letter)
    box = ld.textbbox((0, 0), "B", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    ld.text(((S - w) / 2 - box[0], (S - h) / 2 - box[1]), "B", font=font, fill=255)

    if small:
        img.paste((255, 255, 255, 255), (0, 0), letter)
        return img

    # The break: a diagonal band through the letter. The top-right part is
    # nudged up and right, and the gap shows green.
    gap = 70
    upper = Image.new("L", (S, S), 0)
    # Line from (x0, y0) to (x1, y1), going up to the right.
    x0, y0, x1, y1 = 0, S * 0.66, S, S * 0.38
    ImageDraw.Draw(upper).polygon([(x0, y0 - gap / 2), (x1, y1 - gap / 2), (x1, 0), (x0, 0)], fill=255)
    lower = Image.new("L", (S, S), 0)
    ImageDraw.Draw(lower).polygon([(x0, y0 + gap / 2), (x1, y1 + gap / 2), (x1, S), (x0, S)], fill=255)
    band = Image.new("L", (S, S), 0)
    ImageDraw.Draw(band).polygon(
        [(x0, y0 - gap / 2), (x1, y1 - gap / 2), (x1, y1 + gap / 2), (x0, y0 + gap / 2)], fill=255
    )

    top = ImageChops.multiply(letter, upper)
    bottom = ImageChops.multiply(letter, lower)
    crack = ImageChops.multiply(letter, band)
    img.paste(GREEN, (0, 0), crack)
    img.paste((255, 255, 255, 255), (0, 0), bottom)
    shifted = Image.new("L", (S, S), 0)
    shifted.paste(top, (18, -22))
    img.paste((255, 255, 255, 255), (0, 0), shifted)
    return img


def main():
    out = os.path.join(ROOT, "branding")
    os.makedirs(out, exist_ok=True)
    big, small = draw(), draw(small=True)
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    frames = [(small if s <= 24 else big).resize((s, s), Image.LANCZOS) for s in sizes]
    big.resize((512, 512), Image.LANCZOS).save(os.path.join(out, "breached-512.png"))
    big.resize((256, 256), Image.LANCZOS).save(os.path.join(out, "breached-256.png"))
    ico = os.path.join(out, "breached.ico")
    frames[-1].save(ico, sizes=[(s, s) for s in sizes], append_images=frames[:-1])
    # The window icon Gecko loads for <html id="breached-window">.
    win = os.path.join(ROOT, "shell", "chrome", "icons", "default")
    os.makedirs(win, exist_ok=True)
    frames[-1].save(os.path.join(win, "breached-window.ico"), sizes=[(s, s) for s in sizes], append_images=frames[:-1])
    print("wrote", ico)


if __name__ == "__main__":
    main()
