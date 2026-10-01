/* ═════════════════════════════════════════════════════════════
   IDIOMAS

   La fontanería para que la app pueda hablar otros idiomas. No
   traduce nada por sí sola: deja puesto el mecanismo para que
   traducir sea después una tarea de texto y no de código.

   Decisión que lo hace barato: el español se queda ESCRITO EN EL
   SITIO, como valor por defecto. Es decir,

       t('boton.guardar', 'Guardar pipí')

   devuelve la traducción si existe y, si no, el español de toda
   la vida. Consecuencias:

     · No hace falta un es.js: el código sigue leyéndose solo.
     · Nada se rompe si falta una clave. Lo peor que pasa es que
       esa frase salga en español.
     · Se puede migrar a trozos, sin un «gran día de la verdad».

   Se carga ANTES que el resto para que t() exista cuando los
   demás ficheros se ejecuten.
   ═════════════════════════════════════════════════════════════ */

const IDIOMAS = {
  es: { nombre: 'Español', locale: 'es-ES', csv: ';' },
  // en-GB y no en-US a propósito: fechas en día/mes, que es lo que
  // espera alguien en Europa. Cambiar aquí si algún día pesa EE. UU.
  en: { nombre: 'English', locale: 'en-GB', csv: ',' }
};

const CLAVE_IDIOMA = 'idioma';

// Los diccionarios se registran solos al cargarse: idiomas/en.js hace
// TEXTOS.en = {...}. Si un fichero no está, su idioma cae al español.
const TEXTOS = {};

let idioma = detectarIdioma();

/* La primera vez manda el navegador; a partir de ahí, lo que eligió
   la persona. Sólo los dos primeros caracteres: 'en-US', 'en-GB' y
   'en' son el mismo idioma para lo que aquí importa. */
function detectarIdioma() {
  const guardado = localStorage.getItem(CLAVE_IDIOMA);
  if (guardado && IDIOMAS[guardado]) return guardado;

  const nav = ((navigator.languages && navigator.languages[0]) || navigator.language || 'es')
                .slice(0, 2).toLowerCase();
  return IDIOMAS[nav] ? nav : 'es';
}

function idiomaActivo() { return idioma; }
function localeActivo() { return IDIOMAS[idioma].locale; }

/* ─────────────────────────────────────────────────────────────
   TRADUCIR
   ───────────────────────────────────────────────────────────── */
function t(clave, porDefecto) {
  const dic = TEXTOS[idioma];
  if (dic && typeof dic[clave] === 'string') return dic[clave];
  return porDefecto !== undefined ? porDefecto : clave;
}

/* Con huecos: t2('quedan.dias', 'Quedan {n} días', { n: 3 }) */
function t2(clave, porDefecto, valores) {
  let s = t(clave, porDefecto);
  if (valores) {
    Object.keys(valores).forEach(k => {
      s = s.split('{' + k + '}').join(valores[k]);
    });
  }
  return s;
}

/* ─────────────────────────────────────────────────────────────
   PLURALES

   Trece sitios tenían escrito `n === 1 ? 'día' : 'días'`. Funciona
   en español y en inglés, pero no en idiomas con más de dos formas,
   y sobre todo deja la decisión repartida por todo el código.

   Intl.PluralRules la toma por nosotros con las reglas de cada
   idioma, y ya viene en el navegador.
   ───────────────────────────────────────────────────────────── */
function plural(n, una, varias, clave) {
  const forma = new Intl.PluralRules(localeActivo()).select(n);

  // Devuelve SOLO la palabra, nunca el número: en los sitios donde se usa
  // el número ya está puesto al lado (`${n} ${plural(n, 'día', 'días')}`),
  // y devolverlo aquí lo imprimiría dos veces.
  if (clave) {
    const traducida = t(clave + '.' + forma, null);
    if (traducida !== null) return traducida;
  }
  return forma === 'one' ? una : varias;
}

/* ─────────────────────────────────────────────────────────────
   FECHAS

   Sustituyen a los siete toLocaleDateString('es-ES') que había
   clavados. El idioma lo pone el que esté activo, no el fichero.
   ───────────────────────────────────────────────────────────── */
