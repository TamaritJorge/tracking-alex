/* ═════════════════════════════════════════════════════════════
   MÓDULOS OCULTABLES

   No todas las familias usan todo. Quien no se saca leche no
   quiere una tarjeta de extracción en Registrar, una gráfica
   vacía en Gráficas y un chip inútil en Historial.

   Ocultar es SÓLO visual: no se borra ni un registro. Si un
   módulo se vuelve a encender, todo lo guardado vuelve a
   aparecer tal cual estaba. Por eso aquí no hay ningún DELETE.

   El ajuste vive en familia_ajustes (clave 'modulos') y por
   tanto es de la familia, no del móvil: encenderlo en un
   teléfono lo enciende en el de la pareja. Es de familia y no
   de cada hijo porque esa tabla va por familia_id; si algún día
   hiciera falta por hijo, el sitio natural sería una tabla
   nino_ajustes con la misma forma.
   ═════════════════════════════════════════════════════════════ */

const CLAVE_MODULOS = 'modulos';

const MODULOS = {
  panales: {
    icono: '💧', nombre: 'Pañales',
    desc: 'Pipís y cacas: cantidad, color y notas'
  },
  peso: {
    icono: '⚖️', nombre: 'Peso',
    desc: 'Pesadas, percentiles de la OMS y tendencia de g/día'
  },
  extraccion: {
    icono: '🍼', nombre: 'Extracción de leche',
    desc: 'Mililitros por pecho'
  },
  comida: {
    icono: '🥑', nombre: 'Alimentación complementaria',
    desc: 'Introducción de alimentos a partir de los 6 meses'
  },
  medicacion: {
    icono: '💊', nombre: 'Medicinas',
    desc: 'Pautas del pediatra y aviso de la toma que toca'
  }
};

// Los módulos que tienen pestaña propia. Antes esto estaba escrito a
// mano dentro de aplicarModulos() y sólo contemplaba «comida»: apagar
// cualquier otro estando dentro dejaba un panel visible sin botón que
// lo abriera.
const MODULOS_CON_PESTANA = ['comida', 'medicacion'];

// A qué módulo pertenece cada tipo de registro. Sirve para no
// enseñar en el historial filas de algo que está apagado.
const MODULO_DE_TIPO = {
  pipi:       'panales',
  caca:       'panales',
  peso:       'peso',
  extraccion: 'extraccion'
};

// Por defecto todo encendido: una familia nueva lo ve todo y va
// apagando, que es menos desconcertante que lo contrario.
let modulos = {};
resetModulos();

function resetModulos() {
  modulos = {};
  Object.keys(MODULOS).forEach(k => { modulos[k] = true; });
}

function moduloActivo(clave) { return modulos[clave] !== false; }

/* ¿Debe verse un registro de este tipo? */
function tipoVisible(tipo) {
  if (tipo === 'todo') return true;
  const m = MODULO_DE_TIPO[tipo];
  return !m || moduloActivo(m);
}

/* ─────────────────────────────────────────────────────────────
   PERSISTENCIA
   ───────────────────────────────────────────────────────────── */
async function cargarModulos() {
  resetModulos();
  if (!familia) return;

  const { data, error } = await sb
    .from('familia_ajustes')
    .select('valor')
    .eq('familia_id', familia.id)
    .eq('clave', CLAVE_MODULOS)
    .maybeSingle();

  if (error) { console.error('No se pudieron leer los módulos:', error); return; }
  if (!data || !data.valor) return;

  // Se copian clave a clave y sólo booleanos: así un ajuste viejo con
  // módulos que ya no existen no mete basura en el estado.
  Object.keys(MODULOS).forEach(k => {
    if (typeof data.valor[k] === 'boolean') modulos[k] = data.valor[k];
  });
}

async function guardarModulos() {
  if (!familia) return { error: 'Sin familia' };
  const { error } = await sb.from('familia_ajustes').upsert({
    familia_id: familia.id,
    clave: CLAVE_MODULOS,
    valor: modulos,
    actualizado_en: new Date().toISOString()
  }, { onConflict: 'familia_id,clave' });

  return error ? { error: error.message || 'No se pudo guardar' } : { ok: true };
}

/* ─────────────────────────────────────────────────────────────
   APLICAR AL DOM

   Se oculta con display:none en vez de quitar los nodos: los
   listeners de registros.js y los ids que busca resetFechas()
   se registran una sola vez al cargar la página y petarían si
   el nodo desapareciera.

   Un elemento puede declarar varios módulos separados por
   espacio (data-modulo="peso extraccion") y se ve si al menos
   uno está encendido.
   ───────────────────────────────────────────────────────────── */
