/* ═════════════════════════════════════════════════════════════
   LA ROPA QUE LLEVABA PUESTA

   En la farmacia el bebé se pesa vestido, y con el frío lleva cada
   vez más encima. Sin esto, la gráfica del peso mezcla dos cosas que
   crecen a la vez: el bebé y el armario. Entre un body de verano y un
   conjunto de invierno con pelele y polar hay más de 300 g — lo que
   un bebé de tres meses gana en diez días.

   ── LO QUE ESTO NO ARREGLA ──
   En consulta se pesa desnudo precisamente porque estimar la ropa es
   poco fiable. El margen de una estimación razonable es de ±50-100 g,
   y la ganancia que la gráfica intenta detectar es de 20-30 g al día.
   Restar ropa estimada puede meter dos o tres días de error en cada
   punto. Eso no lo arregla ningún código.

   Lo que sí se hace, y gobierna todo el diseño:

     · No se pierde nunca la lectura real de la báscula: se guarda
       `bruto` al lado del neto.
     · Se guarda el DESGLOSE —qué prendas, qué talla—, no sólo el
       total restado.
     · Los gramos restados se guardan CALCULADOS, no se recalculan al
       leer. Si mañana esta tabla mejora, la curva de ayer no se mueve
       sola: un número que cambia solo en un historial de salud es
       peor que un número con un error conocido.

   ── EL PAÑAL ──
   Un pañal seco pesa 25-50 g. Con un pipí, 60-130. Empapado pasa de
   200. La tabla sólo puede estimar el seco, y por eso la pantalla
   dice en voz alta que se cambie antes de pesar.
   ═════════════════════════════════════════════════════════════ */

/* Sube si se cambian los números de abajo. Se guarda en cada registro
   para poder saber, dentro de dos años, con qué tabla se calculó. */
const ROPA_V = 1;

/* Tallas europeas en centímetros, que es como viene marcada la ropa
   de bebé en España. Son las ocho que cubren de recién nacido a dos
   años; más allá, esto ya no se usa. */
const TALLAS = [50, 56, 62, 68, 74, 80, 86, 92];

/* ─────────────────────────────────────────────────────────────
   LA TABLA

   Gramos por prenda y talla, en el mismo orden que TALLAS.

   DE DÓNDE SALEN: son ESTIMACIONES, no medidas. Algodón corriente
   de marca normal, escaladas por superficie — la masa de una prenda
   va con el cuadrado de la talla, no con la talla, así que de la 50
   a la 92 hay un factor ~3 y no ~1,8.

   No son un dato clínico y no se presentan como tal. La forma de
   mejorarlas es pesar la ropa real una vez en una báscula de cocina
   y corregir estos literales; no hace falta tocar nada más.

   El pañal va por talla de ropa porque las dos siguen al tamaño del
   bebé: la fila corresponde a T1 en la 50 y T5 en la 92.
   ───────────────────────────────────────────────────────────── */
const PRENDAS = {
  //                        50   56   62   68   74   80   86   92
  panal:      { g: [       22,  25,  28,  33,  38,  43,  49,  55] },
  bodyMC:     { g: [       28,  34,  41,  49,  58,  67,  77,  88] },
  bodyML:     { g: [       38,  46,  55,  65,  76,  88, 101, 115] },
  camisetaMC: { g: [       22,  27,  33,  39,  46,  54,  62,  71] },
  camisetaML: { g: [       32,  38,  46,  54,  64,  74,  85,  97] },
  pantalon:   { g: [       28,  34,  41,  49,  58,  68,  78,  89] },
  pelele:     { g: [       58,  70,  84,  99, 116, 134, 154, 176] },
  vestido:    { g: [       42,  51,  61,  72,  85,  98, 113, 129] },
  jersey:     { g: [       62,  75,  90, 106, 124, 144, 165, 189] },
  chaqueta:   { g: [       52,  63,  75,  89, 104, 120, 138, 158] },
  polar:      { g: [       85, 103, 123, 146, 170, 197, 226, 258] },
  calcetines: { g: [        7,   8,  10,  11,  13,  15,  17,  19] },
  patucos:    { g: [       28,  34,  41,  48,  56,  65,  75,  86] },
  babero:     { g: [       14,  16,  19,  22,  26,  30,  34,  39] },
  gorro:      { g: [       11,  13,  16,  19,  22,  25,  29,  33] },
  manoplas:   { g: [        5,   6,   7,   8,  10,  11,  13,  15] }
};

