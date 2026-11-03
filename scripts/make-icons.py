"""Original geometric stamp mark. Rebuild with Python + Pillow; no network."""
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parents[1] / 'icons'
for name, size, maskable in [('icon-192.png',192,False), ('icon-512.png',512,False), ('maskable-512.png',512,True)]:
    scale = 4
    im = Image.new('RGB', (size*scale, size*scale), '#111827')
    d = ImageDraw.Draw(im)
    def box(coords): return tuple(round(v*size*scale) for v in coords)
    # All meaningful content is inside the maskable safe circle (radius 40%).
    d.rounded_rectangle(box((.23,.20,.77,.70)), radius=int(size*scale*.095), fill='#baf568')
    d.rounded_rectangle(box((.32,.30,.68,.40)), radius=int(size*scale*.035), fill='#111827')
    d.rounded_rectangle(box((.32,.48,.68,.58)), radius=int(size*scale*.035), fill='#111827')
    d.rectangle(box((.32,.36,.42,.53)), fill='#111827')
    d.rectangle(box((.58,.37,.68,.53)), fill='#111827')
    d.rounded_rectangle(box((.28,.74,.72,.80)), radius=int(size*scale*.025), fill='#baf568')
    im.resize((size,size), Image.Resampling.LANCZOS).save(root/name)
