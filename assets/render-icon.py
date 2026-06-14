import zlib, struct, math
W=H=1024; SS=3
TOP=(19,19,24); BOT=(8,8,10)
CX=CY=512; R_OUT=300; R_IN=212; MIDR=256; HALF=44
RED=(233,69,96); WHITE=(250,250,250)
# arcs (degrees, atan2 with y-down): A red top, B white bottom
A0,A1=-155,-20   # red
B0,B1=25,160     # white
def cap(deg): return (CX+MIDR*math.cos(math.radians(deg)), CY+MIDR*math.sin(math.radians(deg)))
capA=cap(A0); capB=cap(B0)  # rounded tails
# arrowheads (apex, base1, base2)
def head(te):
    t=math.radians(te); c=math.cos(t); s=math.sin(t)
    pm=(CX+MIDR*c, CY+MIDR*s)
    tan=(-s,c); n=(c,s); L=92; Wd=66
    apex=(pm[0]+tan[0]*L, pm[1]+tan[1]*L)
    b1=(pm[0]+n[0]*Wd, pm[1]+n[1]*Wd); b2=(pm[0]-n[0]*Wd, pm[1]-n[1]*Wd)
    return (apex,b1,b2)
headA=head(A1); headB=head(B1)
def tri(p,a,b,c):
    d1=(p[0]-b[0])*(a[1]-b[1])-(a[0]-b[0])*(p[1]-b[1])
    d2=(p[0]-c[0])*(b[1]-c[1])-(b[0]-c[0])*(p[1]-c[1])
    d3=(p[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(p[1]-a[1])
    neg=(d1<0)or(d2<0)or(d3<0); pos=(d1>0)or(d2>0)or(d3>0)
    return not(neg and pos)
def bg(y):
    t=y/(H-1); return (int(TOP[0]+(BOT[0]-TOP[0])*t),int(TOP[1]+(BOT[1]-TOP[1])*t),int(TOP[2]+(BOT[2]-TOP[2])*t))
def sample(x,y,bgc):
    dx=x-CX; dy=y-CY; d=math.hypot(dx,dy); c=bgc
    if R_IN<=d<=R_OUT:
        ang=math.degrees(math.atan2(dy,dx))
        if B0<=ang<=B1: c=WHITE
        if A0<=ang<=A1: c=RED
    # rounded tails
    if math.hypot(x-capA[0],y-capA[1])<=HALF: c=RED
    if math.hypot(x-capB[0],y-capB[1])<=HALF: c=WHITE
    # arrowheads on top
    if tri((x,y),*headA): c=RED
    if tri((x,y),*headB): c=WHITE
    return c
BX0,BX1,BY0,BY1=170,854,170,854; inv=1.0/(SS*SS); buf=bytearray()
for py in range(H):
    bgrow=bg(py); bgr=bytes(bgrow); row=bytearray()
    for px in range(W):
        if px<BX0 or px>BX1 or py<BY0 or py>BY1:
            row+=bgr; row.append(255); continue
        r=g=b=0
        for sy in range(SS):
            yy=py+(sy+0.5)/SS
            for sx in range(SS):
                c=sample(px+(sx+0.5)/SS,yy,bgrow); r+=c[0]; g+=c[1]; b+=c[2]
        row.append(int(r*inv)); row.append(int(g*inv)); row.append(int(b*inv)); row.append(255)
    buf+=b'\x00'+bytes(row)
def chunk(t,d): c=t+d; return struct.pack('>I',len(d))+c+struct.pack('>I',zlib.crc32(c)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',W,H,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(buf),9))+chunk(b'IEND',b'')
out='ios-app/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'
open(out,'wb').write(png); print('wrote',out,len(png),'bytes')
