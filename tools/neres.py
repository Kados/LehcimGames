"""Dump the resources of a 16-bit Windows NE executable (bitmaps as .bmp, the rest as .bin; WAVE resources are plain RIFF .wav).
Usage: python3 neres.py GAME.EXE OUTDIR"""
import sys,struct,os
exe,outdir=sys.argv[1:3]; os.makedirs(outdir,exist_ok=True)
d=open(exe,'rb').read(); ne=struct.unpack_from('<I',d,0x3c)[0]
rt=ne+struct.unpack_from('<H',d,ne+0x24)[0]; rn=ne+struct.unpack_from('<H',d,ne+0x26)[0]
shift=struct.unpack_from('<H',d,rt)[0]; p=rt+2
def name(off): 
    l=d[rt+off]; return d[rt+off+1:rt+off+1+l].decode('latin1')
types={1:'cursor',2:'bitmap',3:'icon',4:'menu',5:'dialog',6:'string',10:'rcdata',14:'groupicon'}
while True:
    tid,cnt=struct.unpack_from('<HH',d,p)
    if tid==0: break
    p+=8
    tn=types.get(tid&0x7fff,str(tid&0x7fff)) if tid&0x8000 else name(tid)
    for i in range(cnt):
        off,ln,fl,rid=struct.unpack_from('<HHHH',d,p); p+=12
        nm=str(rid&0x7fff) if rid&0x8000 else name(rid)
        data=d[off<<shift:(off<<shift)+(ln<<shift)]
        fn=f'{tn}_{nm}'.replace('/','_')
        if tn=='bitmap':
            hs=struct.unpack_from('<I',data,0)[0]; bpp=struct.unpack_from('<H',data,14)[0]; nc=struct.unpack_from('<I',data,32)[0] if hs>=40 else 0
            if not nc and bpp<=8: nc=1<<bpp
            data=b'BM'+struct.pack('<IHHI',14+len(data),0,0,14+hs+nc*4)+data; fn+='.bmp'
            w,h=struct.unpack_from('<ii',data,18); print(fn,w,h,bpp)
        else:
            fn+='.bin'; print(fn,len(data))
        open(os.path.join(outdir,fn),'wb').write(data)