/* El español va aquí y no dentro de PRENDAS a propósito: un objeto
   literal se construye al cargar el fichero, ANTES de que se sepa qué
   idioma quiere la persona, así que un t() ahí dentro congelaría el
   primer idioma para toda la sesión. Mismo motivo que infoColor().
   Es un error que este proyecto ya ha cometido dos veces. */
function nombrePrenda(clave) {
  const ES = {
    panal:      'Pañal seco',
    bodyMC:     'Body manga corta',
    bodyML:     'Body manga larga',
    camisetaMC: 'Camiseta manga corta',
    camisetaML: 'Camiseta manga larga',
    pantalon:   'Pantalón o leggings',
    pelele:     'Pelele o pijama',
    vestido:    'Vestido',
    jersey:     'Jersey o sudadera',
    chaqueta:   'Chaqueta de punto',
    polar:      'Polar o abrigo fino',
    calcetines: 'Calcetines',
    patucos:    'Patucos o zapatos',
    babero:     'Babero',
    gorro:      'Gorro',
    manoplas:   'Manoplas'
  };
  return t('ropa.' + clave, ES[clave] || clave);
}

/* ─────────────────────────────────────────────────────────────
   CUÁNTO PESA LO MARCADO
   ───────────────────────────────────────────────────────────── */
function indiceTalla(talla) {
  const i = TALLAS.indexOf(Number(talla));
  if (i >= 0) return i;

  // Una talla rara —de un registro viejo o de una futura tabla— se
  // acerca a la más próxima en vez de devolver 0 g en silencio, que
  // sería restar nada y no avisar de nada.
  let mejor = 0;
  TALLAS.forEach((v, j) => {
    if (Math.abs(v - talla) < Math.abs(TALLAS[mejor] - talla)) mejor = j;
  });
  return mejor;
}

function pesoRopa(prendas, talla) {
  if (!prendas || !prendas.length) return 0;
  const i = indiceTalla(talla);
  return prendas.reduce((suma, clave) => {
    const p = PRENDAS[clave];
    return suma + (p ? p.g[i] : 0);
  }, 0);
}

/* ─────────────────────────────────────────────────────────────
   QUÉ TALLA PROPONER

   La talla vive en `ninos.talla`, junto a la fecha de nacimiento y el
   sexo, porque es una propiedad del bebé y no de una pesada concreta.

   Antes se leía del último registro de peso que la llevara. Parecía
   más barato —cero esquema— y falló de dos maneras en cuanto se usó:

     · ropa-retroactiva.sql estampó talla 50 en las diecisiete pesadas
       anteriores, la más reciente incluida, así que el formulario
       proponía un 50 que nadie había elegido.
     · Al guardar un peso SIN marcar prendas, `datos` es sólo
       `{ gramos }` y la talla no se guardaba en ninguna parte.

   El orden de abajo es de más fiable a menos: lo que dijo una persona,
   luego lo que se dedujo de la última pesada vestida, y sólo si no hay
   nada de eso, la edad — que es mala a propósito, porque las tallas
   van por tamaño y un bebé en percentil alto lleva una o dos de
   diferencia. Está para que el desplegable no salga vacío.
   ───────────────────────────────────────────────────────────── */
function tallaPorEdad(dias) {
  if (!(dias >= 0)) return 62;
  return dias <  31 ? 50
       : dias <  62 ? 56
       : dias < 123 ? 62
       : dias < 184 ? 68
       : dias < 274 ? 74
       : dias < 366 ? 80
       : dias < 549 ? 86
       :              92;
}

function tallaPorDefecto() {
  // 1. La que dijo una persona
  if (typeof ninoActivo !== 'undefined' && ninoActivo && ninoActivo.talla)
    return ninoActivo.talla;

  // 2. La de la última pesada vestida
  if (typeof registros !== 'undefined' && registros) {
    for (let i = registros.length - 1; i >= 0; i--) {
      const r = registros[i];
      if (r.tipo === 'peso' && r.datos && r.datos.ropa && r.datos.ropa.talla)
        return r.datos.ropa.talla;
    }
  }

  // 3. La edad, que es una conjetura y se avisa de ello en la pantalla
  return tallaPorEdad(typeof diaDeVida === 'function' ? diaDeVida() : -1);
}

