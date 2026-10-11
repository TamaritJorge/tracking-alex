/* ═════════════════════════════════════════════════════════════
   Las tres gráficas (peso con percentiles, pañales y extracciones).
   ═════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   GRÁFICAS
   ───────────────────────────────────────────────────────────── */
function coloresEjes() {
  return esDark()
    ? { grid: 'rgba(255,255,255,0.08)', tick: '#94a3b8' }
    : { grid: 'rgba(0,0,0,0.07)',       tick: '#64748b' };
}

function rangoFechas() {
  // Mismo rango en las tres gráficas → se comparan de un vistazo.
  // Sólo cuentan los tipos de módulos encendidos: si no, dejar de usar
  // el sacaleches seguiría estirando el eje X de las demás gráficas
  // hasta la última extracción, con semanas de hueco vacío.
  const visibles = registros.filter(r => tipoVisible(r.tipo));
  if (!visibles.length) {
    const hoy = new Date();
    return { min: new Date(hoy - 7 * 864e5), max: new Date(hoy.getTime() + 864e5) };
  }
  const ts  = visibles.map(r => +new Date(r.fecha_hora));
  const min = new Date(Math.min(...ts));
  const max = new Date(Math.max(...ts));
  // Margen de medio día a cada lado
  min.setHours(min.getHours() - 12);
  max.setHours(max.getHours() + 12);
  return { min, max };
}