function aplicarModulos() {
  document.querySelectorAll('[data-modulo]').forEach(el => {
    // Las tarjetas de Registrar las manda mostrarFormulario(): ahí no basta
    // con que el módulo esté encendido, además tiene que ser la elegida.
    if (el.matches('#tab-registrar .card[data-reg]')) return;
    const visible = el.dataset.modulo.split(/\s+/).some(m => moduloActivo(m));
    el.style.display = visible ? '' : 'none';
  });

  // Va después de los chips, para que pueda caer en uno que siga encendido
  mostrarFormulario(formRegistro);

  // Si el filtro del historial apuntaba a un tipo que se acaba de
  // apagar, la tabla saldría vacía sin explicar por qué.
  if (!tipoVisible(filtroHist)) {
    filtroHist = 'todo';
    document.querySelectorAll('#filtroRow .chip').forEach(b => {
      const sel = b.dataset.f === 'todo';
      b.classList.toggle('sel', sel);
      b.setAttribute('aria-pressed', String(sel));
    });
  }

  // Y si estamos dentro de la pestaña que se acaba de apagar, hay
  // que salir: si no, queda un panel visible sin botón que lo abra.
  if (MODULOS_CON_PESTANA.indexOf(tabActual) >= 0 && !moduloActivo(tabActual)) {
    switchTab('registrar');
  }
}

/* ─────────────────────────────────────────────────────────────
   AJUSTES: los interruptores

   Viven en el modal de ajustes (familia.js), que los pinta
   llamando a htmlModulos().
   ───────────────────────────────────────────────────────────── */
function htmlModulos() {
  return Object.entries(MODULOS).map(([k, m]) => `
    <label class="modulo-fila">
      <input type="checkbox" data-mod="${k}"${moduloActivo(k) ? ' checked' : ''}>
      <span class="modulo-txt">
        <span class="modulo-nom">${m.icono} ${esc(m.nombre)}</span>
        <span class="modulo-desc">${esc(m.desc)}</span>
      </span>
    </label>`).join('');
}

/* Las casillas del ALTA.

   No se puede reutilizar htmlModulos() aquí: el listener delegado de
   más abajo atrapa cualquier input[data-mod] y llama a cambiarModulo(),
   que escribe en la base. En el alta todavía no hay familia, así que
   guardarModulos() devolvería «Sin familia», la casilla se desmarcaría
   sola y saldría un toast rojo en el primer minuto de uso. De ahí el
   atributo distinto.

   Y los valores por defecto son literales, no salen de moduloActivo():
   `modulos` es global y sobrevive a un cierre de sesión, así que quien
   creara una familia después de otro en el mismo navegador heredaría su
   configuración. */
const MODULOS_INICIO = {
  panales:    true,
  peso:       true,
  extraccion: false,
  medicacion: false,
  comida:     false
};

function htmlModulosAlta() {
  return Object.entries(MODULOS).map(([k, m]) => `
    <label class="modulo-fila">
      <input type="checkbox" data-mod-alta="${k}"${MODULOS_INICIO[k] ? ' checked' : ''}>
      <span class="modulo-txt">
        <span class="modulo-nom">${m.icono} ${esc(m.nombre)}</span>
        <span class="modulo-desc">${esc(m.desc)}</span>
      </span>
    </label>`).join('');
}

/* Lo marcado en el alta, tal cual lo dejó la persona */
function modulosElegidosAlta() {
  const elegidos = {};
  Object.keys(MODULOS).forEach(k => { elegidos[k] = false; });
  document.querySelectorAll('#altaModulos input[data-mod-alta]').forEach(cb => {
    elegidos[cb.dataset.modAlta] = cb.checked;
  });
  return elegidos;
}

window.cambiarModulo = async function(clave, activo) {
  const antes = modulos[clave];
  modulos[clave] = activo;

  const r = await guardarModulos();
  if (r.error) {
    modulos[clave] = antes;                 // deshacer: no mentir al usuario
    const cb = document.querySelector(`[data-mod="${clave}"]`);
    if (cb) cb.checked = antes !== false;
    toast('❌ No se pudo guardar: ' + r.error, 4000);
    return;
  }

  // La pestaña de comida tiene su propia carga y su propio canal de
  // tiempo real, que mostrarApp() se salta cuando está apagada. Al
  // encenderla hay que arrancarlos, y al apagarla, soltar el canal para
  // que vuelva a arrancar limpia si se reactiva.
  if (clave === 'comida') {
    if (activo) iniciarComida();
    else if (canalRTComida) { sb.removeChannel(canalRTComida); canalRTComida = null; }
  }

  // Medicación igual, y además hay que borrar el banner: si no, al
  // apagar el módulo se quedaría un aviso rojo en pantalla pidiendo
  // una toma de algo que ya no se enseña.
  if (clave === 'medicacion') {
    if (activo) iniciarMedicacion();
    else {
      if (canalRTMed) { sb.removeChannel(canalRTMed); canalRTMed = null; }
      pintarBannerMed();
    }
  }

  aplicarModulos();
  renderResumen();
  renderTabla();
  if (tabActual === 'graficas') renderCharts();

  // Encender un módulo que estaba apagado no recupera nada de la
  // base de datos: los registros nunca se fueron.
  toast(activo ? '✅ ' + MODULOS[clave].nombre + ' activado'
               : '🚫 ' + MODULOS[clave].nombre + ' oculto (no se ha borrado nada)');
};

/* El cuerpo del modal se pinta con innerHTML cada vez que se abre, así
   que el listener va delegado en el documento: enganchado a las casillas
   moriría con el primer repintado. */
document.addEventListener('change', e => {
  const cb = e.target.closest ? e.target.closest('input[data-mod]') : null;
  if (cb) cambiarModulo(cb.dataset.mod, cb.checked);
});
