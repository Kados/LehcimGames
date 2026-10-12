"""Print the readable French text (cp1252) embedded in an executable: rules, help, messages.
Usage: python3 exe_text.py GAME.EXE"""
import sys,re
d=open(sys.argv[1],'rb').read()
ok=set(range(32,127))|set(range(0xc0,0x100))|{0x92,0x9c,0x80,0xab,0xbb,0xb0}
cur=bytearray(); out=[]
for b in d:
    if b in ok: cur.append(b)
    else:
        if len(cur)>=25 and sum(c==32 for c in cur)>=3: out.append(cur.decode('cp1252'))
        cur=bytearray()
seen=set()
for s in out:
    if s not in seen: seen.add(s); print(s)