function renderCharts() {
  const c   = coloresEjes();
  const rng = rangoFechas();

  const ext   = registros.filter(r => r.tipo === 'extraccion');
  const pesos = registros.filter(r => r.tipo === 'peso');
  const cacas = registros.filter(r => r.tipo === 'caca');
  const pipis = registros.filter(r => r.tipo === 'pipi');

  const dIzq  = ext.filter(r => r.datos.pecho === 'izquierdo')
                   .map(r => ({ x: r.fecha_hora, y: r.datos.ml }));
  const dDer  = ext.filter(r => r.datos.pecho === 'derecho')
                   .map(r => ({ x: r.fecha_hora, y: r.datos.ml }));
  const dPeso = pesos.map(r => ({ x: r.fecha_hora, y: r.datos.gramos }));

  // Eje X idéntico en las tres gráficas
  const ejeX = () => ({
    type: 'time',
    min:  rng.min,
    max:  rng.max,
    time: {
      unit: 'day',
      tooltipFormat: 'dd/MM HH:mm',
      displayFormats: { day: 'dd/MM', hour: 'HH:mm' }
    },
    grid:  { color: c.grid },
    ticks: { color: c.tick, maxTicksLimit: 7 }
  });

  const ejeY = (titulo, extra = {}) => Object.assign({
    grid:  { color: c.grid },
    ticks: { color: c.tick },
    title: { display: true, text: titulo, color: c.tick }
  }, extra);

  // Tooltip por defecto: valor + unidad del dataset
  const pluginsCfg = {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}${ctx.dataset.unidad || ''}`
      }
    }
  };

  const base = { responsive: true, maintainAspectRatio: false };

  /* ── Extracciones ── */
  // Los módulos apagados no se dibujan: un canvas dentro de un
  // display:none mide cero y saldría una gráfica rota al reactivarlo.
  if (charts.ext) { charts.ext.destroy(); delete charts.ext; }
  if (moduloActivo('extraccion')) charts.ext = new Chart(document.getElementById('chartExt'), {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Izquierdo',
          data: dIzq,
          backgroundColor: '#2563eb',
          borderColor:     '#2563eb',
          pointStyle: 'circle',      // ● círculo → distinguible en B&N
          pointRadius: 7, pointHoverRadius: 9,
          showLine: true,
          borderDash: [],            // línea continua
          tension: 0.3,
          unidad: ' ml'
        },
        {
          label: 'Derecho',
          data: dDer,
          backgroundColor: '#dc2626',
          borderColor:     '#dc2626',
          pointStyle: 'triangle',    // ▲ triángulo → distinguible en B&N
          pointRadius: 8, pointHoverRadius: 10,
          showLine: true,
          borderDash: [5, 3],        // línea discontinua
          tension: 0.3,
          unidad: ' ml'
        }
      ]
    },
    options: Object.assign({}, base, {
      plugins: pluginsCfg,
      scales: { x: ejeX(), y: ejeY('ml', { beginAtZero: true }) }
    })
  });

  /* ── Peso ── */
  // Además de las pesadas se dibuja una recta discontinua con la
  // tendencia real. Antes había una segunda con el mínimo de 20 g/día,
  // y se ha quitado: ese suelo sólo vale para el primer mes, así que
  // dibujarlo hasta el año convertía una referencia de recién nacido en
  // una línea que un bebé sano «no alcanza» durante meses. Ahora es un
  // aviso que sale sólo cuando toca, justo debajo.
  const tend = ajustePeso();

  let ejeXPeso = ejeX();
  const tFinPeso = tend
    ? tend.ultimo.t + DIAS_PROYECCION * 864e5
    : +rng.max;

  // ── Curvas de percentiles de la OMS ──
  // Van las primeras del array para que queden DEBAJO de los datos.
  // Se dibujan sólo en el tramo de fechas visible, así que no estiran
  // el eje: el foco sigue estando en las edades que tenemos medidas.
  const dsPeso = [];
  const curva = pct => {
    const z = Z_PERCENTIL[pct], pts = [];
    const t0 = +rng.min, t1 = tFinPeso, pasos = 80;
    for (let i = 0; i <= pasos; i++) {
      const t   = t0 + (t1 - t0) * i / pasos;
      const lms = lmsEn(edadEnDias(t));
      if (lms) pts.push({ x: new Date(t).toISOString(), y: Math.round(pesoDeZ(lms, z) * 1000) });
    }
    return pts;
  };

  const hayCurvas = moduloActivo('peso')
    && (lmsEn(edadEnDias(+rng.min)) || lmsEn(edadEnDias(tFinPeso)));

  if (hayCurvas) {
    // Líneas finas sin relleno, al estilo de la cartilla pediátrica.
    // Se probó con bandas sombreadas y obligaban al eje Y a llegar
    // hasta el P97, lo que aplastaba la curva del bebé.
    const linea = esDark() ? 'rgba(148,163,184,.42)' : 'rgba(100,116,139,.35)';

    const basePct = {
      pointRadius: 0, pointHoverRadius: 0,
      borderColor: linea,
      backgroundColor: 'transparent',
      borderWidth: 1,
      showLine: true,
      tension: 0.3,
      fill: false,
      esPercentil: true          // para excluirlas del tooltip y etiquetarlas
    };

    [3, 15, 85, 97].forEach(p => {
      dsPeso.push(Object.assign({}, basePct, { label: 'P' + p, data: curva(p) }));
    });

    // La mediana, algo más marcada
    dsPeso.push(Object.assign({}, basePct, {
      label: 'P50',
      data: curva(50),
      borderColor: esDark() ? 'rgba(148,163,184,.7)' : 'rgba(100,116,139,.55)',
      borderDash: [2, 3],
      borderWidth: 1.5
    }));
  }

  dsPeso.push({
    label: 'Peso',
    data: dPeso,
    backgroundColor: '#059669',
    borderColor:     '#059669',
    pointStyle: 'rect',          // ■ cuadrado → distinguible en B&N
    pointRadius: 7, pointHoverRadius: 9,
    showLine: true,
    tension: 0.3,
    unidad: ' g'
  });

  if (tend) {
    const tFin = tFinPeso;

    /* La tendencia ya no es una recta de dos puntos, sino la curva de
       la OMS ajustada a sus pesadas — con la misma forma que las líneas
       grises del fondo, porque es una de ellas, la suya.

       Hay que muestrearla: una recta se dibuja con dos puntos y una
       curva no. 60 tramos sobran para que se vea lisa y no son nada de
       trabajo al lado de los 81 de cada percentil.

       Se prolonga los mismos 7 días que antes. A ese plazo la curva y
       la recta difieren 11 g, así que no estira el eje Y; a 60 días
       diferirían 674 g, que es justo la razón de haber cambiado. */
    const pasos = 60;
    const datos = [];
    for (let i = 0; i <= pasos; i++) {
      const tms = tend.t0 + (tFin - tend.t0) * i / pasos;
      const y   = tend.curva(edadEnDias(tms));
      if (y !== null) datos.push({ x: new Date(tms).toISOString(), y: Math.round(y) });
    }

    dsPeso.push({
      label: 'Tendencia',
      data: datos,
      borderColor: '#059669',
      backgroundColor: 'transparent',
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 0, pointHoverRadius: 0,
      showLine: true,
      tension: 0,              // la curvatura la pone el modelo, no Bézier
      unidad: ' g (estimado)'
    });

    // Sólo esta gráfica alarga el eje X: si lo hicieran las tres,
    // las otras dos quedarían con una semana de hueco vacío.
    ejeXPeso = Object.assign(ejeX(), { max: new Date(tFin) });
  }

  // El eje Y lo mandan los datos del bebé, NO las curvas de la OMS.
  // Si se dejara autoescalar, el P97 (5,5 kg) estiraría la escala y su
  // curva quedaría aplastada abajo. Las curvas simplemente se recortan.
  let rangoY = {};
  const ysReales = dsPeso
    .filter(d => !d.esPercentil)
    .flatMap(d => d.data.map(p => p.y))
    .filter(y => isFinite(y));

  if (ysReales.length) {
    const yMin = Math.min(...ysReales), yMax = Math.max(...ysReales);
    const margen = Math.max((yMax - yMin) * 0.35, 350);
    // Redondeado a 100 g para que las marcas del eje salgan limpias
    rangoY = {
      min: Math.max(0, Math.floor((yMin - margen) / 100) * 100),
      max: Math.ceil((yMax + margen) / 100) * 100
    };
  }

  // Etiqueta de cada percentil al final de su línea, como en la cartilla
  const etiquetasPercentil = {
    id: 'etiquetasPercentil',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.font = '600 10px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = esDark() ? 'rgba(148,163,184,.85)' : 'rgba(100,116,139,.8)';
      ctx.textBaseline = 'middle';
      chart.data.datasets.forEach((ds, i) => {
        if (!ds.esPercentil) return;
        const pts = chart.getDatasetMeta(i).data;
        if (!pts.length) return;
        const p = pts[pts.length - 1];
        // sólo si la línea acaba dentro del área visible
        if (p.y < chartArea.top + 5 || p.y > chartArea.bottom - 5) return;
        ctx.fillText(ds.label, Math.min(p.x + 3, chartArea.right - 22), p.y);
      });
      ctx.restore();
    }
  };

  if (charts.peso) { charts.peso.destroy(); delete charts.peso; }
  if (moduloActivo('peso')) charts.peso = new Chart(document.getElementById('chartPeso'), {
    type: 'scatter',
    data: { datasets: dsPeso },
    options: Object.assign({}, base, {
      plugins: {
        legend: { display: false },
        tooltip: {
          // Las curvas de percentiles no salen en el tooltip: si no,
          // cada toque mostraría cinco líneas de ruido.
          filter: item => !item.dataset.esPercentil,
          callbacks: {
            label: ctx => {
              const txt = `${ctx.dataset.label}: ${ctx.parsed.y}${ctx.dataset.unidad || ''}`;
              if (ctx.dataset.label !== 'Peso') return txt;
              const p = percentilPeso(ctx.raw.x, ctx.parsed.y);
              return p ? [txt, `Percentil OMS: ${textoPercentil(p.pct)}`] : txt;
            }
          }
        }
      },
      scales: {
        x: ejeXPeso,
        y: ejeY('gramos', Object.assign({ beginAtZero: false }, rangoY))
      }
    }),
    plugins: [etiquetasPercentil]
  });

  /* Aviso de crecimiento que flojea.

     Antes saltaba con «menos de 20 g/día», y eso tenía dos problemas:
     los 20 g son una referencia de recién nacido —un bebé de seis meses
     gana la mitad y está perfectamente—, y sobre todo la cifra que se
     comparaba salía de siete días de datos, con un margen de ±8 g/día.
     Es decir, podía saltar por puro ruido de la báscula.

     Ahora el disparador es el que se mira de verdad: que el bebé esté
     cruzando una banda entera de percentiles (0,67 z) de forma
     sostenida, y que esa deriva sea distinguible del ruido. Con los
     datos reales de Álex, hoy no salta. */
  const avisoMes = document.getElementById('avisoPesoMes');
  if (avisoMes) {
    const zSem    = tend ? tend.k * 7 : 0;
    const semanas = tend && zSem < 0 ? Z_CAIDA_AVISO / -zSem : Infinity;
    // Flojea si, al ritmo ajustado, cruzaría una banda entera en menos
    // de ocho semanas — y si la deriva no es ruido.
    const flojo = tend && tend.derivaReal && zSem < 0 && semanas <= 8;

    avisoMes.style.display = flojo ? '' : 'none';
    if (flojo) {
      /* Con t2() y no concatenando: en inglés el número y la unidad no
         caen en el mismo sitio de la frase. */
      /* Corto, pero no tanto como las notas de abajo: esto sale sólo
         cuando hay algo que decir, y si alguien va a hablarlo con su
         pediatra tiene que poder leer por qué sin buscarlo en un
         `title` que en el móvil no aparece. Lo que se ha ido es la
         explicación de qué es una banda de percentiles. */
      avisoMes.innerHTML = t2('graf.bajandoPct',
        '⚠️ <strong>Está bajando de percentil:</strong> gana {g} g/día y para '
        + 'quedarse en su línea harían falta {n}. Muchos bebés se recolocan los '
        + 'primeros meses, así que no es por sí solo un problema — pero merece '
        + 'una frase en la próxima revisión.',
        { g: Math.round(tend.gPorDia), n: Math.round(tend.necesario) });
    }
  }

  /* ── Los primeros días ──────────────────────────────────────
     La bajada de peso del principio asusta, y la aplicación no decía
     nada de ella. Dos datos y sus dos referencias, en una línea.

     Las referencias entre paréntesis y no en una frase aparte: «bajó un
     7,9 %» a secas es un número que no se sabe leer, y explicarlo en
     dos oraciones más convertía la nota en un párrafo. El paréntesis
     hace el mismo trabajo con cuatro palabras.

     Sólo las primeras seis semanas. Después deja de ser información y
     pasa a ser una anécdota ocupando sitio. */
  const notaRN = document.getElementById('notaRecienNacido');
  if (notaRN) {
    const dia = (typeof diaDeVida === 'function') ? diaDeVida() : null;
    const pi  = (dia !== null && dia <= DIAS_RECIEN_NACIDO) ? perdidaInicial() : null;

    notaRN.style.display = pi ? '' : 'none';
    if (pi) {
      notaRN.textContent = pi.diaRecup !== null
        ? t2('graf.perdidaInicial',
            'Primeros días: bajó un {pc} % (normal hasta un 10 %) y lo recuperó '
            + 'el día {d} (normal antes del 14).',
            { pc: numero(pi.pct, 1), d: Math.round(pi.diaRecup) })
        : t2('graf.sinRecuperar',
            'Primeros días: bajó un {pc} % (normal hasta un 10 %). Todavía no ha '
            + 'vuelto al peso de nacimiento; lo normal es antes del día 14.',
            { pc: numero(pi.pct, 1) });
    }
  }

  // Texto explicativo bajo la gráfica
  /* La leyenda decía «(niños)» a fuego, fuera niño o niña, mientras la
     gráfica sí dibujaba la curva correcta. Se pinta aquí, que es donde
     se sabe de qué sexo es la curva que se acaba de trazar. */
  const leyPct = document.getElementById('leyendaPercentiles');
  if (leyPct) {
    leyPct.textContent = t2('leg.percentilesSexo', 'Percentiles OMS ({s})',
      { s: sexoHijo() === 'nina' ? t('alta.ninas', 'niñas') : t('alta.ninos', 'niños') });
  }

  /* ── La nota de debajo ──────────────────────────────────────
     Era un párrafo de tres frases explicando qué es una curva ajustada
     y que no es una predicción. Dos problemas: lo lee todo el mundo
     cada vez, aunque ya se lo sepa, y repetía los g/día que ya están
     en la casilla del panel, dos dedos más arriba.

     Ahora es una línea que dice sólo de cuántos datos sale, que es lo
     único que no se puede deducir mirando la gráfica. Lo demás —qué es
     y hasta dónde fiarse— se queda en el `title`, para quien lo busque.

     El `title` no se ve en el móvil, y está bien: lo que importa cabe
     en la línea. Si hiciera falta de verdad para entenderla, no sería
     un `title`. */
  const nota = document.getElementById('notaTendencia');
  if (nota) {
    if (!tend) {
      nota.textContent = t('graf.sinTendencia',
        'Faltan pesadas para estimar la tendencia.');
      nota.title = t('graf.sinTendenciaTit',
        'Hacen falta al menos tres pesadas repartidas en diez días o más, ya '
        + 'recuperado el peso de nacimiento. Con menos, cualquier cifra sería '
        + 'ruido de la báscula.');
    } else {
      let txt = t2('graf.tendencia', 'Ajustada a {n} pesadas de {d} días.',
        { n: tend.n, d: numero(tend.dias, 0) });

      /* El aviso del artefacto sí se queda a la vista: si el descuento
         de ropa ha cambiado, parte del movimiento es de la estimación y
         no del bebé. Pasó de verdad —de 50 a 105 g— y se comió la mitad
         de la ganancia aparente de esos días. Eso no puede vivir en un
         title que en el móvil no existe.

         El signo importa, y por eso son dos claves: descontar más en
         las últimas hace que la ganancia parezca menor, y al revés. */
      if (Math.abs(tend.ropaCambio) > 40) {
        txt += ' ' + t2(tend.ropaCambio > 0 ? 'graf.ropaMas' : 'graf.ropaMenos',
          tend.ropaCambio > 0
            ? 'Ojo: ahora se descuentan {r} g más de ropa que antes, así que gana '
              + 'algo más de lo que marca.'
            : 'Ojo: ahora se descuentan {r} g menos de ropa que antes, así que gana '
              + 'algo menos de lo que marca.',
          { r: Math.abs(Math.round(tend.ropaCambio)) });
      }

      nota.textContent = txt;
      nota.title = t('graf.tendenciaTit',
        'Es la curva de percentil de la OMS que mejor encaja con sus pesadas, '
        + 'prolongada una semana para ver hacia dónde va. No es una predicción: '
        + 'cuanto más lejos, menos vale.');
    }
  }

  /* ── Pipís y cacas en 24 h ────────────────────────────────────
     Dos líneas con la misma unidad —cuántos hubo en las 24 h
     anteriores a ese punto— y por tanto un solo eje.

     El color de cada tramo dice en qué estado se estaba durante ese
     rato: para los pipís, si el último fue transparente o no; para
     las cacas, de qué color fue la última. Así la altura cuenta el
     ritmo y el color cuenta el aviso.
     ────────────────────────────────────────────────────────────── */
  const serieP = serie24h(pipis, r => ({
    cantidad:     r.datos.cantidad,
    transparente: !!r.datos.transparente,
    nota:         r.datos.nota
  }));
  const serieC = serie24h(cacas, r => ({
    cantidad: r.datos.cantidad,
    color:    r.datos.color,
    nota:     r.datos.nota
  }));


  // Puntos pequeños a propósito: son unos seis pipís al día y con marcas
  // grandes se solapan y tapan la línea, que es la que lleva el dato.
  // El tamaño es la cantidad: canal impreciso adrede, porque la cantidad
  // es una apreciación de quien cambia el pañal, no una medida.
  const radio = pts => pts.map(p =>
    2 + (Math.min(Math.max(Number(p.meta.cantidad) || 0, 0), 10) / 10) * 2.5);

  const halo = colorHalo();

  // El contorno es un dataset aparte y va el primero del array, que es como
  // Chart.js decide quien queda debajo. Sin puntos y fuera del tooltip.
  const contorno = pts => ({
    label: '', data: pts, esHalo: true,
    borderColor: halo, borderWidth: 4.5,
    pointRadius: 0, pointHoverRadius: 0,
    tension: 0, fill: false
  });

  pintarLeyendaPanal(serieC, halo);

  if (charts.panal) { charts.panal.destroy(); delete charts.panal; }
  if (moduloActivo('panales')) charts.panal = new Chart(document.getElementById('chartPanal'), {
    type: 'line',
    data: {
      datasets: [
        contorno(serieP),
        contorno(serieC),
        {
          label: 'Pipís',
          tipo:  'pipi',
          data:  serieP,
          borderColor: colorPipi(serieP[0]),     // lo pisa segment.borderColor
          borderWidth: 3,
          pointRadius: radio(serieP),
          pointHoverRadius: radio(serieP).map(r => r + 3),
          pointBackgroundColor: serieP.map(colorPipi),
          pointBorderColor: halo,                // se ven aunque el color sea palido
          pointBorderWidth: 1.25,
          pointStyle: 'triangle',                // ▲ distinguible en blanco y negro
          tension: 0,
          fill: false,
          segment: { borderColor: ctx => colorPipi(serieP[ctx.p0DataIndex]) }
        },
        {
          label: 'Cacas',
          tipo:  'caca',
          data:  serieC,
          borderColor: colorCaca(serieC[0]),
          borderWidth: 3,
          pointRadius: radio(serieC),
          pointHoverRadius: radio(serieC).map(r => r + 3),
          pointBackgroundColor: serieC.map(colorCaca),
          pointBorderColor: halo,
          pointBorderWidth: 1.25,
          pointStyle: 'circle',                  // ● distinguible en blanco y negro
          tension: 0,
          fill: false,
          segment: { borderColor: ctx => colorCaca(serieC[ctx.p0DataIndex]) }
        }
      ]
    },
    options: Object.assign({}, base, {
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: item => !item.dataset.esHalo,
          callbacks: {
            label: ctx => {
              const m = ctx.raw.meta || {};
              const n = ctx.parsed.y;
              const l = [];

              if (ctx.dataset.tipo === 'pipi') {
                l.push(`${n} ${plural(n, 'pipí', 'pipís', 'pipi')} en 24 h`);
                l.push(`Éste: cantidad ${m.cantidad} · `
                     + (m.transparente ? 'transparente' : t('hist.noTransp', 'no transparente')));
              } else {
                l.push(`${n} ${plural(n, 'caca', 'cacas', 'caca')} en 24 h`);
                l.push(`Ésta: cantidad ${m.cantidad} · ${infoColor(m.color).label}`);
              }
              if (m.nota) l.push('📝 ' + m.nota);
              return l;
            }
          }
        }
      },
      scales: {
        x: ejeX(),
        y: ejeY(t('graf.panales24', 'pañales en 24 h'), {
          beginAtZero: true,
          ticks: { color: c.tick, precision: 0, stepSize: 1 }
        })
      }
    })
  });

  const notaPanal = document.getElementById('notaPanal');
  if (notaPanal) {
    notaPanal.textContent = (serieP.length || serieC.length)
      ? t('graf.notaPanal',
          'Cada punto es un pañal y su altura son los de las 24 h anteriores, '
          + 'él incluido. El primer día siempre sube desde 1 porque la ventana '
          + 'todavía no está llena: esa subida no significa nada.')
      : t('graf.sinPanales', 'Todavía no hay pañales registrados.');
  }
}

/* ─────────────────────────────────────────────────────────────
   RECUENTO MÓVIL DE 24 H

   Ventana deslizante: una sola pasada por la lista en vez de
   contar hacia atrás en cada punto.
   ───────────────────────────────────────────────────────────── */
function serie24h(registrosDelTipo, metaDe) {
  const ev = registrosDelTipo
    .map(r => ({ t: +new Date(r.fecha_hora), r }))
    .sort((a, b) => a.t - b.t);

  const pts = [];
  let desde = 0;

  ev.forEach((e, i) => {
    while (ev[desde].t <= e.t - VENTANA_MS) desde++;
    pts.push({ x: e.r.fecha_hora, y: i - desde + 1, meta: metaDe(e.r) });
  });

  return pts;
}

/* ─────────────────────────────────────────────────────────────
   COLOR DE CADA TRAMO

   El tramo toma el color vigente al EMPEZAR: es el estado que hubo
   durante ese rato. Un cambio a mitad de tramo se ve en el
   siguiente, que es cuando de verdad pasó a ser el último.
   ───────────────────────────────────────────────────────────── */
// Rosa. Dos descartes antes de llegar aquí:
//   · el ámbar que pide la intuición para un pipí concentrado quedaba
//     calcado al mostaza de las cacas, con diferencia el más frecuente;
//   · el violeta que lo sustituyó ha pasado a ser el color de MARCA, y un
//     dato pintado del color de la marca deja de leerse como dato.
// El rosa separa de los dos y del celeste del pipí transparente: comprobado
// con el validador de paletas, incluyendo daltonismo.
const COLOR_PIPI_NO = '#db2777';

/* Los colores van LITERALES, sin retocar. Se probo a oscurecerlos o
   aclararlos hasta llegar a 3:1 contra el fondo, y el remedio era peor: al
   oscurecer el mostaza para que se viera sobre blanco, se acercaba tanto al
   verde que dejaban de distinguirse entre si (delta-E 13,5 en vision normal,
   por debajo del suelo de 15). Un color de caca tiene que parecerse a la caca
   que viste, asi que el tono manda; la visibilidad la da el contorno. */
function colorPipi(p) {
  if (!p) return COLOR_PIPI;
  return p.meta.transparente ? COLOR_PIPI : COLOR_PIPI_NO;
}

function colorCaca(p) {
  if (!p) return esDark() ? 'rgba(148,163,184,.55)' : 'rgba(100,116,139,.45)';
  return infoColor(p.meta.color).hex;
}

/* Contorno: oscuro sobre fondo claro y claro sobre fondo oscuro. Es lo que
   hace visible el blanquecino sobre blanco y el negro sobre el tema oscuro,
   que son dos de los colores que justamente hay que mirar. */
function colorHalo() {
  // Fino y discreto: a 5,5 px y opacidad alta el contorno se comia el color y
  // toda la grafica salia lavada. Basta con perfilar el borde.
  return esDark() ? 'rgba(226,232,240,.38)' : 'rgba(51,65,85,.32)';
}

/* ─────────────────────────────────────────────────────────────
   LEYENDA

   Se genera aqui y no en el HTML porque depende de los datos: solo
   se listan los colores de caca que existen de verdad. Con los ocho
   posibles seria casi toda ruido.
   ───────────────────────────────────────────────────────────── */
function pintarLeyendaPanal(serieC, halo) {
  const cont = document.getElementById('leyendaPanal');
  if (!cont) return;

  const vistos = [];
  serieC.forEach(p => {
    if (p.meta.color && vistos.indexOf(p.meta.color) === -1) vistos.push(p.meta.color);
  });

  // Mismo contorno que en la grafica: sin el, el blanquecino desaparece
  const marca = (color, texto) =>
    `<div class="legend-item">
       <div class="legend-dash" style="background:${color};box-shadow:0 0 0 1.5px ${halo}"></div>
       <span>${texto}</span>
     </div>`;

  cont.innerHTML =
    `<div class="legend-item"><span class="legend-nota">▲ ${esc(t('leg.pipis', 'Pipís:'))}</span></div>` +
    marca(COLOR_PIPI,    esc(t('hist.transp', 'transparente'))) +
    marca(COLOR_PIPI_NO, esc(t('hist.noTransp', 'no transparente'))) +
    '<div class="legend-sep"></div>' +
    `<div class="legend-item"><span class="legend-nota">● ${esc(t('leg.cacas', 'Cacas:'))}</span></div>` +
    (vistos.length
      ? vistos.map(k => marca(infoColor(k).hex, esc(infoColor(k).label))).join('')
      : `<div class="legend-item"><span class="legend-nota">${esc(t('leg.ninguna', 'ninguna todavía'))}</span></div>`) +
    '<div class="legend-sep"></div>' +
    `<div class="legend-item"><span class="legend-nota">${esc(t('leg.tamano', 'El tamaño del punto es la cantidad'))}</span></div>`;
}
