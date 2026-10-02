/* ═════════════════════════════════════════════════════════════
   LA PRIMERA VEZ

   Esta aplicación ha ido creciendo función a función delante de la
   familia que la usa. Quien llega nuevo no ha visto ese crecimiento:
   se encuentra cinco pestañas y un formulario, sin nada que le diga
   qué hay ni por dónde empezar.

   Dos piezas, y las dos pequeñas a propósito:

     · Una pantalla de bienvenida de cuatro líneas, al entrar.
     · Una lista de primeros pasos arriba de Registrar, que se tacha
       sola y se puede quitar de en medio.

   ── POR QUÉ NO SE GUARDA EL PROGRESO ──
   Un paso está hecho porque la cosa está hecha —hay registros, hay
   dos adultos—, no porque alguien pulsara un botón. Así no hay
   estado que se desincronice, que migrar, ni que arreglar cuando no
   cuadre con la realidad.

   ── POR QUÉ localStorage Y NO LA BASE DE DATOS ──
   Haber entendido cómo va esto es el estado de UNA PERSONA, no de la
   familia. En familia_ajustes, el primero que ocultara la lista se la
   quitaría al segundo, que es justo quien más la necesita.

   Y hay un motivo práctico: la ausencia de clave significa «no
   enseñar nada». La escribe el alta. Las familias que ya existían
   nunca pasaron por ese alta, así que no ven nada sin necesidad de
   tocar la base de datos en producción.

   Es la misma doctrina que ya está escrita en medicacion.js: lo que
   es de este móvil va a localStorage, lo que es de la familia va a
   familia_ajustes.
   ═════════════════════════════════════════════════════════════ */

const CLAVE_PASOS = 'primerosPasos';   // 'ver' | 'oculta' | (ausente)

let pasosHtmlAnterior = null;          // para no tocar el DOM sin motivo

function pasosEncendidos() {
  try { return localStorage.getItem(CLAVE_PASOS) === 'ver'; }
  catch (e) { return false; }
}

function encenderPrimerosPasos() {
  try { localStorage.setItem(CLAVE_PASOS, 'ver'); } catch (e) {}
}

function apagarPrimerosPasos() {
  try { localStorage.setItem(CLAVE_PASOS, 'oculta'); } catch (e) {}
}

window.ocultarPrimerosPasos = function() {
  apagarPrimerosPasos();
  renderPrimerosPasos();
  toast(t('pasos.ocultada', 'Hecho. Los tienes otra vez en ⚙️ Ajustes.'), 4000);
};

window.verPrimerosPasos = function() {
  // Si no queda nada pendiente, encenderla sería un botón muerto: la
  // lista se auto-oculta en cuanto se pinta, así que el usuario pulsaría
  // y no pasaría absolutamente nada. Mejor decirlo.
  if (familia && ninoActivo && registrosCargados && !pasosDe().some(p => !p.hecho)) {
    toast(t('pasos.yaEsta', '✅ Ya lo tienes todo hecho: no queda ningún paso.'), 4000);
    return;
  }

  encenderPrimerosPasos();
  cerrarComidaModal();
  switchTab('registrar');
  renderPrimerosPasos();
};


/* ─────────────────────────────────────────────────────────────
   LA PANTALLA DE BIENVENIDA

   Se enseña como un paso más del flujo de entrada, justo después de
   crear la familia o de unirse con un código. Al ser un momento y no
   un estado guardado, se ve COMO MUCHO una vez: si el navegador
   descarta la pestaña justo ahí, no se ve y no pasa nada. No hay nada
   construido encima de esa garantía.
   ───────────────────────────────────────────────────────────── */
function mostrarBienvenida() {
  const cont = document.getElementById('bienvenidaTexto');
  const nombre = ninoActivo ? ninoActivo.nombre : t('pasos.tubebe', 'tu bebé');

  if (cont) {
    cont.innerHTML = `
      <p class="card-sub" style="margin-bottom:18px">${esc(t2('bienv.1',
        'Aquí vas a apuntar el día a día de {n} en dos toques.', { n: nombre }))}</p>

      <p style="margin-bottom:18px;line-height:1.55">${t('bienv.2',
        '<strong>Lo que apuntes tú lo ve tu pareja al instante</strong>, así nadie tiene ' +
        'que preguntar si ya le habéis dado la medicina.')}</p>

      <p class="hint-txt" style="margin:0">${esc(t('bienv.3',
        'Abajo tienes las pestañas, y arriba una lista corta de primeros pasos.'))}</p>`;
  }
  pantalla('bienvenidaScreen');
}

