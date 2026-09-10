#!/usr/bin/env python3
"""Regenerates the placeholder Pickora backdrop and logo shipped as defaults.

The artwork is committed, so this only needs running when the identity changes.
It draws from the board's own palette and typesets the wordmark in the Bebas
Neue already bundled under fonts/, so the logo matches the screens behind it.

    python3 tools/make-default-artwork.py

Requires Pillow, numpy and fonttools (with brotli) — build-time only, the
application itself still has no dependencies.
"""

from __future__ import annotations

import io
import math
import random
from pathlib import Path

import numpy as np
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "fonts"

# The board's default palette, from appsettings.json `ui`.
INDIGO = (29, 38, 113)
MAGENTA = (195, 55, 100)
GOLD = (255, 235, 59)
AMBER = (255, 167, 38)

BACKDROP_SIZE = (1920, 1080)  # The size the organiser console recommends.
LOGO_SIZE = (600, 300)
ICON_SIZE = 256  # Browser-tab mark.

SUPERSAMPLE = 4  # Draw the logo large and downscale, for clean edges.


def load_font(woff2_name: str, size: int) -> ImageFont.FreeTypeFont:
    """Pillow cannot read woff2, so unwrap the bundled webfont in memory."""
    font = TTFont(FONTS / woff2_name)
    font.flavor = None
    buffer = io.BytesIO()
    font.save(buffer)
    buffer.seek(0)
    return ImageFont.truetype(buffer, size)


# --------------------------------------------------------------------------
# Backdrop
# --------------------------------------------------------------------------

def radial_falloff(width: int, height: int, cx: float, cy: float, radius: float) -> np.ndarray:
    """A 0..1 field that fades smoothly out to `radius` (both in pixels)."""
    ys, xs = np.mgrid[0:height, 0:width]
    distance = np.hypot(xs - cx, ys - cy) / radius
    return np.clip(1.0 - distance, 0.0, 1.0) ** 2


def build_backdrop() -> Image.Image:
    width, height = BACKDROP_SIZE

    # A vertical wash from near-black indigo up into the brand indigo, so the
    # centre of the screen — where the reel and the winner card sit — stays the
    # darkest part of the frame and the type on top keeps its contrast.
    gradient = np.linspace(0.0, 1.0, height)[:, None, None]
    canvas = (
        np.array([16, 20, 56], dtype=float) * (1 - gradient)
        + np.array([34, 42, 110], dtype=float) * gradient
    )
    canvas = np.repeat(canvas, width, axis=1)

    # Three coloured lights: a warm one overhead, like a stage spot, with the
    # brand indigo and magenta washing in from the bottom corners.
    lights = (
        (width * 0.5, height * -0.10, height * 1.20, AMBER, 0.42),
        (width * 0.06, height * 1.05, height * 1.10, INDIGO, 0.85),
        (width * 0.96, height * 0.96, height * 1.00, MAGENTA, 0.70),
    )
    for cx, cy, radius, colour, strength in lights:
        field = radial_falloff(width, height, cx, cy, radius)[:, :, None]
        canvas += np.array(colour, dtype=float) * field * strength

    image = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8))

    # A drift of confetti, blurred back so it reads as atmosphere rather than
    # decoration competing with the draw.
    confetti = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    pen = ImageDraw.Draw(confetti)
    random.seed(20260910)  # Fixed, so re-running reproduces the same artwork.
    for _ in range(300):
        x = random.uniform(0, width)
        y = random.uniform(0, height)
        # Denser towards the top, where the stage light is.
        if random.random() > (1.0 - y / height) ** 1.5 + 0.15:
            continue
        length = random.uniform(10, 26)
        angle = random.uniform(0, math.pi)
        colour = random.choice((GOLD, AMBER, MAGENTA, (255, 255, 255)))
        alpha = int(random.uniform(45, 115))
        dx, dy = math.cos(angle) * length / 2, math.sin(angle) * length / 2
        pen.line(((x - dx, y - dy), (x + dx, y + dy)), fill=colour + (alpha,), width=4)
    image = Image.alpha_composite(image.convert("RGBA"), confetti.filter(ImageFilter.GaussianBlur(1.0)))

    # Vignette, then grain — the grain also dithers the gradient, which stops it
    # banding on a projector.
    vignette = 1.0 - 0.38 * (1.0 - radial_falloff(width, height, width / 2, height / 2, height * 1.5))
    pixels = np.asarray(image.convert("RGB"), dtype=float) * vignette[:, :, None]
    grain = np.random.default_rng(20260910).normal(0.0, 3.2, (height, width, 1))
    return Image.fromarray(np.clip(pixels + grain, 0, 255).astype(np.uint8))


# --------------------------------------------------------------------------
# Logo
# --------------------------------------------------------------------------

