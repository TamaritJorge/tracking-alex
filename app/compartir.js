/* ═════════════════════════════════════════════════════════════
   CAPTURAS COMPARTIBLES

   Sustituyen al antiguo enlace `?modo=ver` de la matrona, que
   funcionaba porque toda la base de datos era de lectura pública
   — justo lo que había que cerrar al pasar a varias familias.

   La imagen lleva pie con el nombre del bebé, su edad y la fecha:
   sin eso, una gráfica suelta en el móvil de la pediatra no dice
   de quién es ni de cuándo.
   ═════════════════════════════════════════════════════════════ */

const ALTO_PIE = 64;

/* Botón de compartir en cada tarjeta marcada con data-captura */
function ponerBotonesCompartir() {
  document.querySelectorAll('[data-captura]').forEach(card => {
    if (card.querySelector('.btn-compartir')) return;   // ya lo tiene

    const b = document.createElement('button');
    b.className = 'btn-compartir';
    b.type = 'button';
    b.title = 'Compartir como imagen';
    b.setAttribute('aria-label', 'Compartir ' + card.dataset.captura + ' como imagen');
    b.textContent = '📤';
    b.addEventListener('click', () => compartirTarjeta(card));

    card.style.position = 'relative';
    card.appendChild(b);
  });
}

async function compartirTarjeta(card) {
  const btn = card.querySelector('.btn-compartir');
  const textoOriginal = btn.textContent;
  btn.textContent = '⏳';
  btn.disabled = true;

  try {
    const lienzo = await dibujarTarjeta(card);
    const blob   = await new Promise(res => lienzo.toBlob(res, 'image/png'));
    const nombre = nombreFichero(card.dataset.captura);

    const fichero = new File([blob], nombre, { type: 'image/png' });

    // En el móvil interesa el menú de compartir del sistema, para mandarla
    // por WhatsApp sin pasar por la galería. En un escritorio ese menú es
    // un estorbo: Windows lo soporta, así que preguntar sólo por
    // navigator.canShare abría el panel de apps en vez de descargar.
    if (esDispositivoTactil() && navigator.canShare && navigator.canShare({ files: [fichero] })) {
      await navigator.share({ files: [fichero], title: card.dataset.captura });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nombre;
      a.click();
      URL.revokeObjectURL(url);
      toast('📤 Imagen descargada');
    }
  } catch (e) {
    // AbortError = el usuario cerró el diálogo de compartir. No es un fallo.
    if (e && e.name === 'AbortError') return;
    console.error(e);
    toast('❌ No se pudo generar la imagen: ' + (e.message || ''), 4000);
  } finally {
    btn.textContent = textoOriginal;
    btn.disabled = false;
  }
}