window.terminarBienvenida = function() {
  mostrarApp();
};


/* ─────────────────────────────────────────────────────────────
   LOS PASOS

   Cada uno sabe si está hecho mirando los datos que ya están en
   memoria. Nada de consultas: esto se repinta muchas veces.
   ───────────────────────────────────────────────────────────── */
function pasosDe() {
  const nombre = ninoActivo ? ninoActivo.nombre : t('pasos.tubebe', 'tu bebé');
  const lista = [];

  // El primero nace tachado a propósito: una lista que empieza en cero
  // desanima, y la ficha está hecha de verdad.
  lista.push({
    hecho: true,
    txt: t2('pasos.ficha', 'La ficha de {n}, lista', { n: nombre }),
    ir: null
  });

  lista.push({
    hecho: registros.length > 0,
    txt: t('pasos.primero', 'Apunta lo primero'),
    ir: "switchTab('registrar')"
  });

  // Si ya sois dos, el paso no se tacha: desaparece. Enseñar un paso
  // que no se puede hacer y que ya está hecho es ruido en la pantalla
  // que existe para quitar ruido.
  if (adultosFamilia < 2) {
    lista.push({
      hecho: false,
      txt: t('pasos.pareja', 'Invita a tu pareja'),
      ir: 'abrirAjustes()'
    });
  }

  if (moduloActivo('peso')) {
    lista.push({
      hecho: registros.some(r => r.tipo === 'peso'),
      txt: t('pasos.peso', 'Apunta un peso y mira su percentil'),
      ir: "switchTab('graficas')"
    });
  }

  return lista;
}

function renderPrimerosPasos() {
  const cont = document.getElementById('primerosPasos');
  if (!cont) return;

  const fuera = () => {
    cont.style.display = 'none';
    cont.innerHTML = '';
    pasosHtmlAnterior = null;
  };

  if (!pasosEncendidos() || !familia || !ninoActivo) return fuera();

  // mostrarApp() llama a cargarDatos() sin await, así que hay un
  // instante con registros = []. Pintar ahí haría que un paso ya hecho
  // apareciera sin tachar y se tachara solo dos décimas después.
  if (!registrosCargados) return fuera();

  const lista = pasosDe();
  const faltan = lista.filter(p => !p.hecho).length;

  // Cuando no queda nada que hacer, se va sola. No hace falta que nadie
  // la despida a mano.
  if (!faltan) {
    apagarPrimerosPasos();
    toast(t('pasos.listo', '✅ Ya lo tienes todo en marcha'), 4000);
    return fuera();
  }

  const hechos = lista.length - faltan;

  const html = `
    <div class="card">
      <p class="card-title">👋 ${esc(t('pasos.titulo', 'Para empezar'))}</p>
      <p class="card-sub">${esc(t2('pasos.cuenta', '{a} de {b}',
        { a: hechos, b: lista.length }))}</p>

      <div class="check-list">
        ${lista.map(p => p.hecho ? `
          <div class="check-item sel">
            <span class="check-box">✓</span>
            <span style="flex:1">${esc(p.txt)}</span>
          </div>` : `
          <button type="button" class="check-item" onclick="${p.ir}">
            <span class="check-box"></span>
            <span style="flex:1">${esc(p.txt)}</span>
            <span aria-hidden="true">›</span>
          </button>`).join('')}
      </div>

      <p class="hint-txt" style="margin:14px 0 0">
        ${t('pasos.mas',
          '¿Echas algo en falta? Las <strong>medicinas</strong>, la <strong>comida</strong> ' +
          'y la <strong>extracción de leche</strong> se encienden cuando quieras en ')}<a
          href="#" onclick="event.preventDefault();abrirAjustes()">⚙️ ${esc(t('ajustes.titulo', 'Ajustes'))}</a>.
      </p>

      <p style="text-align:center;margin:12px 0 0">
        <a href="#" class="enlace-sutil"
           onclick="event.preventDefault();ocultarPrimerosPasos()"
           >${esc(t('pasos.ocultar', 'Ocultar esto'))}</a>
      </p>
    </div>`;

  // Esto se repinta cada vez que se repinta el resumen: al cargar datos,
  // al cambiar de pestaña, cada cinco minutos, en cada evento de tiempo
  // real. Tocar el DOM cuando no ha cambiado nada sería provocar un
  // reflow por gusto y perder el foco de lo que haya dentro.
  if (html === pasosHtmlAnterior) return;
  pasosHtmlAnterior = html;
  cont.innerHTML = html;
  cont.style.display = '';
}
