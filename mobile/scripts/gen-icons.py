"""
Builds the app icons from the Aether Nova logo (assets/brand/aether-nova.svg, the same vector as
the company website's assets/logo.svg).

Needs Google Chrome (renders the SVG, including its gradients) and Pillow (pip install pillow).
Run from mobile/:  python scripts/gen-icons.py
"""
import os
import re
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
CHROME = os.environ.get("CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def render(svg: str, out: Path) -> Image.Image:
    """Renders the SVG 1000 px wide on a transparent 1000x1000 page and crops it to the logo."""
    html = out.with_suffix(".html")
    html.write_text(
        "<!doctype html><html><head><style>html,body{margin:0;background:transparent;width:1000px;height:1000px;"
        "display:flex;align-items:center;justify-content:center;overflow:hidden}</style></head><body>" + svg + "</body></html>",
        encoding="utf-8",
    )
    subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
         "--window-size=1000,1000", f"--screenshot={out}", html.as_uri()],
        check=True, capture_output=True,
    )
    im = Image.open(out).convert("RGBA")
    return im.crop(im.getchannel("A").getbbox())


def place(logo: Image.Image, size: int, width_frac: float, bg=None) -> Image.Image:
    """The logo centred on a square canvas, `width_frac` of its width."""
    canvas = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0))
    w = round(size * width_frac)
    h = round(logo.height * w / logo.width)
    canvas.alpha_composite(logo.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2))
    return canvas


def main():
    svg = (ASSETS / "brand" / "aether-nova.svg").read_text(encoding="utf-8")
    svg = svg.replace('width="1030" height="610"', 'width="1000" height="592"')
    # One-colour version for Android's monochrome and notification icons (they only use transparency).
    white = re.sub(r'fill="url\(#[a-z-]+\)"', 'fill="#ffffff"', svg)
    white = white.replace('stroke="#7ff3ff"', 'stroke="none"')
    white = re.sub(r"<ellipse[^>]*/>", "", white)

    with tempfile.TemporaryDirectory() as tmp:
        color = render(svg, Path(tmp) / "color.png")
        mono = render(white, Path(tmp) / "white.png")

    place(color, 1024, 0.80, (255, 255, 255, 255)).convert("RGB").save(ASSETS / "icon.png")
    # Adaptive icon: the logo must stay inside the central safe circle (about 66% of the canvas).
    place(color, 1024, 0.56).save(ASSETS / "android-icon-foreground.png")
    place(mono, 1024, 0.56).save(ASSETS / "android-icon-monochrome.png")
    Image.new("RGB", (1024, 1024), (255, 255, 255)).save(ASSETS / "android-icon-background.png")
    place(color, 1024, 0.90).save(ASSETS / "splash-icon.png")
    place(mono, 96, 0.92).save(ASSETS / "notification-icon.png")
    place(color, 196, 0.92).save(ASSETS / "favicon.png")
    print("Icons written to", ASSETS)


if __name__ == "__main__":
    main()
