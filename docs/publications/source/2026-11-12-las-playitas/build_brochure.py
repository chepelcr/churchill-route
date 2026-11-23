from pathlib import Path
from tempfile import TemporaryDirectory
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF
from fontTools.ttLib import TTFont as FontToolsFont
from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
IMG = ROOT / 'docs/publications/img/2026-11-12-las-playitas'
OUT = ROOT / 'output/pdf/las-playitas-tres-versiones.pdf'
_tmp = TemporaryDirectory(prefix='churchill-playitas-')
TMP = Path(_tmp.name)
OUT.parent.mkdir(parents=True, exist_ok=True)

font_source = next((ROOT/'node_modules/.pnpm/@fontsource+bungee@5.2.7').rglob('bungee-latin-400-normal.woff'))
font = FontToolsFont(font_source)
font.flavor = None
font.save(TMP/'bungee.ttf')
pdfmetrics.registerFont(TTFont('Bungee',str(TMP/'bungee.ttf')))
pdfmetrics.registerFont(TTFont('Body','/System/Library/Fonts/Supplemental/Trebuchet MS.ttf'))
pdfmetrics.registerFont(TTFont('Bold','/System/Library/Fonts/Supplemental/Trebuchet MS Bold.ttf'))

W,H = 1200,840
PAGE = (841.8898,595.2756)
c = canvas.Canvas(str(OUT),pagesize=PAGE)
c.setTitle('Las Playitas · Tres versiones, un mismo barrio')
c.setAuthor('La Ruta del Churchill')
c.setSubject('La evolución de Las Playitas: imagen original, versión histórica y juego actual.')
c.scale(PAGE[0]/W,PAGE[1]/H)
NAVY='#201D39'; PINK='#F52A69'; GOLD='#FFC642'; CREAM='#FFF4DA'; CYAN='#37C3E6'; TEAL='#18A9B6'

def box(x,y,w,h,color,r=0,stroke=None,lw=1):
    c.setFillColor(HexColor(color)); c.setLineWidth(lw)
    c.setStrokeColor(HexColor(stroke or color))
    if r:c.roundRect(x,H-y-h,w,h,r,fill=1,stroke=bool(stroke))
    else:c.rect(x,H-y-h,w,h,fill=1,stroke=bool(stroke))

def line(x1,y1,x2,y2,col,lw=1):
    c.setStrokeColor(HexColor(col));c.setLineWidth(lw);c.line(x1,H-y1,x2,H-y2)

def text(s,x,y,font='Body',size=18,col=NAVY,align='left'):
    t=c.beginText();t.setFont(font,size);t.setFillColor(HexColor(col));t.setTextRenderMode(0)
    width=pdfmetrics.stringWidth(s,font,size)
    t.setTextOrigin(x-(width/2 if align=='center' else width if align=='right' else 0),H-y)
    t.textOut(s);c.drawText(t)

def wrap(s,x,y,width,size=18,leading=25,font='Body',col=NAVY):
    words=s.split();lines=[];current=''
    for word in words:
        trial=(current+' '+word).strip()
        if pdfmetrics.stringWidth(trial,font,size)>width and current:
            lines.append(current);current=word
        else:current=trial
    if current:lines.append(current)
    for i,s in enumerate(lines):text(s,x,y+i*leading,font,size,col)
    return y+len(lines)*leading

def image_cover(path,x,y,w,h):
    iw,ih=Image.open(path).size
    scale=max(w/iw,h/ih);dw,dh=iw*scale,ih*scale
    c.saveState();p=c.beginPath();p.roundRect(x,H-y-h,w,h,10);c.clipPath(p,stroke=0)
    c.drawImage(ImageReader(str(path)),x+(w-dw)/2,H-y-h+(h-dh)/2,dw,dh,mask='auto')
    c.restoreState()

def circle(x,y,r,color):
    c.setFillColor(HexColor(color));c.circle(x,H-y,r,fill=1,stroke=0)

def palm(x,y,scale=1):
    c.saveState();c.translate(x,H-y);c.scale(scale,scale)
    c.setStrokeColor(HexColor(NAVY));c.setLineWidth(3)
    p=c.beginPath();p.moveTo(0,0);p.curveTo(6,20,2,38,-2,56);c.drawPath(p)
    c.setFillColor(HexColor('#167B60'))
    for a,b in [(-35,53),(-30,73),(-9,82),(23,76),(36,54)]:
        p=c.beginPath();p.moveTo(-2,56);p.curveTo(a*.5,b+12,a,b,a,b-10);p.curveTo(a*.6,b-4,-3,54,-2,56);c.drawPath(p,fill=1,stroke=0)
    c.restoreState()

