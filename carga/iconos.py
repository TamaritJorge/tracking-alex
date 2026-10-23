# -*- coding: utf-8 -*-
"""
EL ICONO DE CARGA UJI
─────────────────────

    python carga/iconos.py

── POR QUÉ NO REUTILIZA EL DE TRACKING ÁLEX ──
Son dos aplicaciones instalables distintas en el mismo dominio, y acaban una
al lado de la otra en la pantalla de inicio del mismo móvil. Con el mismo
icono y nombres parecidos, elegir entre ellas sería adivinar: es exactamente
el problema que la separación en dos PWA venía a evitar. Icono propio,
colores propios, y de un vistazo se sabe cuál es cuál.

── POR QUÉ SE DIBUJA AQUÍ EN VEZ DE EXPORTAR UN SVG ──
No hay rasterizador de SVG en la cadena de montaje —el de la marca tampoco
lo usa, parte de un PNG ya dibujado— y un rayo son siete puntos. Dibujarlo
con PIL evita añadir una dependencia para esto.

── EL MASKABLE ──
Android recorta el icono a la forma que le dé la gana (círculo, cuadrado
redondeado, gota). La zona segura es el círculo central del 80 %, así que en
esa versión el rayo va más pequeño y el fondo llega hasta el borde. Sin
versión maskable, Android mete el icono entero dentro de un círculo blanco y
queda una pegatina con marco.
"""
import os
from PIL import Image, ImageDraw

AQUI = os.path.dirname(os.path.abspath(__file__))

FONDO = (15, 23, 42)       # --bg del tema oscuro, el mismo theme_color
RAYO  = (250, 204, 21)     # amarillo de «hay corriente»

# El rayo, en coordenadas de 0 a 1 sobre su propia caja. Siete puntos: el
# clásico de los símbolos eléctricos, sin filigranas que a 48 px se pierden.
TRAZO = [(0.62, 0.00), (0.14, 0.56), (0.44, 0.56),
         (0.34, 1.00), (0.86, 0.40), (0.54, 0.40), (0.62, 0.00)]


def dibujar(tam, proporcion, redondeo):
    """proporcion = cuánto del lienzo ocupa el rayo de alto."""
    # Se dibuja al cuádruple y se reduce: PIL no tiene antialiasing en
    # polygon(), así que sin esto los bordes del rayo salen dentados.
    e = 4
    im = Image.new('RGBA', (tam * e, tam * e), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    if redondeo:
        d.rounded_rectangle([0, 0, tam * e - 1, tam * e - 1],
                            radius=int(tam * e * 0.22), fill=FONDO)
    else:
        d.rectangle([0, 0, tam * e, tam * e], fill=FONDO)

    alto  = tam * e * proporcion
    ancho = alto * 0.72
    x0 = (tam * e - ancho) / 2
    y0 = (tam * e - alto) / 2
    d.polygon([(x0 + px * ancho, y0 + py * alto) for px, py in TRAZO], fill=RAYO)

    return im.resize((tam, tam), Image.LANCZOS)


def guardar(im, nombre):
    ruta = os.path.join(AQUI, nombre)
    im.save(ruta, 'PNG', optimize=True)
    print('%s · %dx%d · %.1f KB'
          % (ruta, im.size[0], im.size[1], os.path.getsize(ruta) / 1024))


def main():
    guardar(dibujar(192, 0.56, True),  'icono-192.png')
    guardar(dibujar(512, 0.56, True),  'icono-512.png')
    # Sin esquinas redondeadas y con el rayo dentro del círculo seguro:
    # las esquinas las pone Android, no nosotros.
    guardar(dibujar(512, 0.44, False), 'icono-maskable-512.png')


if __name__ == '__main__':
    main()
