"""Generate derived image assets. Requires Pillow.

    python mobile/scripts/make_brand_assets.py

- assets/splash-icon-light.png: splash-icon.png recolored to ink for the chalk splash.
- assets/grain.png: tiling monochrome noise for the photo grain overlay.
"""

import random
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / "assets"
INK = (0x11, 0x11, 0x11)


def recolor_splash_icon() -> None:
    src = Image.open(ROOT / "images" / "splash-icon.png").convert("RGBA")
    alpha = src.getchannel("A")
    out = Image.new("RGBA", src.size, INK + (0,))
    out.putalpha(alpha)
    out.save(ROOT / "splash-icon-light.png", optimize=True)


def make_grain(size: int = 128, seed: int = 7) -> None:
    rng = random.Random(seed)
    img = Image.new("LA", (size, size))
    img.putdata([(rng.choice((0, 255)), rng.randint(0, 255)) for _ in range(size * size)])
    img.save(ROOT / "grain.png", optimize=True)


if __name__ == "__main__":
    recolor_splash_icon()
    make_grain()
