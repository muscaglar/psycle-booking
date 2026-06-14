# Renders the Psync app icon (1024 PNG) — a ring (bike wheel / pilates
# magic-circle) crossed by a dumbbell. Dependency-free PNG rasterizer.
import zlib, struct, math
W=H=1024; SS=3
TOP=(19,19,24); BOT=(8,8,10)
WHITE=(250,250,250); RED=(233,69,96)
CX=CY=512; R_IN=197; R_OUT=235
def ring(x,y): d=math.hypot(x-CX,y-CY); return R_IN<=d<=R_OUT
def seg(x,y,x0,y0,x1,y1,half):
    dx=x1-x0; dy=y1-y0; L2=dx*dx+dy*dy
    t=0 if L2==0 else max(0,min(1,((x-x0)*dx+(y-y0)*dy)/L2))
    return math.hypot(x-(x0+t*dx),y-(y0+t*dy))<=half
def dumbbell(x,y):
    return (seg(x,y,300,512,724,512,16)      # handle
         or seg(x,y,266,446,266,578,28)      # left weight
         or seg(x,y,758,446,758,578,28))     # right weight
def bg(y):
    t=y/(H-1); return (int(TOP[0]+(BOT[0]-TOP[0])*t),int(TOP[1]+(BOT[1]-TOP[1])*t),int(TOP[2]+(BOT[2]-TOP[2])*t))
def sample(x,y,bgc):
    c=bgc
    if ring(x,y): c=WHITE
    if dumbbell(x,y): c=RED
    return c
BX0,BX1,BY0,BY1=210,814,250,774; inv=1.0/(SS*SS); buf=bytearray()
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