# A bright coastal sheet, with dark ink and cream paper cards.
box(0,0,W,H,'#DDF6F7')
box(0,0,W,224,CYAN)
circle(1107,67,37,GOLD)
for dx,dy in [(0,-50),(35,-35),(50,0),(35,35),(-35,-35),(-50,0),(-35,35)]:
    line(1107+dx*.84,67+dy*.84,1107+dx,67+dy,'#F3A62B',5)
palm(75,173,1.3);palm(1135,195,1.1)
text('LA RUTA DEL CHURCHILL',600,36,'Bungee',21,NAVY,'center')

for dy,col in [(5,NAVY),(0,PINK)]:
    c.saveState()
    t=c.beginText();t.setTextOrigin(600-pdfmetrics.stringWidth('LAS PLAYITAS','Bungee',66)/2,H-115-dy)
    t.setFont('Bungee',66);t.setFillColor(HexColor(col));t.setStrokeColor(HexColor(NAVY));t.setTextRenderMode(2)
    c.setLineWidth(2.5);t.textOut('LAS PLAYITAS');c.drawText(t)
    c.restoreState()
box(286,135,628,47,GOLD,20,NAVY,2)
text('TRES VERSIONES, UN MISMO BARRIO',600,167,'Bungee',20,NAVY,'center')
text('De la primera cancha al diseño que hoy podés recorrer.',600,211,'Body',21,NAVY,'center')

cards=[
    ('01','EL PRIMER TRAZO','El comienzo', '01-primer-trazo.webp',
     'Una cancha sencilla junto al mar, con césped, gente y un borde escalonado de esquinas cuadradas.',
     'La imagen original que compartiste.',GOLD),
    ('02','MÁS DETALLE','La versión anterior','02-version-intermedia.png',
     'La gradería azul y blanca y las torres de luz le dieron otra presencia. Las líneas todavía cruzaban la plaza en diagonal.',
     'Recuperada del historial del juego.',TEAL),
    ('03','ASÍ SE VE HOY','Cada espacio en su lugar','03-version-actual.png',
     'Cancha de fútbol y multiuso separadas, graderías junto al mar y un parque al costado. Las Playitas sigue tomando forma.',
     'Captura de la versión actual.',PINK),
]
for idx,(num,kicker,title,img,desc,source,color) in enumerate(cards):
    x=35+idx*382
    box(x+4,246,366,424,'#AEDBDD',18)
    box(x,240,366,424,CREAM,18,NAVY,2)
    box(x,240,366,57,color,17)
    box(x,269,366,28,color)
    circle(x+30,269,19,NAVY)
    text(num,x+30,276,'Bold',18,'#FFFFFF','center')
    text(kicker,x+60,275,'Bungee',17,'#FFFFFF' if idx else NAVY)
    image_cover(IMG/img,x+12,310,342,214)
    text(title,x+18,557,'Bold',22,NAVY)
    wrap(desc,x+18,586,328,17,23)

text('Tres etapas reales del juego. La primera conserva su interfaz original; los encuadres varían.',600,690,'Body',13,'#416575','center')

# The brochure's live QR is vector art, with a clickable URL beside it.
box(0,711,W,129,NAVY)
text('¡VENÍ A RECORRERLA!',38,755,'Bungee',24,GOLD)
text('Entrá a Recorrer y visitá Las Playitas.',38,792,'Body',19,'#FFFFFF')
box(600,748,392,56,PINK,23)
text('churchill.jcampos.dev',796,783,'Bold',24,'#FFFFFF','center')
c.linkURL('https://churchill.jcampos.dev',(600,H-804,992,H-748),relative=1)
box(1039,723,103,103,'#FFFFFF',9)
qr=QrCodeWidget('https://churchill.jcampos.dev')
qr.barLevel='M'
b=qr.getBounds();q=Drawing(91,91,transform=[91/(b[2]-b[0]),0,0,91/(b[3]-b[1]),0,0]);q.add(qr)
renderPDF.draw(q,c,1045,H-820)
text('JUGÁ AHORA',1091,834,'Bold',10,'#FFFFFF','center')
c.showPage();c.save()
print(OUT)
