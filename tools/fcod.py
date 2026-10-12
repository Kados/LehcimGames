"""Decode the custom FCOD resources (same RLE format as .LIO) dumped by neres.py into PNG files.
Usage: python3 fcod.py RESDIR PALETTE.bin OUTDIR   (PALETTE.bin = a 1024-byte FCOD resource holding 256 RGBQUAD entries)"""
import sys,struct,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from lio2png import png,best_width
d,palf,out=sys.argv[1:4]; os.makedirs(out,exist_ok=True)
pd=open(palf,'rb').read(); P=[(pd[4*i+2],pd[4*i+1],pd[4*i]) for i in range(256)]
for f in sorted(os.listdir(d)):
    if not f.startswith('FCOD'): continue
    b=open(os.path.join(d,f),'rb').read()
    raw,comp=struct.unpack('<II',b[:8]); body=b[8:8+comp]
    if comp>len(b)-8 or sum(body[i+1] for i in range(0,len(body)-1,2))!=raw: print(f,'not RLE',len(b)); continue
    px=bytearray()
    for i in range(0,len(body)-1,2): px+=bytes([body[i]])*body[i+1]
    bw=best_width(px)
    if not bw: print(f,'no width',raw); continue
    w=bw[0][1]; h=raw//w
    rows=[px[y*w:(y+1)*w] for y in range(h)][::-1]
    png(os.path.join(out,f[:-4]+'.png'),w,h,b''.join(bytes(P[c]) for r in rows for c in r)); print(f,w,h,bw[:2])
