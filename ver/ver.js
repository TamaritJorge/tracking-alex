/* ═════════════════════════════════════════════════════════════
   EL ARRANQUE DEL VISOR

   Esta página NO llama a init(). Lo impide app.js mirando
   window.MODO_ENLACE, porque init() da por hechos un montón de
   nodos que aquí no existen (#rowCacaQty, #comidaModal…) y porque
   se suscribe a los cambios de sesión, que aquí no hay.

   Todo lo que hace falta es llenar cuatro globales y llamar a
   switchTab('graficas'). renderCharts() y renderResumen() son
   funciones puras sobre esas globales: no consultan Supabase.
   ═════════════════════════════════════════════════════════════ */

/* ── Lo que normalmente declara familia.js ──────────────────────
   familia.js NO se carga aquí: son 39 KB de autenticación, ajustes
   y borrado de cuenta en una página anónima. Pero estas son
   <script> clásicos con ámbito global compartido, así que declarar
   `let ninoActivo` en dos ficheros cargados a la vez sería un
   SyntaxError. O uno o el otro, nunca los dos.

   Si allí cambian de forma, aquí también. */
let familia    = null;
let hijos      = [];
let ninoActivo = null;

function fechaNacimiento() {
  return ninoActivo
    ? new Date(ninoActivo.fecha_nacimiento + 'T12:00:00')
    : new Date();
}
function sexoHijo()   { return ninoActivo ? ninoActivo.sexo   : 'nino'; }
function nombreHijo() { return ninoActivo ? ninoActivo.nombre : ''; }


/* ── Decir qué ha pasado, en cristiano ───────────────────────── */
/* Una función y no un objeto: si fuera un objeto se construiría al
   cargar el fichero, con el idioma de ese instante, y no cambiaría
   nunca más. */
function explicacion(clave) {
  const E = {
    caducado: {
      titulo: t('enl.caducado.tit', 'Este enlace ha caducado'),
      texto:  t('enl.caducado.txt',
        'Los enlaces compartidos caducan solos al cabo de un tiempo. '
        + 'Pídele uno nuevo a quien te lo pasó.')
    },
    revocado: {
      titulo: t('enl.revocado.tit', 'Este enlace ya no está activo'),
      texto:  t('enl.revocado.txt',
        'Quien lo creó lo ha desactivado. Si crees que es un error, '
        + 'díselo y te pasará uno nuevo.')
    },
    no_valido: {
      titulo: t('enl.invalido.tit', 'Este enlace no es válido'),
      texto:  t('enl.invalido.txt',
        'Puede que se haya copiado a medias: tienen que ir hasta el final, '
        + 'incluida la parte de después de la almohadilla. Prueba a abrirlo '
        + 'otra vez desde el mensaje original.')
    },
    red: {
      titulo: t('enl.red.tit', 'No se ha podido conectar'),
      texto:  t('enl.red.txt', 'Comprueba la conexión y vuelve a intentarlo.')
    }
  };
  return E[clave] || E.no_valido;
}

function estado(titulo, texto) {
  const el = document.getElementById('visorEstado');
  el.style.display = '';
  el.innerHTML = '<p class="card-title">' + esc(titulo) + '</p>' +
                 (texto ? '<p class="hint-txt" style="margin:8px 0 0">' +
                          esc(texto) + '</p>' : '');
}

function fallo(clave) {
  const e = explicacion(clave);
  estado(e.titulo, e.texto);
  document.getElementById('visorContenido').style.display = 'none';
}


/* ── «Datos hasta el 2 de octubre» ────────────────────────────
   Lo más importante de la página después de las propias gráficas.
   Una curva de peso plana se lee como un hallazgo clínico; muchas
   veces lo que pasa es que hace semanas que nadie apunta nada, y
   eso no se puede adivinar mirando el dibujo. */
