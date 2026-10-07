"""Generate the Sanmou Ledger app icon source artwork (1024x1024 PNG).

Deterministic and dependency-light (Pillow only). Rendered at 4x and downsampled
with LANCZOS so small sizes stay crisp.

Usage:
    python scripts/generate-app-icon.py src-tauri/icons/app-icon.png
"""

from __future__ import annotations

import math
import sys
from PIL import Image, ImageDraw

RENDER = 4096
FINAL = 1024


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(int(round(lerp(c1[i], c2[i], t))) for i in range(3))


def diagonal_gradient(size: int, c1, c2) -> Image.Image:
    n = 256
    img = Image.new("RGB", (n, n))
    px = img.load()
    for y in range(n):
        for x in range(n):
            px[x, y] = mix(c1, c2, (x + y) / (2 * (n - 1)))
    return img.resize((size, size), Image.Resampling.BICUBIC)


def radial_falloff(size: int, offset: tuple[int, int], strength: int, power: float = 1.7):
    """Soft radial alpha mask, centred on `offset`, falling to 0 at the edge."""
    n = 128
    img = Image.new("L", (n, n), 0)
    px = img.load()
    cx = cy = (n - 1) / 2
    for y in range(n):
        for x in range(n):
            dx = (x - cx) / cx
            dy = (y - cy) / cy
            r = min(1.0, math.hypot(dx, dy))
            px[x, y] = int(strength * max(0.0, 1.0 - r) ** power)
    mask = img.resize((size, size), Image.Resampling.BICUBIC)
    if offset != (0, 0):
        shifted = Image.new("L", (size, size), 0)
        shifted.paste(mask, offset)
        mask = shifted
    return mask


def vertical_gradient(size: int, h: int, c1, c2) -> Image.Image:
    grad = Image.new("RGB", (1, h))
    px = grad.load()
    for y in range(h):
        px[0, y] = mix(c1, c2, y / max(1, h - 1))
    return grad.resize((size, h), Image.Resampling.BILINEAR)


def rounded_mask(size: int, radius: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m


def build() -> Image.Image:
    S = RENDER
    u = S / 1024.0

    NAV_TOP = (0x26, 0x30, 0x45)
    NAV_BOT = (0x0E, 0x12, 0x1B)
    BAR_TOP = (0xEE, 0xF4, 0xFF)
    BAR_BOT = (0x9F, 0xB8, 0xE4)
    AMBER = (0xFF, 0xC4, 0x52)
    AMBER_HI = (0xFF, 0xDC, 0x96)

    canvas = diagonal_gradient(S, NAV_TOP, NAV_BOT).convert("RGBA")

    # soft top-left light, no hard edges
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    glow.paste(
        (0x5B, 0x86, 0xD6, 255),
        (0, 0),
        radial_falloff(S, (-int(0.42 * S), -int(0.30 * S)), 64),
    )
    canvas = Image.alpha_composite(canvas, glow)

    content = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # ── bars ──
    bar_w = 144 * u
    gap = 56 * u
    baseline = 762 * u
    heights = (214 * u, 342 * u, 476 * u)
    total_w = bar_w * 3 + gap * 2
    left = (S - total_w) / 2
    radius = 28 * u

    for i, h in enumerate(heights):
        x0 = int(left + i * (bar_w + gap))
        hh = int(h)
        ww = int(bar_w)
        grad = vertical_gradient(ww, hh, BAR_TOP, BAR_BOT)
        mask = Image.new("L", (ww, hh), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, ww - 1, hh - 1), radius=radius, fill=255)
        content.paste(grad, (x0, int(baseline) - hh), mask)

    d = ImageDraw.Draw(content)

    # baseline rail
    d.rounded_rectangle(
        (
            left,
            baseline + 32 * u,
            left + total_w,
            baseline + 32 * u + 14 * u,
        ),
        radius=7 * u,
        fill=(0xFF, 0xFF, 0xFF, 38),
    )

    # ── trend line ──
    lw = int(38 * u)
    pts = [
        (left + bar_w * 0.5, baseline - heights[0] - 58 * u),
        (left + (bar_w + gap) + bar_w * 0.5, baseline - heights[1] - 96 * u),
        (left + (bar_w + gap) * 2 + bar_w * 0.5, baseline - heights[2] - 148 * u),
    ]
    d.line(pts, fill=AMBER, width=lw, joint="curve")
    r = lw / 2
    for p in pts:
        d.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=AMBER)

    # arrow head, aligned with the final segment
    px_, py_ = pts[-2]
    qx, qy = pts[-1]
    ang = math.atan2(qy - py_, qx - px_)
    L = 96 * u          # head length
    W = 78 * u          # head half-width
    tipx = qx + L * 0.72 * math.cos(ang)
    tipy = qy + L * 0.72 * math.sin(ang)
    bx = qx - L * 0.28 * math.cos(ang)
    by = qy - L * 0.28 * math.sin(ang)
    nx, ny = -math.sin(ang), math.cos(ang)
    head = [
        (tipx, tipy),
        (bx + nx * W, by + ny * W),
        (bx - nx * W, by - ny * W),
    ]
    d.polygon(head, fill=AMBER)

    # ── rim highlight ──
    rim = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(rim).rounded_rectangle(
        (12 * u, 12 * u, S - 12 * u, S - 12 * u),
        radius=228 * u,
        outline=(0xFF, 0xFF, 0xFF, 30),
        width=int(7 * u),
    )
    content = Image.alpha_composite(content, rim)

    out = Image.alpha_composite(canvas, content)
    out.putalpha(rounded_mask(S, int(232 * u)))
    return out.resize((FINAL, FINAL), Image.Resampling.LANCZOS)


def main() -> None:
    dst = sys.argv[1] if len(sys.argv) > 1 else "src-tauri/icons/app-icon.png"
    icon = build()
    icon.save(dst)
    for size in (16, 32, 48):
        preview = icon.resize((size, size), Image.Resampling.LANCZOS)
        preview.save(f"src-tauri/icons/.preview-{size}.png")
    print(f"wrote {dst} ({icon.width}x{icon.height})")


if __name__ == "__main__":
    main()
