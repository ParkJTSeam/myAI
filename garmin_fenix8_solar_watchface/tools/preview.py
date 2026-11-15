import sys, math
from PIL import Image, ImageDraw
proj, out = sys.argv[1], sys.argv[2]
HB=[[108,0],[100,5],[94,9],[82,14],[22,16],[-44,20],[-53,13]]; HL=[[92,0],[82,9],[30,10]]
MB=[[180,0],[166,7],[154,11],[16,13],[-62,20],[-71,14]]; ML=[[164,0],[154,6],[34,6]]
def render(size,h,m,month,day,dow):
    d=f'{proj}/resources-round-{size}x{size}/drawables'; s=size/454; cx=cy=size//2
    L=lambda n: Image.open(f'{d}/{n}.png').convert('RGBA')
    px=lambda v: round(v*s)
    im=L('background'); im.alpha_composite(L(f'week{(dow+5)%7}'),(px(47),px(180)))
    y=px(320)
    for x,v in ((237,h//10),(256,h%10),(281,m//10),(300,m%10)): im.alpha_composite(L(f't{v}'),(px(x),y))
    y=px(277)
    if month>=10: im.alpha_composite(L(f'd{month//10}'),(px(282),y))
    im.alpha_composite(L(f'd{month%10}'),(px(298),y)); ImageDraw.Draw(im).rectangle((px(318),px(301),px(318)+max(2,px(3))-1,px(301)+max(2,px(3))-1),fill=(170,170,170,255))
    if day>=10: im.alpha_composite(L(f'd{day//10}'),(px(326),y))
    im.alpha_composite(L(f'd{day%10}'),(px(342),y))
    dr=ImageDraw.Draw(im)
    def poly(p,a):
        sn,cs=math.sin(a),math.cos(a); pts=[]
        rot=lambda dd,w:(round(cx+dd*s*sn+w*s*cs),round(cy-dd*s*cs+w*s*sn))
        for q in p: pts.append(rot(q[0],-q[1]))
        for q in reversed(p):
            if q[1]: pts.append(rot(q[0],q[1]))
        return pts
    for a,b,l in (((h%12*60+m)*math.pi/360,HB,HL),(m*math.pi/30,MB,ML)):
        o=poly(b,a); dr.polygon(o,fill=(0,0,0,255),outline=(85,85,85,255)); dr.polygon(poly(l,a),fill=(255,255,255,255))
    c=L('cap'); im.alpha_composite(c,(cx-c.width//2,cy-c.height//2))
    mask=Image.new('L',(size,size),0); ImageDraw.Draw(mask).ellipse((0,0,size-1,size-1),fill=255)
    bg=Image.new('RGBA',(size,size),(255,255,255,255)); bg.paste(im,(0,0),mask); return bg
a=render(260,10,9,11,15,1); b=render(280,18,54,9,5,4)
sheet=Image.new('RGBA',(580,300),(255,255,255,255)); sheet.paste(a,(10,20)); sheet.paste(b,(290,10))
sheet.resize((1160,600),Image.NEAREST).save(out)
