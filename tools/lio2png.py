"""Decode a .LIO graphics bank (8-byte header + RLE (value,count) pairs) to PNG using a *PAL.bmp palette.
Usage: python3 lio2png.py FILE.LIO PALETTE.bmp OUT.png [width]
The width is guessed from row-to-row similarity when not given. Rows are stored bottom-up (like BMP)."""
import sys,struct,zlib
def png(path,w,h,rgb):
    raw=b''.join(b'\0'+rgb[y*w*3:(y+1)*w*3] for y in range(h))
    def ch(t,d): return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    open(path,'wb').write(b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+ch(b'IDAT',zlib.compress(raw,9))+ch(b'IEND',b''))
def decode(p):
    d=open(p,'rb').read(); raw,comp=struct.unpack('<II',d[:8]); b=d[8:]; out=bytearray()
    for i in range(0,len(b)-1,2): out+=bytes([b[i]])*b[i+1]
    return bytes(out)
def pal(p):
    d=open(p,'rb').read(); return [(d[54+4*i+2],d[54+4*i+1],d[54+4*i]) for i in range(256)]
def best_width(px):
    n=len(px); res=[]
    for w in range(200,1300):
        if n%w: continue
        h=n//w; s=sum(px[i]==px[i+w] for i in range(0,n-w,97)); res.append((s/((n-w)//97+1),w,h))
    return sorted(res,reverse=True)[:5]
if __name__=='__main__':
    lio,pl,out=sys.argv[1:4]; px=decode(lio); P=pal(pl)
    bw=best_width(px); print(lio,len(px),bw)
    w=int(sys.argv[4]) if len(sys.argv)>4 else bw[0][1]; h=len(px)//w
    rows=[px[y*w:(y+1)*w] for y in range(h)][::-1]; rgb=b''.join(bytes(P[c]) for r in rows for c in r); png(out,w,h,rgb); print('wrote',out,w,h)
