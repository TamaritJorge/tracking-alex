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
  // Mismo rango en las tres gráficas → se comparan de un vistazo
  if (!registros.length) {
    const hoy = new Date();
    return { min: new Date(hoy - 7 * 864e5), max: new Date(hoy.getTime() + 864e5) };
  }
  const ts  = registros.map(r => +new Date(r.fecha_hora));
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

  const dCaca = cacas.map(r => ({
    x: r.fecha_hora,
    y: r.datos.cantidad,
    meta: { color: infoColor(r.datos.color).label, nota: r.datos.nota }
  }));
  const dPipi = pipis.map(r => ({
    x: r.fecha_hora,
    y: r.datos.cantidad,
    meta: { transparente: !!r.datos.transparente, nota: r.datos.nota }
  }));

  // Cada punto de caca se pinta de su propio color
  const coloresPuntosCaca = cacas.map(r => infoColor(r.datos.color).hex);

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
  if (charts.ext) charts.ext.destroy();
  charts.ext = new Chart(document.getElementById('chartExt'), {
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
  // Además de las pesadas se dibujan dos rectas discontinuas:
  // la tendencia real y el mínimo de 20 g/día de la pediatra.
  const tend = tendenciaPeso();

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

  const hayCurvas = lmsEn(edadEnDias(+rng.min)) || lmsEn(edadEnDias(tFinPeso));

  if (hayCurvas) {
    // Líneas finas sin relleno, al estilo de la cartilla pediátrica.
    // Se probó con bandas sombreadas y obligaban al eje Y a llegar
    // hasta el P97 (5,5 kg), lo que aplastaba la curva de Álex.
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
    const iso  = t => new Date(t).toISOString();

    // Tendencia: la recta ajustada, prolongada hacia adelante
    dsPeso.push({
      label: 'Tendencia',
      data: [
        { x: iso(tend.t0), y: Math.round(pesoEstimado(tend, tend.t0)) },
        { x: iso(tFin),    y: Math.round(pesoEstimado(tend, tFin))    }
      ],
      borderColor: '#059669',
      backgroundColor: 'transparent',
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 0, pointHoverRadius: 0,
      showLine: true,
      unidad: ' g (estimado)'
    });

    // Mínimo de 20 g/día, partiendo de la última pesada real
    dsPeso.push({
      label: 'Mínimo 20 g/día',
      data: [
        { x: iso(tend.ultimo.t), y: tend.ultimo.g },
        { x: iso(tFin), y: Math.round(tend.ultimo.g + OBJETIVO_G_DIA * DIAS_PROYECCION) }
      ],
      borderColor: '#f59e0b',
      backgroundColor: 'transparent',
      borderDash: [3, 4],
      borderWidth: 2,
      pointRadius: 0, pointHoverRadius: 0,
      showLine: true,
      unidad: ' g (objetivo)'
    });

    // Sólo esta gráfica alarga el eje X: si lo hicieran las tres,
    // las otras dos quedarían con una semana de hueco vacío.
    ejeXPeso = Object.assign(ejeX(), { max: new Date(tFin) });
  }

  // El eje Y lo mandan los datos de Álex, NO las curvas de la OMS.
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

  if (charts.peso) charts.peso.destroy();
  charts.peso = new Chart(document.getElementById('chartPeso'), {
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

  // Texto explicativo bajo la gráfica
  const nota = document.getElementById('notaTendencia');
  if (nota) {
    nota.textContent = tend
      ? `Estimación a partir de ${tend.n} pesadas de los últimos `
        + `${tend.dias.toFixed(1)} días (${Math.round(tend.gPorDia)} g/día). `
        + 'Es una simple recta de tendencia, no una predicción: con pocas '
        + 'pesadas cambia mucho de un día para otro.'
      : 'Hacen falta al menos dos pesadas separadas entre sí para estimar la tendencia.';
  }

  /* ── Pañales ── */
  // Sin línea: son eventos sueltos, no una tendencia.
  if (charts.panal) charts.panal.destroy();
  charts.panal = new Chart(document.getElementById('chartPanal'), {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Caca',
          data: dCaca,
          backgroundColor: coloresPuntosCaca,   // un color por punto
          borderColor: esDark() ? '#e2e8f0' : '#334155',
          borderWidth: 1.5,                     // así el blanquecino se ve siempre
          pointStyle: 'circle',
          pointRadius: 8, pointHoverRadius: 10,
          showLine: false
        },
        {
          label: 'Pipí',
          data: dPipi,
          backgroundColor: COLOR_PIPI,
          borderColor:     COLOR_PIPI,
          pointStyle: 'triangle',
          pointRadius: 8, pointHoverRadius: 10,
          showLine: false
        }
      ]
    },
    options: Object.assign({}, base, {
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const m = ctx.raw.meta || {};
              let s = `${ctx.dataset.label}: ${ctx.parsed.y}`;
              if (m.color) s += ' · ' + m.color;
              if (m.transparente !== undefined) {
                s += ' · ' + (m.transparente ? 'transparente' : 'no transparente');
              }
              return m.nota ? [s, '📝 ' + m.nota] : s;
            }
          }
        }
      },
      scales: {
        x: ejeX(),
        y: ejeY('cantidad', { min: 0, max: 10, ticks: { color: c.tick, stepSize: 2 } })
      }
    })
  });
}
