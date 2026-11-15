"""Convert extracted Amazfit images into Garmin MIP (64-color) resources."""
import sys, os
from PIL import Image, ImageFilter
import random
src, proj = sys.argv[1], sys.argv[2]
random.seed(1)
L=[0,85,170,255]
PAL=[(r,g,b) for r in L for g in L for b in L]
def pal_img():
    p=Image.new('P',(1,1)); flat=[c for t in PAL for c in t]; p.putpalette(flat+[0]*(768-len(flat))); return p
PALIMG=pal_img()
def quant(im, dither):
    """Quantize RGBA to MIP 64-color palette; alpha -> 1 bit."""
    a=im.getchannel('A').point(lambda v:255 if v>=128 else 0)
    rgb=im.convert('RGB').quantize(palette=PALIMG, dither=Image.Dither.FLOYDSTEINBERG if dither else Image.Dither.NONE).convert('RGB')
    out=rgb.convert('RGBA'); out.putalpha(a); return out
def load(i): return Image.open(f'{src}/{i:02d}_raw.png').convert('RGBA')

# --- background: remove third-party brand logos, then boost for MIP ---
bg=load(0)
px=bg.load()
for y in range(116,168):
    for x in range(158,300):
        r,g,b,_=px[x,y]
        if r>=45:
            n=random.randint(-2,2); px[x,y]=(66+n,65+n,63+n,255)
bg_clean=bg.copy()
def mip_bg(size):
    im=bg_clean.resize((size,size),Image.LANCZOS).convert('L')
    im=im.point(lambda v:min(255,int(v*1.30)))   # dial ~66 -> ~85 (solid dark gray on MIP)
    out=quant(im.convert('RGBA'),True); s=size/454; q=out.load()
    # clear stray dither highlights left in the erased logo area
    for y in range(round(100*s),round(168*s)):
        for x in range(round(158*s),round(300*s)):
            if q[x,y][0]>=170: q[x,y]=(85,85,85,255)
    return out

def scaled(i,s,dither=False):
    im=load(i); w,h=im.size
    return quant(im.resize((max(1,round(w*s)),max(1,round(h*s))),Image.LANCZOS),dither)

names={}
for size in (260,280):
    s=size/454
    d=f'{proj}/resources-round-{size}x{size}/drawables'; os.makedirs(d,exist_ok=True)
    mip_bg(size).convert('RGB').save(f'{d}/background.png')
    c=load(3); a=c.getchannel('A'); c=c.convert('L').convert('RGBA'); c.putalpha(a)
    quant(c.resize((round(32*s),round(32*s)),Image.LANCZOS),False).save(f'{d}/cap.png')
    for k in range(7): scaled(5+k,s,True).save(f'{d}/week{k}.png')
    for k in range(10):
        scaled(12+k,s).save(f'{d}/t{k}.png'); scaled(22+k,s).save(f'{d}/d{k}.png')
    xml=['<drawables>','  <bitmap id="Background" filename="background.png" dithering="none"/>',
         '  <bitmap id="Cap" filename="cap.png" dithering="none"/>',]
    xml+=[f'  <bitmap id="Week{k}" filename="week{k}.png" dithering="none"/>' for k in range(7)]
    xml+=[f'  <bitmap id="T{k}" filename="t{k}.png" dithering="none"/>' for k in range(10)]
    xml+=[f'  <bitmap id="D{k}" filename="d{k}.png" dithering="none"/>' for k in range(10)]
    xml.append('</drawables>')
    open(f'{d}/drawables.xml','w').write('\n'.join(xml)+'\n')
# launcher icon from preview image
d=f'{proj}/resources/drawables'; os.makedirs(d,exist_ok=True)
ic=bg_clean.resize((60,60),Image.LANCZOS)
quant(ic,True).save(f'{d}/launcher_icon.png')