/* Cambiar la talla en el formulario la guarda en el niño. Es un ajuste
   que se toca una vez cada dos meses, así que pedir un botón aparte
   sería pedir que se olvide: la prueba es que el fallo que esto arregla
   consistía exactamente en que la talla no se quedaba guardada.

   Silenciosa si falla: la pesada que estás a punto de guardar se hace
   igual con la talla elegida —va dentro de `datos.ropa`— y lo único que
   se pierde es que la proponga la próxima vez. No merece un toast rojo
   encima de lo que estabas haciendo.

   Sólo lo llama el formulario de Registrar. El modal de EDICIÓN no:
   ahí estás corrigiendo lo que llevaba puesto en una pesada de hace
   tres semanas, y eso no dice nada de la talla que usa hoy. */
async function guardarTallaActual(talla) {
  if (typeof ninoActivo === 'undefined' || !ninoActivo) return;
  if (!(talla >= 40 && talla <= 110))      return;   // el mismo CHECK que la base
  if (ninoActivo.talla === talla)          return;   // nada que escribir

  const anterior = ninoActivo.talla;
  ninoActivo.talla = talla;                          // que la pantalla no espere a la red

  const { error } = await sb.from('ninos').update({ talla }).eq('id', ninoActivo.id);
  if (error) {
    console.error('talla:', error);
    ninoActivo.talla = anterior;
  }
}

/* ─────────────────────────────────────────────────────────────
   PINTAR

   Dos sitios la usan con la misma forma: la tarjeta de Registrar y el
   modal de edición, que se construye en caliente. Por eso devuelven
   HTML en vez de tocar el DOM.
   ───────────────────────────────────────────────────────────── */
function htmlTallas(talla) {
  return TALLAS.map(v =>
    `<option value="${v}"${v === Number(talla) ? ' selected' : ''}>${v}</option>`
  ).join('');
}

function htmlPrendas(marcadas) {
  const puestas = marcadas || [];
  return Object.keys(PRENDAS).map(clave => {
    const sel = puestas.indexOf(clave) >= 0;
    return `<button type="button" class="ropa-opt${sel ? ' sel' : ''}" `
         + `data-v="${clave}" aria-pressed="${sel}">${esc(nombrePrenda(clave))}</button>`;
  }).join('');
}

// Las marcadas dentro de una fila. Hermana de valorSel(), pero
// devuelve varias: aquí la selección es múltiple.
function prendasSel(rowId) {
  return Array.from(document.querySelectorAll('#' + rowId + ' .ropa-opt.sel'))
              .map(b => b.dataset.v);
}

/* ─────────────────────────────────────────────────────────────
   EL ECO

   «5.800 g − 128 g de ropa = 5.672 g», vivo mientras se teclea.

   No es decoración: es lo único que deja ver, antes de guardar, que
   lo que va a la gráfica no es lo que marcaba la báscula. Sin esto,
   un peso que baja 300 g respecto al mes pasado parece un problema
   de salud en vez de un jersey.
   ───────────────────────────────────────────────────────────── */
function pintarEcoRopa(idBruto, idTalla, idFila, idEco, idSuma) {
  const eco = document.getElementById(idEco);
  if (!eco) return;

  const bruto   = parseInt((document.getElementById(idBruto) || {}).value, 10);
  const talla   = parseInt((document.getElementById(idTalla) || {}).value, 10);
  const prendas = prendasSel(idFila);
  const g       = pesoRopa(prendas, talla);

  const suma = document.getElementById(idSuma);
  if (suma) suma.textContent = g ? numero(g) + ' g' : '';

  if (!g || isNaN(bruto)) { eco.innerHTML = ''; return; }

  /* El resultado en negrita porque es el número que de verdad se
     guarda y el que sale en la gráfica. Los tres valores salen de
     numero(), así que son dígitos y separadores, pero pasan por esc()
     igual: aquí se escribe innerHTML y la regla de la casa es que nada
     llegue ahí sin escapar. */
  eco.innerHTML = t2('reg.ropa.eco', '{b} g − {r} g de ropa = {n} g', {
    b: esc(numero(bruto)),
    r: esc(numero(g)),
    n: '<strong>' + esc(numero(bruto - g)) + '</strong>'
  });
}

function refrescarEcoPeso() {
  pintarEcoRopa('pesoG', 'pesoTalla', 'rowPesoRopa', 'pesoEco', 'pesoRopaSuma');
}