function fechaHora(iso, opciones) {
  return new Date(iso).toLocaleString(localeActivo(), opciones || {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function fechaCorta(iso, opciones) {
  return new Date(iso).toLocaleDateString(localeActivo(), opciones);
}

/* Separador del CSV: Excel en español espera punto y coma, en inglés coma */
function separadorCSV() { return IDIOMAS[idioma].csv; }

/* ─────────────────────────────────────────────────────────────
   APLICAR AL DOM

   El HTML lleva el español escrito y una clave al lado:

       <p data-i18n="login.sub">Entra para llevar el seguimiento…</p>

   Así la página se lee igual que antes en el editor y sigue
   funcionando sin traducción. Para atributos:

       <input data-i18n-attr="placeholder:login.correo">
   ───────────────────────────────────────────────────────────── */
function aplicarIdioma() {
  document.documentElement.lang = idioma;

  // Se guarda el texto original ANTES de pisarlo. Sin esto, al pasar a
  // inglés se perdía el español que venía en el HTML y volver al español
  // dejaba la pantalla en inglés: el valor por defecto que t() necesita
  // ya no existía en ninguna parte.
  document.querySelectorAll('[data-i18n]').forEach(el => {
    if (el.dataset.i18nOrig === undefined) el.dataset.i18nOrig = el.textContent;
    el.textContent = t(el.dataset.i18n, el.dataset.i18nOrig);
  });

  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    el.dataset.i18nAttr.split(',').forEach(par => {
      const [attr, clave] = par.split(':').map(x => x.trim());
      if (!attr || !clave) return;

      // Mismo problema con los atributos, y misma solución
      const memoria = 'i18nOrig' + attr.replace(/[^a-zA-Z0-9]/g, '');
      if (el.dataset[memoria] === undefined) {
        el.dataset[memoria] = el.getAttribute(attr) || '';
      }
      el.setAttribute(attr, t(clave, el.dataset[memoria]));
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   CAMBIAR DE IDIOMA

   Buena parte de la interfaz se pinta desde JavaScript (resumen,
   historial, gráficas, modales), así que no basta con recorrer el
   DOM: hay que volver a pintar lo que está hecho a mano.
   ───────────────────────────────────────────────────────────── */
window.cambiarIdioma = function(cual) {
  if (!IDIOMAS[cual] || cual === idioma) return;
  idioma = cual;
  localStorage.setItem(CLAVE_IDIOMA, cual);

  aplicarIdioma();

  // Lo pintado a mano, sólo si ya hay con qué
  if (typeof familia !== 'undefined' && familia) {
    if (typeof pintarCabecera === 'function') pintarCabecera();
    if (typeof renderResumen  === 'function') renderResumen();
    if (typeof renderTabla    === 'function') renderTabla();
    if (typeof avisarSuscripcion === 'function') avisarSuscripcion();
    if (typeof tabActual !== 'undefined' && tabActual === 'graficas'
        && typeof renderCharts === 'function') renderCharts();
    if (typeof moduloActivo === 'function' && moduloActivo('comida')
        && typeof renderComida === 'function') renderComida();
  if (typeof renderMedicacion === 'function') renderMedicacion();
  if (typeof pintarBannerMed  === 'function') pintarBannerMed();
  }

  // Si el modal de ajustes está abierto, se repinta para verse traducido
  const modal = document.getElementById('comidaModal');
  if (modal && modal.style.display !== 'none'
      && typeof abrirAjustes === 'function'
      && document.getElementById('comidaModalTitulo').textContent.indexOf('⚙') === 0) {
    abrirAjustes();
  }
};

/* Lista para el selector de Ajustes */
function htmlSelectorIdioma() {
  return `<select id="selectorIdioma" class="hijo-select" aria-label="${t('ajustes.idioma', 'Idioma')}"
                  onchange="cambiarIdioma(this.value)">
    ${Object.keys(IDIOMAS).map(k =>
      `<option value="${k}"${k === idioma ? ' selected' : ''}>${esc(IDIOMAS[k].nombre)}</option>`
    ).join('')}
  </select>`;
}

// El atributo lang debe estar bien desde el primer pintado, no después
document.documentElement.lang = idioma;
