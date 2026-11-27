"""
Generate character sprite sheet for Bangron Virtual Office.

4 directions (S, W, E, N) x 4 walk frames, 48x64 px each.
Characters are drawn as clean top-down game sprites with transparent
background. Shirt is near-white so PixiJS can tint per department.
"""
from PIL import Image, ImageDraw
from pathlib import Path

W, H = 48, 64
DIRS = ['S', 'W', 'E', 'N']
FRAMES = 4
OUT = Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'sprites' / 'agents.png'
OUT.parent.mkdir(parents=True, exist_ok=True)

SKIN = (241, 194, 125, 255)
SKIN_DARK = (214, 163, 98, 255)
HAIR = (43, 36, 31, 255)
SHIRT = (235, 240, 248, 255)
SHIRT_DARK = (176, 190, 210, 255)
PANTS = (51, 65, 85, 255)
SHOE = (30, 41, 59, 255)
EYE = (15, 23, 42, 255)
OUTLINE = (24, 32, 48, 255)


def capsule(d, box, fill, outline=None, width=1):
    d.rounded_rectangle(box, radius=min(box[2]-box[0], box[3]-box[1])//2, fill=fill,
                        outline=outline, width=width)


def frame(direction, frame_index, ox, oy):
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    swing = [0, -1, 0, 1][frame_index]
    bob = [0, -1, 0, -1][frame_index]
    cx = W // 2
    # shadow
    d.ellipse((cx - 13, H - 13, cx + 13, H - 5), fill=(0, 0, 0, 55))
    # legs
    capsule(d, (cx - 9 + swing, 40 + bob, cx - 3 + swing, 59), PANTS, OUTLINE)
    capsule(d, (cx + 3 - swing, 40 + bob, cx + 9 - swing, 59), PANTS, OUTLINE)
    capsule(d, (cx - 10 + swing, 55, cx - 2 + swing, 62), SHOE)
    capsule(d, (cx + 2 - swing, 55, cx + 10 - swing, 62), SHOE)
    # arms
    capsule(d, (cx - 16, 25 + bob, cx - 10, 45 + bob - swing), SHIRT_DARK, OUTLINE)
    capsule(d, (cx + 10, 25 + bob, cx + 16, 45 + bob + swing), SHIRT_DARK, OUTLINE)
    # hands
    d.ellipse((cx - 16, 42 + bob - swing, cx - 10, 48 + bob - swing), fill=SKIN)
    d.ellipse((cx + 10, 42 + bob + swing, cx + 16, 48 + bob + swing), fill=SKIN)
    # torso
    capsule(d, (cx - 11, 22 + bob, cx + 11, 45 + bob), SHIRT, OUTLINE)
    d.polygon([(cx - 6, 22 + bob), (cx, 29 + bob), (cx + 6, 22 + bob)], fill=(255, 255, 255, 150))
    # neck + head
    d.rectangle((cx - 4, 17 + bob, cx + 4, 24 + bob), fill=SKIN_DARK)
    d.ellipse((cx - 11, 5 + bob, cx + 11, 27 + bob), fill=HAIR, outline=OUTLINE, width=1)
    d.ellipse((cx - 9, 8 + bob, cx + 9, 26 + bob), fill=SKIN)
    # hair cap depends on direction
    if direction == 'N':
        d.ellipse((cx - 10, 5 + bob, cx + 10, 18 + bob), fill=HAIR)
    elif direction == 'S':
        d.arc((cx - 10, 6 + bob, cx + 10, 22 + bob), 0, 180, fill=HAIR, width=4)
    elif direction == 'W':
        d.ellipse((cx - 10, 5 + bob, cx + 2, 22 + bob), fill=HAIR)
    else:
        d.ellipse((cx - 2, 5 + bob, cx + 10, 22 + bob), fill=HAIR)
    # eyes (direction aware)
    if direction == 'S':
        d.ellipse((cx - 6, 15 + bob, cx - 4, 18 + bob), fill=EYE)
        d.ellipse((cx + 4, 15 + bob, cx + 6, 18 + bob), fill=EYE)
    elif direction == 'N':
        pass  # back of head
    elif direction == 'W':
        d.ellipse((cx - 8, 15 + bob, cx - 6, 18 + bob), fill=EYE)
    else:
        d.ellipse((cx + 6, 15 + bob, cx + 8, 18 + bob), fill=EYE)
    return img


sheet = Image.new('RGBA', (W * FRAMES, H * len(DIRS)), (0, 0, 0, 0))
for row, dr in enumerate(DIRS):
    for col in range(FRAMES):
        sheet.paste(frame(dr, col, 0, 0), (col * W, row * H))

sheet.save(OUT)
print(f'{OUT} {sheet.size[0]}x{sheet.size[1]}')
