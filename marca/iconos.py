# -*- coding: utf-8 -*-
"""
LOS ICONOS QUE NO SON SVG
─────────────────────────

Genera favicon.ico y los PNG pequeños a partir de marca/icono-512.png, que
es la pastilla de la marca ya dibujada.

    python marca/iconos.py

── POR QUÉ HACEN FALTA SI YA HAY UN favicon.svg ──
Google Search NO acepta SVG como favicon. Su lista de formatos admitidos es
BMP, GIF, ICO, PNG, JPEG, PPM y TIFF, y nada más. Una web que sólo declara
`<link rel="icon" type="image/svg+xml">` sale en los resultados con el globo
terráqueo genérico, que es justo lo que parece una web sospechosa.

El SVG se queda: los navegadores modernos lo prefieren y escala sin pesar
nada. Lo que se añade es el respaldo que entiende todo lo demás.

── POR QUÉ SE PARTE DEL PNG Y NO DEL SVG ──
No hay rasterizador de SVG en la cadena de montaje, y tampoco hace falta:
icono-512.png es exactamente el mismo dibujo. Partir de él garantiza además
que el icono de la pestaña y el de la pantalla de inicio son el mismo, en
vez de dos versiones que se separan con el tiempo.
"""
import os
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)

ORIGEN = os.path.join(AQUI, 'icono-512.png')

# Google recomienda pasar de 48x48. El .ico lleva los tres tamaños que de
# verdad usa un navegador; los PNG sueltos son para que el rastreador pueda
# elegir uno grande.
TAM_ICO = [16, 32, 48]
TAM_PNG = [96]


def main():
    base = Image.open(ORIGEN).convert('RGBA')
    if base.size != (512, 512):
        raise SystemExit('Esperaba 512x512 y he encontrado %dx%d' % base.size)

    # El .ico, en la raíz: es donde lo busca todo lo que no lee el <head>.
    ico = os.path.join(RAIZ, 'favicon.ico')
    base.save(ico, format='ICO', sizes=[(t, t) for t in TAM_ICO])
    print('%s · %s · %.1f KB'
          % (ico, 'x'.join(str(t) for t in TAM_ICO), os.path.getsize(ico) / 1024))

    for t in TAM_PNG:
        salida = os.path.join(AQUI, 'icono-%d.png' % t)
        base.resize((t, t), Image.LANCZOS).save(salida, 'PNG', optimize=True)
        print('%s · %dx%d · %.1f KB' % (salida, t, t, os.path.getsize(salida) / 1024))


if __name__ == '__main__':
    main()
