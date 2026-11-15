import struct,sys,os
from PIL import Image
d=open(sys.argv[1],'rb').read(); out=sys.argv[2]; os.makedirs(out,exist_ok=True)
n=33; tbl=0x112; offs=struct.unpack('<%dI'%n,d[tbl:tbl+4*n]); res=tbl+4*n
for i,o in enumerate(offs):
    p=res+o
    w,h,bpp,hl=struct.unpack('<IIII',d[p+4:p+20])
    px=d[p+24:p+24+w*h*4]
    print(i,w,h,d[p+20:p+24].hex(), px[:16].hex())
    img=Image.frombytes('RGBA',(w,h),px)
    img.save(f'{out}/{i:02d}_raw.png')
