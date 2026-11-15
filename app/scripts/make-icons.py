"""Vẽ bộ icon của WujoAgent: dấu nhắc lệnh ">" và con trỏ "_" trên nền tối.

Chạy:  python scripts/make-icons.py   (cần Pillow)
Ghi đè các file trong assets/. Sửa màu hay nét ở đây rồi chạy lại, đừng sửa tay file PNG.
"""
import os
from PIL import Image, ImageDraw

BG = (27, 26, 24)        # #1b1a18, nền của app ở chế độ tối
ACCENT = (217, 119, 87)  # #d97757
LIGHT = (238, 236, 230)  # #eeece6
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets')
SS = 4  # vẽ lớn gấp 4 rồi thu nhỏ để nét mịn


def glyph(size, scale, chevron, cursor):
    """Lớp trong suốt cỡ size×size chứa dấu ">" và "_", chiếm `scale` bề ngang."""
    n = size * SS
    layer = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    w = n * scale              # bề ngang của cả cụm
    stroke = w * 0.13
    x0 = (n - w) / 2
    cy = n / 2
    h = w * 0.36               # nửa chiều cao dấu ">"
    tip = x0 + w * 0.44
    # dấu ">" : hai nét bo tròn đầu
    for (ax, ay, bx, by) in ((x0, cy - h, tip, cy), (tip, cy, x0, cy + h)):
        d.line((ax, ay, bx, by), fill=chevron, width=int(stroke))
    r = stroke / 2
    for (px, py) in ((x0, cy - h), (tip, cy), (x0, cy + h)):
        d.ellipse((px - r, py - r, px + r, py + r), fill=chevron)
    # con trỏ "_"
    ux0, ux1, uy = x0 + w * 0.58, x0 + w, cy + h
    d.line((ux0, uy, ux1, uy), fill=cursor, width=int(stroke))
    for px in (ux0, ux1):
        d.ellipse((px - r, uy - r, px + r, uy + r), fill=cursor)
    return layer.resize((size, size), Image.LANCZOS)


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path)
    print(f'{name}: {img.size[0]}x{img.size[1]} {img.mode}')


# Icon iOS và icon chung: nền đặc, không trong suốt, không bo góc (App Store tự bo).
icon = Image.new('RGBA', (1024, 1024), BG + (255,))
icon.alpha_composite(glyph(1024, 0.52, ACCENT + (255,), LIGHT + (255,)))
save(icon.convert('RGB'), 'icon.png')

# Icon thích ứng của Android: hình phải nằm trong vùng an toàn giữa (khoảng 61% bề ngang).
save(glyph(1024, 0.36, ACCENT + (255,), LIGHT + (255,)), 'android-icon-foreground.png')
save(Image.new('RGB', (1024, 1024), BG), 'android-icon-background.png')
save(glyph(1024, 0.36, (255, 255, 255, 255), (255, 255, 255, 255)), 'android-icon-monochrome.png')

# Màn chờ: chỉ có hình, nền do app.json đặt.
save(glyph(1024, 0.42, ACCENT + (255,), LIGHT + (255,)), 'splash-icon.png')

# Favicon của bản web và landing page.
fav = Image.new('RGBA', (192, 192), BG + (255,))
fav.alpha_composite(glyph(192, 0.56, ACCENT + (255,), LIGHT + (255,)))
save(fav.resize((48, 48), Image.LANCZOS), 'favicon.png')
