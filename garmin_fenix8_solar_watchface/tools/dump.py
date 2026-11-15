import struct,sys
d=open(sys.argv[1],'rb').read()
def varint(b,i):
    r=0;s=0
    while True:
        c=b[i];i+=1;r|=(c&0x7f)<<s;s+=7
        if c<0x80:return r,i
def parse(b,depth=0):
    i=0;out=[]
    while i<len(b):
        k,i=varint(b,i);f=k>>3;t=k&7
        if t==0:
            v,i=varint(b,i);out.append((f,v))
        elif t==2:
            l,i=varint(b,i);sub=b[i:i+l];i+=l
            try: out.append((f,parse(sub)))
            except Exception: out.append((f,sub))
        else: raise ValueError(t)
    return out
def show(p,ind=0):
    for f,v in p:
        if isinstance(v,list):print(' '*ind+str(f)+':');show(v,ind+2)
        else:print(' '*ind+f'{f}: {v}')
desc=d[0x40:0x60]; dp=parse(desc); show(dp)
base=0x60
for f,v in dp[1:]:
    off=dict(v).get(1,0); ln=dict(v)[2]
    print('=== section',f); show(parse(d[base+off:base+off+ln]),2)
n=dict(dp[0][1])[2]
tbl=0x60+178
offs=struct.unpack('<%dI'%n,d[tbl:tbl+4*n])
print([hex(o) for o in offs])
res=tbl+4*n
for idx,o in enumerate(offs):
    p=res+o
    print(idx,hex(p),d[p:p+20].hex())
