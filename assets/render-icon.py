import zlib, struct, math

W=H=1024
SS=3
# --- geometry (1024 space) ---
# background gradient
TOP=(19,19,24); BOT=(8,8,10)
# streaks (horizontal capsules): (x0,x1,yc,alpha)
STREAKS=[(150,360,362,0.70),(104,390,512,1.0),(150,360,662,0.70)]
SR=23; SCOL=(233,69,96)
# D outer
L,R,T,B=455,812,290,734
VY=512; HH=222; CX=R-HH  # 590
# D inner counter
Lp,Tp,Bp=550,385,639; HHp=127; Rp=717; CXp=Rp-HHp  # 590
DWHITE=(250,250,250)

def in_streak(x,y):
    for x0,x1,yc,a in STREAKS:
        if yc-SR<=y<=yc+SR:
            cx0=x0+SR; cx1=x1-SR
            if cx0<=x<=cx1: return a
            # end caps
            if (x-cx0)**2+(y-yc)**2<=SR*SR: return a
            if (x-cx1)**2+(y-yc)**2<=SR*SR: return a
    return 0.0

def in_outer(x,y):
    if not (T<=y<=B and x>=L): return False
    if x<=CX: return True
    return (x-CX)**2+(y-VY)**2 <= HH*HH

def in_inner(x,y):
    if not (Tp<=y<=Bp and x>=Lp): return False
    if x<=CXp: return True
    return (x-CXp)**2+(y-VY)**2 <= HHp*HHp

def bg(y):
    t=y/(H-1)
    return (int(TOP[0]+(BOT[0]-TOP[0])*t),
            int(TOP[1]+(BOT[1]-TOP[1])*t),
            int(TOP[2]+(BOT[2]-TOP[2])*t))

def sample(x,y,bgc):
    a=in_streak(x,y)
    if a>0:
        c=(int(bgc[0]+(SCOL[0]-bgc[0])*a),int(bgc[1]+(SCOL[1]-bgc[1])*a),int(bgc[2]+(SCOL[2]-bgc[2])*a))
    else:
        c=bgc
    if in_outer(x,y) and not in_inner(x,y):
        c=DWHITE
    return c

# bbox where AA/shapes live; outside -> pure bg (fast path)
BX0,BX1,BY0,BY1=80,820,280,744
buf=bytearray()
inv=1.0/(SS*SS)
for py in range(H):
    bgrow=bg(py)
    bgr=bytes(bgrow)
    row=bytearray()
    for px in range(W):
        if px<BX0 or px>BX1 or py<BY0 or py>BY1:
            row+=bgr; row.append(255); continue
        r=g=b=0
        for sy in range(SS):
            yy=py+(sy+0.5)/SS
            for sx in range(SS):
                xx=px+(sx+0.5)/SS
                c=sample(xx,yy,bgrow)
                r+=c[0]; g+=c[1]; b+=c[2]
        row.append(int(r*inv)); row.append(int(g*inv)); row.append(int(b*inv)); row.append(255)
    buf+=b'\x00'+bytes(row)

def chunk(typ,data):
    c=typ+data
    return struct.pack('>I',len(data))+c+struct.pack('>I',zlib.crc32(c)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'
png+=chunk(b'IHDR',struct.pack('>IIBBBBB',W,H,8,6,0,0,0))
png+=chunk(b'IDAT',zlib.compress(bytes(buf),9))
png+=chunk(b'IEND',b'')
out='ios-app/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'
open(out,'wb').write(png)
print('wrote',out,len(png),'bytes')
