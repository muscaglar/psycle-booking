# Psync app icon (1024 PNG) — "Flow": two wheels (bike / pilates magic-circles)
# joined by a flowing pilates wave. Dependency-free PNG rasterizer.
import zlib, struct, math
W=H=1024; SS=3
TOP=(19,19,24); BOT=(8,8,10); WHITE=(248,248,250); RED=(233,69,96)
C1=(330,560); C2=(694,560); R_IN=86; R_OUT=122
WX0=318; WX1=706; AMP=46; WHALF=17
def bg(y):
    t=y/(H-1); return (int(TOP[0]+(BOT[0]-TOP[0])*t),int(TOP[1]+(BOT[1]-TOP[1])*t),int(TOP[2]+(BOT[2]-TOP[2])*t))
def ring(x,y,c): d=math.hypot(x-c[0],y-c[1]); return R_IN<=d<=R_OUT
def wave(x,y):
    if WX0<=x<=WX1:
        yc=560+AMP*math.sin((x-WX0)/(WX1-WX0)*2*math.pi)
        return abs(y-yc)<=WHALF
    return False
def sample(x,y,bgc):
    c=bgc
    if wave(x,y): c=RED
    if ring(x,y,C1) or ring(x,y,C2): c=WHITE
    return c
BX0,BX1,BY0,BY1=170,854,410,712; inv=1.0/(SS*SS); buf=bytearray()
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
open(out,'wb').write(png); print('wrote',out)