function pintarHasta() {
  const el = document.getElementById('visorHasta');
  if (!el) return;

  if (!registros.length) {
    el.textContent = t('enl.sinDatos', 'Todavía no hay ningún dato apuntado.');
    return;
  }

  const ultimo = new Date(registros[registros.length - 1].fecha_hora);
  const dias   = Math.floor((Date.now() - ultimo) / 864e5);

  // El único 'es-ES' clavado que quedaba en toda la aplicación.
  const cuando = ultimo.toLocaleDateString(localeActivo(),
    { day: 'numeric', month: 'long', year: 'numeric' });

  let cola = '';
  if (dias >= 14) {
    cola = t2('enl.viejo',
      ' — hace {d} días que no se apunta nada, así que lo que se ve aquí '
      + 'no está al día.', { d: dias });
  } else if (dias >= 3) {
    cola = t2('enl.hace', ' (hace {d} días).', { d: dias });
  } else {
    cola = '.';
  }

  el.textContent = t2('enl.hasta', 'Datos hasta el {f}', { f: cuando }) + cola;
}


/* ── Enseñar sólo lo compartido ───────────────────────────────
   No se llama a aplicarModulos(): invoca mostrarFormulario(), que
   vive en registros.js y aquí no está cargado. El bucle es esto. */
function aplicarLoCompartido() {
  document.querySelectorAll('[data-modulo]').forEach(el => {
    const visible = el.dataset.modulo.split(/\s+/).some(m => moduloActivo(m));
    el.style.display = visible ? '' : 'none';
  });
}


/* ── Arrancar ─────────────────────────────────────────────────── */
async function arrancarVisor() {
  /* Lo mismo que hace init() y por el mismo motivo: si no, el panel de
     24 h se pinta en el idioma del navegador mientras los títulos se
     quedan en el del HTML, y la página sale medio en un idioma y medio
     en otro. */
  aplicarIdioma();

  const token = window.TOKEN_ENLACE;

  if (!token) {
    fallo('no_valido');
    return;
  }

  let data, error;
  try {
    ({ data, error } = await sb.rpc('ver_enlace', { p_token: token }));
  } catch (e) {
    console.error(e);
    fallo('red');
    return;
  }

  if (error) { console.error(error); fallo('red'); return; }
  if (!data) { fallo('no_valido'); return; }
  if (data.error) { fallo(data.error); return; }

  /* Sin `id`, a propósito: si algo llegara por error a cargarDatos(),
     haría .eq('nino_id', undefined) y fallaría ruidosamente en vez de
     traerse algo que no toca. */
  ninoActivo = {
    nombre:           data.nino.nombre,
    fecha_nacimiento: data.nino.fecha_nacimiento,
    sexo:             data.nino.sexo
  };

  /* Hay que fijarlo SÍ O SÍ. modulos.js llama a resetModulos() al
     cargarse, que lo pone todo a true; sin esto, un enlace que no
     comparta la extracción dibujaría una gráfica vacía y, peor,
     tipoVisible() estiraría el eje X compartido hasta la última
     extracción y descuadraría las otras dos. */
  modulos = {
    peso:       !!data.ver.peso,
    panales:    !!data.ver.panales,
    extraccion: !!data.ver.extraccion,
    comida:     false,
    medicacion: false
  };

  registros = data.registros || [];
  registrosCargados = true;

  document.getElementById('visorTitulo').textContent = nombreHijo() || 'Tracking Álex';
  document.title = (nombreHijo() ? nombreHijo() + ' · ' : '') + 'Tracking Álex';

  document.getElementById('visorEstado').style.display = 'none';
  document.getElementById('visorContenido').style.display = '';

  aplicarLoCompartido();
  pintarHasta();

  /* El panel de 24 h sólo si el enlace lo comparte. La tarjeta es la
     primera de visorContenido; se busca por el contenedor del resumen
     para no depender de un id más. */
  if (!data.ver.resumen) {
    const panel = document.querySelector('[data-resumen]');
    if (panel) panel.closest('.card').style.display = 'none';
  }

  /* switchTab() pinta el resumen y las gráficas. No hay pestañas en
     esta página, pero la función es tolerante: si no encuentra el
     panel ni los botones, sigue adelante. Y deja tabActual en
     'graficas', que es lo que hace que el setInterval de refresco y
     el redibujado al girar el móvil —los dos viven fuera de init()—
     sigan funcionando aquí. */
  switchTab('graficas');
}

document.addEventListener('DOMContentLoaded', arrancarVisor);