function refrescarEcoEdit() {
  pintarEcoRopa('editGramos', 'editTalla', 'rowEditRopa', 'editEco', 'editRopaSuma');
}

/* ─────────────────────────────────────────────────────────────
   EL BLOQUE ENTERO

   Mismo marcado en la tarjeta y en el modal, con los ids cambiados.
   Mantenerlo en una función evita que dentro de seis meses uno de los
   dos tenga una prenda que el otro no.
   ───────────────────────────────────────────────────────────── */
/* El bloque de la tarjeta de Registrar no viene en el HTML servido
   porque la talla por defecto sale de los registros, que todavía no
   están cargados cuando se sirve la página.

   Sin `forzar` no repinta si ya está: cargarDatos() se vuelve a
   ejecutar sola cada vez que el móvil de tu pareja apunta algo, y
   repintar ahí borraría las prendas que estuvieras marcando. Con
   `forzar` —al cambiar de idioma— se repinta conservando lo marcado. */
function pintarRopaPeso(forzar) {
  const caja = document.getElementById('pesoRopa');
  if (!caja) return;

  const pintado = caja.children.length > 0;
  if (pintado && !forzar) return;

  const previo = pintado
    ? { talla:   parseInt(document.getElementById('pesoTalla').value, 10),
        prendas: prendasSel('rowPesoRopa') }
    : null;

  caja.innerHTML = htmlBloqueRopa('peso', previo);

  // El <select> es nuevo en cada repintado, así que esto no duplica nada
  const sel = document.getElementById('pesoTalla');
  if (sel) sel.addEventListener('change', () => {
    guardarTallaActual(parseInt(sel.value, 10));
    refrescarEcoPeso();
  });

  refrescarEcoPeso();
}

function htmlBloqueRopa(pre, ropa) {
  const talla    = (ropa && ropa.talla) ? ropa.talla : tallaPorDefecto();
  const marcadas = (ropa && ropa.prendas) ? ropa.prendas : [];
  const g        = pesoRopa(marcadas, talla);

  /* Si la talla no la ha dicho nadie —ni el niño ni una pesada vestida—
     es la de la edad, y hay que decirlo. Una conjetura presentada como
     un dato es peor que no tener dato: nadie corrige lo que parece ya
     correcto, y aquí lo que está en juego son gramos de un historial de
     peso. Sólo en Registrar: en el modal de edición la talla viene del
     propio registro y no hay nada que adivinar. */
  const sinDecidir = pre === 'peso' && !ropa
                  && !(typeof ninoActivo !== 'undefined' && ninoActivo && ninoActivo.talla);
  const adivinada  = sinDecidir && !(typeof registros !== 'undefined' && registros
                  && registros.some(r => r.tipo === 'peso' && r.datos && r.datos.ropa && r.datos.ropa.talla));

  return `
    <details class="mas"${marcadas.length ? ' open' : ''}>
      <summary><span>${esc(t('reg.ropa.tit', 'Ropa que llevaba puesta'))}</span>
        <span class="eco-fecha" id="${pre}RopaSuma">${g ? esc(numero(g)) + ' g' : ''}</span></summary>

      <div class="field">
        <label for="${pre}Talla">${esc(t('reg.ropa.talla', 'Talla de la ropa (cm)'))}</label>
        <select id="${pre}Talla" class="hijo-select">${htmlTallas(talla)}</select>
        ${adivinada ? `<p class="hint-txt" style="margin:8px 0 0">${esc(t('reg.ropa.adivinada',
          'Ésta la hemos deducido de la edad y suele fallar: las tallas van por '
          + 'tamaño, no por meses. Mira la etiqueta y corrígela — se queda guardada.'))}</p>` : ''}
      </div>

      <div class="field">
        <label>${esc(t('reg.ropa.prendas', 'Marca todo lo que llevaba'))}</label>
        <div class="ropa-row" id="row${pre.charAt(0).toUpperCase() + pre.slice(1)}Ropa">${htmlPrendas(marcadas)}</div>
      </div>

      <div class="field" style="margin-bottom:0">
        <p class="hint-txt" style="margin:0">${esc(t('reg.ropa.aviso',
          'Son estimaciones, no medidas: el margen es de unos 50 g. '
          + 'Y el pañal cuenta como seco — uno mojado pesa el doble o el triple, '
          + 'así que cámbialo antes de pesar o no lo marques.'))}</p>
      </div>
    </details>`;
}
