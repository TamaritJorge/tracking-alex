# -*- coding: utf-8 -*-
"""
LA TARJETA QUE SE VE AL COMPARTIR EL ENLACE
───────────────────────────────────────────

Genera marca/og.png (1200×630), que es lo que pintan WhatsApp, Telegram,
Twitter, LinkedIn, Slack e iMessage cuando alguien manda trackingalex.app.

Este fichero NO se publica: .assetsignore excluye *.py. Vive aquí para
poder rehacer la imagen el día que cambie el titular, en vez de tener un
PNG huérfano que nadie sabe de dónde salió.

    python marca/og.py

── POR QUÉ FONDO CLARO ──
La pastilla del logo ya es morada. Sobre un fondo morado desaparecería,
así que la tarjeta repite el tratamiento de la portada del landing: papel
claro, la pastilla con su sombra y el titular en tinta. De paso, en el
WhatsApp en modo oscuro —que es la mayoría— una tarjeta clara destaca.

── POR QUÉ SE PEGA EL ICONO Y NO SE REDIBUJA ──
marca/icono-512.png ya es la pastilla con su degradado. Reconstruir los
trazos aquí sería una segunda versión del logo, que se desincroniza con
la primera el día que cambie.
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)

ANCHO, ALTO = 1200, 630

# De marca.css. Si allí cambian, aquí también.
M700   = (0x6d, 0x28, 0xd9)
M400   = (0xa7, 0x8b, 0xfa)
TINTA  = (0x1a, 0x10, 0x24)
TINTA2 = (0x5f, 0x58, 0x70)
PAPEL  = (0xff, 0xff, 0xff)
PAPEL2 = (0xf6, 0xf1, 0xfd)

# El texto, todo junto para no ir buscándolo por el fichero
MARCA    = 'Tracking Álex'
TITULO   = ['El día a día de tu bebé,', 'apuntado en dos toques']
SUBTIULO = 'Pañales · Peso y percentiles de la OMS · Comida · Medicinas'
DOMINIO  = 'trackingalex.app'


def fuente(candidatas, tam):
    """La primera que exista. Si no hay ninguna, se para.

    Pillow, si no encuentra el fichero, puede caer a su fuente de mapa de
    bits de 11 px: la imagen saldría igualmente, ilegible, y nadie se
    enteraría hasta verla en WhatsApp. Mejor fallar aquí.
    """
    for nombre in candidatas:
        ruta = os.path.join(r'C:\Windows\Fonts', nombre)
        if os.path.exists(ruta):
            return ImageFont.truetype(ruta, tam)
        if os.path.exists(nombre):
            return ImageFont.truetype(nombre, tam)
    raise SystemExit(
        'No encuentro ninguna de estas fuentes: %s\n'
        'Instala una o añade la tuya a la lista.' % ', '.join(candidatas))


NEGRITA = ['segoeuib.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf']
NORMAL  = ['segoeui.ttf',  'arial.ttf',   'DejaVuSans.ttf']


def fondo():
    """Papel con un degradado vertical casi imperceptible y la cinta de marca."""
    img = Image.new('RGBA', (ANCHO, ALTO), PAPEL + (255,))
    d = ImageDraw.Draw(img)

    for y in range(ALTO):
        k = y / (ALTO - 1)
        d.line([(0, y), (ANCHO, y)],
               fill=tuple(round(a + (b - a) * k) for a, b in zip(PAPEL, PAPEL2)))

    # Cinta superior con el degradado de la marca
    for x in range(ANCHO):
        k = x / (ANCHO - 1)
        d.line([(x, 0), (x, 9)],
               fill=tuple(round(a + (b - a) * k) for a, b in zip(M700, M400)))

    return img


def pegar_logo(img, tam, centro_x, arriba_y):
    """La pastilla con la misma sombra morada que lleva en la portada.

    `img` tiene que ser RGBA: la sombra se compone con alpha_composite
    sobre la imagen entera, y hacerlo a trozos deja el borde del recorte
    marcado a la vista.
    """
    logo = Image.open(os.path.join(AQUI, 'icono-512.png')).convert('RGBA')
    logo = logo.resize((tam, tam), Image.LANCZOS)
    x, y = centro_x - tam // 2, arriba_y

    # La sombra es la silueta del propio logo, desenfocada y desplazada:
    # así respeta las esquinas redondeadas sin tener que saber su radio.
    sombra = Image.new('RGBA', img.size, (0, 0, 0, 0))
    sombra.paste(Image.new('RGBA', logo.size, M700 + (80,)),
                 (x, y + 16), logo.split()[3])
    sombra = sombra.filter(ImageFilter.GaussianBlur(20))

    img.alpha_composite(sombra)
    img.alpha_composite(logo, (x, y))


def main():
    img = fondo()
    d = ImageDraw.Draw(img)

    f_marca = fuente(NEGRITA, 46)
    f_tit   = fuente(NEGRITA, 62)
    f_sub   = fuente(NORMAL,  30)
    f_dom   = fuente(NEGRITA, 29)

    # ── Fila del logo y el nombre, centrada como una sola pieza ──
    LOGO = 104
    ancho_marca = d.textlength(MARCA, font=f_marca)
    HUECO = 24
    total = LOGO + HUECO + ancho_marca
    x0 = (ANCHO - total) / 2
    y0 = 78

    pegar_logo(img, LOGO, int(x0 + LOGO / 2), y0)
    d = ImageDraw.Draw(img)   # el pegado ha cambiado la imagen
    d.text((x0 + LOGO + HUECO, y0 + LOGO / 2), MARCA,
           font=f_marca, fill=TINTA, anchor='lm')

    # ── Titular ──
    y = 258
    for linea in TITULO:
        d.text((ANCHO / 2, y), linea, font=f_tit, fill=TINTA, anchor='mm')
        y += 76

    # ── Lo que hace, y el dominio ──
    d.text((ANCHO / 2, 438), SUBTIULO, font=f_sub, fill=TINTA2, anchor='mm')
    d.text((ANCHO / 2, 536), DOMINIO,  font=f_dom, fill=M700,   anchor='mm')

    salida = os.path.join(AQUI, 'og.png')
    img.convert('RGB').save(salida, 'PNG', optimize=True)

    kb = os.path.getsize(salida) / 1024
    print('%s · %d×%d · %.0f KB' % (salida, img.width, img.height, kb))

    # Algunos clientes se saltan las imágenes grandes y la tarjeta vuelve
    # a quedarse vacía, que es justo lo que se venía a arreglar.
    if kb > 300:
        print('⚠️  Pesa más de 300 KB. Conviene bajarla.')


if __name__ == '__main__':
    main()