def vertical_gradient(size: tuple[int, int], top: tuple, bottom: tuple) -> Image.Image:
    width, height = size
    ramp = np.linspace(0.0, 1.0, height)[:, None, None]
    band = np.array(top, dtype=float) * (1 - ramp) + np.array(bottom, dtype=float) * ramp
    return Image.fromarray(np.repeat(band, width, axis=1).astype(np.uint8))


def sparkle_points(cx: float, cy: float, outer: float, inner: float) -> list[tuple[float, float]]:
    """A four-point star with concave sides — the 'picked' spark."""
    points: list[tuple[float, float]] = []
    for index in range(8):
        angle = math.pi / 2 * (index / 2) - math.pi / 2
        radius = outer if index % 2 == 0 else inner
        points.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
    return points


def draw_badge(canvas: Image.Image, x: int, y: int, size: int) -> None:
    """The mark: a gold-to-amber rounded square holding a white spark.

    Two sparks, a large one and a small one — many entries, one of them picked.
    """
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=round(size * 0.288), fill=255
    )
    badge = vertical_gradient((size, size), GOLD, AMBER).convert("RGBA")
    badge.putalpha(mask)
    canvas.paste(badge, (x, y), badge)

    spark = ImageDraw.Draw(canvas)
    spark.polygon(
        sparkle_points(x + size / 2, y + size / 2, size * 0.348, size * 0.098),
        fill=(255, 255, 255, 255),
    )
    spark.polygon(
        sparkle_points(x + size * 0.795, y + size * 0.235, size * 0.129, size * 0.038),
        fill=(255, 255, 255, 220),
    )


def build_logo() -> Image.Image:
    width, height = (LOGO_SIZE[0] * SUPERSAMPLE, LOGO_SIZE[1] * SUPERSAMPLE)
    scale = SUPERSAMPLE
    logo = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    badge_size = 132 * scale
    badge_x, badge_y = 32 * scale, (LOGO_SIZE[1] // 2 - 66) * scale
    draw_badge(logo, badge_x, badge_y, badge_size)

    text = ImageDraw.Draw(logo)
    wordmark = load_font("bebas-neue-400-latin.woff2", 86 * scale)
    subline = load_font("lato-400-latin.woff2", 21 * scale)

    # Bebas has no letter-spacing of its own; draw glyph by glyph to open it up.
    def tracked(pen, xy, label, font, fill, tracking):
        x, y = xy
        for character in label:
            pen.text((x, y), character, font=font, fill=fill)
            x += pen.textlength(character, font=font) + tracking
        return x - tracking

    text_x = badge_x + badge_size + 30 * scale
    tracked(text, (text_x, (LOGO_SIZE[1] // 2 - 62) * scale), "PICKORA", wordmark,
            (255, 255, 255, 255), 3 * scale)
    tracked(text, (text_x + 3 * scale, (LOGO_SIZE[1] // 2 + 24) * scale), "BY SHENU", subline,
            (255, 235, 59, 235), 6 * scale)

    logo = logo.resize(LOGO_SIZE, Image.LANCZOS)

    # Trim the transparent margin and re-centre with an even one. The board
    # scales the file to a set height, so uneven padding would shrink the mark
    # and push it off-centre inside its slot.
    bounds = logo.getbbox()
    if bounds:
        drawn = logo.crop(bounds)
        margin = 18
        box = (LOGO_SIZE[0] - margin * 2, LOGO_SIZE[1] - margin * 2)
        ratio = min(box[0] / drawn.width, box[1] / drawn.height)
        drawn = drawn.resize((round(drawn.width * ratio), round(drawn.height * ratio)), Image.LANCZOS)
        logo = Image.new("RGBA", LOGO_SIZE, (0, 0, 0, 0))
        logo.paste(drawn, ((LOGO_SIZE[0] - drawn.width) // 2, (LOGO_SIZE[1] - drawn.height) // 2))

    return logo


def build_icon() -> Image.Image:
    """The mark on its own, for the browser tab."""
    edge = ICON_SIZE * SUPERSAMPLE
    icon = Image.new("RGBA", (edge, edge), (0, 0, 0, 0))
    draw_badge(icon, 0, 0, edge)
    return icon.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)


def main() -> None:
    backdrop = build_backdrop()
    # JPEG: the backdrop is a full-bleed photographic wash, and a lossless copy
    # of it is several megabytes for no visible gain on a projector.
    backdrop.save(ROOT / "pickora-background.jpg", quality=88, optimize=True, progressive=True)
    build_logo().save(ROOT / "pickora-logo.png", optimize=True)
    build_icon().save(ROOT / "pickora-icon.png", optimize=True)
    for name in ("pickora-background.jpg", "pickora-logo.png", "pickora-icon.png"):
        target = ROOT / name
        with Image.open(target) as image:
            print(f"{name}: {image.size[0]}x{image.size[1]} {image.mode} "
                  f"{target.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
