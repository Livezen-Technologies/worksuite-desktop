#!/usr/bin/env python3
"""Windows installer artwork for WorkSuite Desktop, drawn from build/icon.png and the icon's brand colours.

    python3 scripts/make-installer-art.py

Writes into build/ (electron-builder picks these names up by default for NSIS):
  installerSidebar.bmp   164x314  welcome / finish pages (installer and uninstaller)
  installerHeader.bmp    150x57   the header of the other pages
  license.txt            the licence page: LICENSE, as UTF-8 with a byte-order mark (NSIS reads a file without one
                         as ANSI, which garbles the (c) and the dashes)
The installer and uninstaller icons are electron-builder's conversion of build/icon.png (no .ico is kept here:
Pillow writes PNG-compressed .ico entries, which NSIS's icon replacement does not take at small sizes).
Needs Pillow. The output is committed, so a build does not need Python.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / 'build'
NAVY = (0, 24, 66)
BLUE = (10, 108, 255)
CYAN = (0, 218, 242)
WHITE = (255, 255, 255)


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    for name in (['DejaVuSans-Bold.ttf', 'Arial Bold.ttf'] if bold else ['DejaVuSans.ttf', 'Arial.ttf']):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default(size)


def icon(size: int) -> Image.Image:
    return Image.open(BUILD / 'icon.png').convert('RGBA').resize((size, size), Image.LANCZOS)


def centred(draw: ImageDraw.ImageDraw, width: int, y: int, text: str, f, fill) -> None:
    w = draw.textlength(text, font=f)
    draw.text(((width - w) / 2, y), text, font=f, fill=fill)


def sidebar() -> None:
    w, h = 164, 314
    img = Image.new('RGB', (w, h), NAVY)
    d = ImageDraw.Draw(img)
    for y in range(h):  # navy at the top to the brand blue at the bottom
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=tuple(round(NAVY[i] + (BLUE[i] - NAVY[i]) * t * 0.6) for i in range(3)))
    ic = icon(84)
    img.paste(ic, ((w - 84) // 2, 56), ic)
    centred(d, w, 156, 'WorkSuite', font(22, bold=True), WHITE)
    centred(d, w, 184, 'Desktop', font(16), CYAN)
    d.rectangle([(0, h - 4), (w, h)], fill=CYAN)
    img.save(BUILD / 'installerSidebar.bmp')


def header() -> None:
    w, h = 150, 57
    img = Image.new('RGB', (w, h), WHITE)
    d = ImageDraw.Draw(img)
    ic = icon(40)
    img.paste(ic, (6, (h - 40) // 2), ic)
    d.text((52, 12), 'WorkSuite', font=font(15, bold=True), fill=NAVY)
    d.text((52, 31), 'Desktop', font=font(12), fill=BLUE)
    img.save(BUILD / 'installerHeader.bmp')


def licence() -> None:
    (BUILD / 'license.txt').write_bytes(b'\xef\xbb\xbf' + (ROOT / 'LICENSE').read_text(encoding='utf-8').replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8'))


if __name__ == '__main__':
    sidebar()
    header()
    licence()