/* Renderiza la tarjeta y le añade el pie con los datos del bebé */
async function dibujarTarjeta(card) {
  const oscuro = esDark();
  const fondo  = oscuro ? '#1e293b' : '#ffffff';
  const tenue  = oscuro ? '#94a3b8' : '#64748b';
  const fuerte = oscuro ? '#f1f5f9' : '#0f172a';

  // El propio botón no debe salir en la foto
  const btn = card.querySelector('.btn-compartir');
  if (btn) btn.style.visibility = 'hidden';

  // html2canvas no copia con fiabilidad el contenido de un <canvas>:
  // según el navegador y la aceleración por GPU, sale en blanco. En vez
  // de pelearse con eso, se cambia cada gráfica por un <img> generado
  // con toBase64Image(), que es de Chart.js y siempre funciona.
  const sustituidos = [];
  for (const cv of card.querySelectorAll('canvas')) {
    const chart = (typeof Chart !== 'undefined' && Chart.getChart) ? Chart.getChart(cv) : null;
    if (!chart) continue;

    const img = document.createElement('img');
    img.src = chart.toBase64Image();
    img.style.width  = cv.clientWidth  + 'px';
    img.style.height = cv.clientHeight + 'px';
    img.style.display = 'block';

    cv.style.display = 'none';
    cv.parentNode.insertBefore(img, cv);
    sustituidos.push({ cv, img });

    // Imprescindible esperar a que decodifique: asignar src es asíncrono
    // y, sin esto, html2canvas fotografía una imagen todavía vacía.
    //
    // Con límite de tiempo: si la imagen ya falló antes de llegar aquí,
    // ni decode() resuelve ni onerror vuelve a dispararse, y la captura
    // se quedaba colgada para siempre.
    await esperarImagen(img, 3000);
  }

  let base;
  try {
    base = await html2canvas(card, {
      backgroundColor: fondo,
      scale: Math.min(window.devicePixelRatio || 1, 2),   // nítida sin ser enorme
      logging: false,
      useCORS: true
    });
  } finally {
    // Devolver la tarjeta a como estaba, pase lo que pase
    sustituidos.forEach(({ cv, img }) => { img.remove(); cv.style.display = ''; });
    if (btn) btn.style.visibility = '';
  }

  const escala = base.width / card.offsetWidth;
  const pie    = ALTO_PIE * escala;

  const salida = document.createElement('canvas');
  salida.width  = base.width;
  salida.height = base.height + pie;
  const ctx = salida.getContext('2d');

  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, salida.width, salida.height);
  ctx.drawImage(base, 0, 0);

  // Línea de separación
  ctx.strokeStyle = oscuro ? 'rgba(148,163,184,.25)' : 'rgba(100,116,139,.2)';
  ctx.lineWidth = Math.max(1, escala);
  ctx.beginPath();
  ctx.moveTo(16 * escala, base.height + 1);
  ctx.lineTo(salida.width - 16 * escala, base.height + 1);
  ctx.stroke();

  const fuente = '-apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = fuerte;
  ctx.font = '600 ' + (15 * escala) + 'px ' + fuente;
  ctx.fillText(nombreHijo() + ' · ' + edadEnTexto(), 16 * escala, base.height + pie * 0.38);

  ctx.fillStyle = tenue;
  ctx.font = (12 * escala) + 'px ' + fuente;
  ctx.fillText(new Date().toLocaleDateString(localeActivo(), {
    day: 'numeric', month: 'long', year: 'numeric'
  }) + ' · Tracking Alex', 16 * escala, base.height + pie * 0.72);

  return salida;
}

/* Edad en un formato legible para la consulta */
function edadEnTexto() {
  const dias = Math.floor(edadEnDias(new Date()));

  // Todavía no ha nacido: la fecha prevista es una fecha válida y
  // «-12 días» no es una edad.
  if (dias < 0) {
    const faltan = -dias;
    return 'nace en ' + faltan + (faltan === 1 ? ' día' : ' días');
  }

  if (dias < 31)  return dias + (dias === 1 ? ' día' : ' días');
  if (dias < 365) {
    const m = Math.floor(dias / 30.4375);
    const d = Math.floor(dias - m * 30.4375);
    return m + (m === 1 ? ' mes' : ' meses') + (d ? ' y ' + d + ' d' : '');
  }
  const a = Math.floor(dias / 365.25);
  const m = Math.floor((dias - a * 365.25) / 30.4375);
  return a + (a === 1 ? ' año' : ' años') + (m ? ' y ' + m + ' m' : '');
}

function nombreFichero(titulo) {
  const limpio = (nombreHijo() + '-' + titulo)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return limpio + '-' + new Date().toISOString().slice(0, 10) + '.png';
}

/* Espera a que una imagen esté lista para pintarse, sin quedarse colgada.
   Se da por buena si ya tiene dimensiones (complete + naturalWidth), y en
   cualquier caso se rinde pasado el límite: más vale una captura sin la
   gráfica que un botón girando eternamente. */
function esperarImagen(img, limiteMs) {
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
  return Promise.race([
    img.decode().catch(() => {}),
    new Promise(r => { img.onload = img.onerror = r; }),
    new Promise(r => setTimeout(r, limiteMs))
  ]);
}

/* ¿Móvil o tableta?

   Se mira el tipo de puntero, no el ancho de la ventana ni la cadena de
   usuario: un portátil con pantalla táctil sigue teniendo ratón, y una
   ventana estrecha en el escritorio no es un teléfono. `pointer: coarse`
   sin `pointer: fine` identifica un aparato en el que el dedo es el
   único puntero, que es justo donde el menú de compartir aporta algo. */
function esDispositivoTactil() {
  if (!window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches
      && !window.matchMedia('(pointer: fine)').matches;
}
