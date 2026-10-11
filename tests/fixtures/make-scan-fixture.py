#!/usr/bin/env python3
# Regenerates tests/fixtures/external-transcript-scan.pdf: an IMAGE-ONLY PDF
# (no text layer) that stands in for a scanned external transcript in the e2e
# OCR leg. Pillow only:  python3 tests/fixtures/make-scan-fixture.py
from PIL import Image, ImageDraw, ImageFont

W, H = 1700, 2200
img = Image.new('L', (W, H), 246)
d = ImageDraw.Draw(img)
# The DejaVu fonts of the Linux VM this was written on, or the Mac's own
# (the script was first run on a Mac on 2026-09-15).
import os
def font(candidates, size):
    for c in candidates:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    raise SystemExit('no usable font found: ' + ', '.join(candidates))
f_big = font(['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'], 44)
f = font(['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'], 34)
f_mono = font(['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/System/Library/Fonts/Supplemental/Courier New.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'], 34)
y = 120
def line(text, font, dy):
    global y
    d.text((130, y), text, font=font, fill=20)
    y += dy
line('Purdue University', f_big, 70)
line('Office of the Registrar', f, 55)
line('Official Transcript', f, 55)
line('Student: John Q. Boilermaker', f, 55)
line('Program: Master of Science, Computer Science', f, 90)
line('Fall 2023', f_big, 70)
line('CS 50300    Operating Systems              3.0    A', f_mono, 55)
line('CS 59000    Special Topics in Systems      3.0    A-', f_mono, 95)
line('Spring 2024', f_big, 70)
line('CS 58000    Algorithm Design               3.0    B+', f_mono, 115)
line('Cumulative GPA: 3.83', f, 55)
img.convert('RGB').save('tests/fixtures/external-transcript-scan.pdf', 'PDF', resolution=150.0)
print('wrote tests/fixtures/external-transcript-scan.pdf')


# A CLEAN scan (2026-10-11, item 13): the same kind of image-only PDF, printed
# large and sharp at 300 dpi, so the engine reads three of its four rows with
# confidence — the e2e's leg for an UNFLAGGED scanned row (its scanned line
# stays behind the "show the scanned line" toggle), which the noisy scan above
# never exercised. (The engine scores the "Parallel Computing" line below its
# confidence floor although it reads it right: that row is flagged and its ⚠
# says so.) Four rows of 3.0 credits: no credit value stands alone (the
# cell-evidence flag), every grade a plain letter.
W2, H2 = 2550, 3300
clean = Image.new('L', (W2, H2), 255)
d2 = ImageDraw.Draw(clean)
g_big = font(['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'], 64)
g = font(['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'], 52)
g_mono = font(['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/System/Library/Fonts/Supplemental/Courier New.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'], 52)
y2 = 200
def line2(text, fnt, dy):
    global y2
    d2.text((200, y2), text, font=fnt, fill=0)
    y2 += dy
line2('Purdue University', g_big, 110)
line2('Office of the Registrar', g, 85)
line2('Official Transcript', g, 85)
line2('Program: Master of Science, Computer Science', g, 140)
line2('Fall 2023', g_big, 110)
line2('CS 50300    Operating Systems         3.0    A', g_mono, 90)
line2('CS 58000    Algorithm Design          3.0    A', g_mono, 150)
line2('Spring 2024', g_big, 110)
line2('CS 52500    Parallel Computing        3.0    A', g_mono, 90)
line2('CS 54100    Database Systems          3.0    A', g_mono, 150)
clean.convert('RGB').save('tests/fixtures/external-transcript-scan-clean.pdf', 'PDF', resolution=300.0)
print('wrote tests/fixtures/external-transcript-scan-clean.pdf')
