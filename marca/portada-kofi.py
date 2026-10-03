# -*- coding: utf-8 -*-
"""
LA PORTADA DE LA PÁGINA DE KO-FI
────────────────────────────────

Genera marca/portada-kofi.png (1200×400), que es la medida que pide Ko-fi:
proporción 3:1, por debajo de 8 MB, PNG o JPEG.

    python marca/portada-kofi.py

── POR QUÉ TODO VA CENTRADO ──
Ko-fi recorta la portada por los lados en el móvil, y encima coloca el avatar
pegado abajo a la izquierda. Centrado, el texto sobrevive a las dos cosas; si
estuviera a un lado, en el móvil se perdería la mitad.

── POR QUÉ NO PONE «TRACKING ÁLEX» ──
Justo debajo de la portada, Ko-fi ya escribe el nombre de la página y enseña
el logo como avatar. Repetirlo aquí sería decir dos veces lo mismo en diez
centímetros, así que la portada aporta lo que falta: qué es esto.

── EL TRAZO DEL FONDO ──
Es el mismo de logo-mono.svg, redibujado a mano porque son dos líneas y no
compensa arrastrar un rasterizador de SVG sólo para esto. Va en blanco casi
transparente y se sale del borde a propósito: es textura, no un segundo logo
compitiendo con el avatar.
"""
import os
from PIL import Image, ImageDraw, ImageFont

AQUI = os.path.dirname(os.path.abspath(__file__))

ANCHO, ALTO = 1200, 400

# De marca.css. Si allí cambian, aquí también.
M700 = (0x6d, 0x28, 0xd9)
M400 = (0xa7, 0x8b, 0xfa)

TITULO  = ['El d\u00eda a d\u00eda de tu beb\u00e9,', 'apuntado en dos toques']
PIE     = 'trackingalex.app  \u00b7  gratis, sin publicidad y sin vender datos'

NEGRITA = ['segoeuib.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf']
NORMAL  = ['segoeui.ttf',  'arial.ttf',   'DejaVuSans.ttf']


def fuente(candidatas, tam):
    """La primera que exista. Si no hay ninguna, se para.

    Pillow, si no encuentra el fichero, cae a su fuente de mapa de bits de
    11 px: la imagen saldría igualmente, ilegible, y nadie se enteraría
    hasta verla publicada. Mejor fallar aquí."""
    for nombre in candidatas:
        ruta = os.path.join(r'C:\Windows\Fonts', nombre)
        if os.path.exists(ruta):
            return ImageFont.truetype(ruta, tam)
        if os.path.exists(nombre):
            return ImageFont.truetype(nombre, tam)
    raise SystemExit('No encuentro ninguna de estas fuentes: %s'
                     % ', '.join(candidatas))


def fondo():
    """El degradado de la marca, en diagonal como el de la pastilla."""
    img = Image.new('RGB', (ANCHO, ALTO))
    px = img.load()
    for y in range(ALTO):
        for x in range(0, ANCHO, 4):          # de 4 en 4: a esta escala no se nota
            k = (x / ANCHO + y / ALTO) / 2
            c = tuple(round(a + (b - a) * k) for a, b in zip(M700, M400))
            for i in range(4):
                if x + i < ANCHO:
                    px[x + i, y] = c
    return img


def trazo(img):
    """El chevron del logo, gigante, blanco casi transparente y saliéndose."""
    capa = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(capa)

    # Las coordenadas son las de logo-mono.svg sobre un lienzo de 100,
    # escaladas y desplazadas.
    #
    # La marca entra entera por arriba —incluida la tilde, que es lo que la
    # hace reconocible— y se sale por abajo y por la derecha. Antes sólo
    # asomaba la punta de una pata y no parecía un logo, parecía una raya.
    E, DX, DY = 5.5, 815, -22
    p = lambda x, y: (DX + x * E, DY + y * E)
    TINTA = (255, 255, 255, 34)

    d.line([p(20, 86), p(50, 36), p(80, 86)], fill=TINTA,
           width=int(13 * E), joint='curve')
    d.line([p(41, 21), p(64, 8)], fill=TINTA, width=int(8.5 * E))

    return Image.alpha_composite(img.convert('RGBA'), capa).convert('RGB')


def main():
    img = trazo(fondo())
    d = ImageDraw.Draw(img)

    f_tit = fuente(NEGRITA, 54)
    f_pie = fuente(NORMAL,  24)

    y = 158
    for linea in TITULO:
        d.text((ANCHO / 2, y), linea, font=f_tit, fill=(255, 255, 255), anchor='mm')
        y += 68

    d.text((ANCHO / 2, 296), PIE, font=f_pie, fill=(237, 228, 252), anchor='mm')

    salida = os.path.join(AQUI, 'portada-kofi.png')
    img.save(salida, 'PNG', optimize=True)
    print('%s \u00b7 %d\u00d7%d \u00b7 %.0f KB'
          % (salida, img.width, img.height, os.path.getsize(salida) / 1024))


if __name__ == '__main__':
    main()
