/* ═════════════════════════════════════════════════════════════
   ENLACES DE SÓLO LECTURA

   Para que los abuelos, la matrona o el pediatra puedan ver las
   gráficas sin tener cuenta. Recupera lo que hacía el antiguo
   `?modo=ver`, pero sin lo que tenía de malo: aquel funcionaba
   porque TODA la base de datos era de lectura pública.

   Aquí el cliente no lee la tabla `registros` sin sesión —no
   puede, no tiene permiso sobre ninguna tabla—. Lee a través de
   la función ver_enlace(), que decide qué sale y qué no. El
   detalle está en sql/enlaces.sql.

   Este fichero es sólo la parte de dentro: crear, listar, copiar
   y desactivar. La página que los abre es ver/index.html.
   ═════════════════════════════════════════════════════════════ */

/* El mismo alfabeto que las invitaciones: sin I, O, 0 ni 1, que son
   los que se confunden al leerlos en voz alta o al copiarlos a mano.
   22 caracteres × 5 bits = 110 bits.

   Ojo con la cuenta de entropía: son CARACTERES × 5, no bytes × 8.
   El código de invitación son 9 caracteres, o sea 45 bits, que está
   bien para algo que caduca en una semana y se usa una vez, y no lo
   estaría para un enlace que puede vivir meses. */
const ALFABETO_ENLACE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LARGO_TOKEN     = 22;

/* Tope por hijo. Va aquí y no en un disparador de la base de datos
   porque esto no es una regla de integridad, es evitar una lista
   inmanejable. */
const MAX_ENLACES = 10;

const CADUCIDADES = [
  { dias: 30,  txt: t('enl.30dias', '30 días') },
  { dias: 180, txt: t('enl.6meses', '6 meses') },
  { dias: 0,   txt: t('enl.nunca', 'No caduca') }
];

/* 6 meses por defecto. «No caduca» tiene que ser una decisión que
   alguien toma, no el camino de menor resistencia. */
const CADUCIDAD_DEFECTO = 180;


function tokenNuevo() {
  // b % 32 reparte sin sesgo porque 256 es múltiplo de 32.
  return Array.from(crypto.getRandomValues(new Uint8Array(LARGO_TOKEN)))
    .map(b => ALFABETO_ENLACE[b % 32]).join('');
}

/* La aplicación tiene que poder abrirse con doble clic (file://), y
   entonces location.origin es "null". En ese caso se usa el dominio
   de verdad: un enlace con origen "null" no le sirve a nadie. */
function urlEnlace(token) {
  const base = /^https?:$/.test(location.protocol)
    ? location.origin
    : 'https://trackingalex.app';
  return base + '/ver/#' + token;
}

/* Enmascarado para la lista. No aporta nada criptográfico —el botón
   de copiar se lleva el enlace entero— pero evita que una credencial
   quede legible en una captura de pantalla o a la vista de quien
   pase por detrás, que a esta escala es el riesgo de verdad. */
function tokenCorto(token) {
  return token.slice(0, 4) + '…' + token.slice(-4);
}

function queEnsena(e) {
  const partes = [];
  if (e.ver_peso)       partes.push(t('enl.q.peso', 'peso'));
  if (e.ver_panales)    partes.push(t('enl.q.panales', 'pañales'));
  if (e.ver_extraccion) partes.push(t('enl.q.ext', 'extracción'));
  if (e.ver_resumen)    partes.push(t('enl.q.resumen', 'resumen de 24 h'));
  return partes.join(', ');
}

function textoCaducidad(e) {
  if (!e.caduca_en) return t('enl.nunca', 'No caduca');
  const d = new Date(e.caduca_en);
  const dias = Math.ceil((d - Date.now()) / 864e5);
  if (dias <= 0) return t('enl.caducadoYa', 'Caducado');
  return t2('enl.caducaEn', 'Caduca en {d} {p}',
    { d: dias, p: plural(dias, 'día', 'días', 'dia') });
}

function textoUltimoAcceso(e) {
  if (!e.ultimo_acceso) return t('enl.sinAbrir', 'Sin abrir todavía');
  const dias = Math.floor((Date.now() - new Date(e.ultimo_acceso)) / 864e5);
  if (dias <= 0) return t('enl.vistoHoy', 'Visto hoy');
  if (dias === 1) return t('enl.vistoAyer', 'Visto ayer');
  return t2('enl.vistoHace', 'Visto hace {d} días', { d: dias });
}


/* ── Leer ─────────────────────────────────────────────────────── */
async function cargarEnlaces() {
  if (!ninoActivo) return [];
  const { data, error } = await sb.from('enlaces')
    .select('*')
    .eq('nino_id', ninoActivo.id)
    .is('revocado_en', null)
    .order('creado_en', { ascending: false });

  if (error) { console.error('No se pudieron leer los enlaces:', error); return null; }
  return data || [];
}

/* Se llama al final de abrirAjustes(), cuando el contenedor ya existe.
   La lista va aparte del innerHTML grande porque es una consulta, y
   abrirAjustes() no es asíncrona. */
async function pintarEnlaces() {
  const cont = document.getElementById('listaEnlaces');
  if (!cont) return;

  const lista = await cargarEnlaces();

  if (lista === null) {
    cont.innerHTML = '<p class="hint-txt" style="margin:0">'
                   + esc(t('enl.noCargan', 'No se han podido cargar.')) + '</p>';
    return;
  }

  if (!lista.length) {
    cont.innerHTML = '<p class="hint-txt" style="margin:0">' +
      esc(t('enl.ninguno', 'Ahora mismo no hay ningún enlace activo.')) + '</p>';
    return;
  }

  cont.innerHTML = lista.map(e => `
    <div class="modulo-fila" style="cursor:default;flex-direction:column;align-items:stretch;gap:8px">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">
        <strong>${esc(e.etiqueta || t('enl.sinNombre', 'Sin nombre'))}</strong>
        <span class="hint-txt" style="white-space:nowrap">${esc(textoCaducidad(e))}</span>
      </div>
      <p class="hint-txt" style="margin:0">
        ${esc(t('enl.ensena', 'Enseña:'))} ${esc(queEnsena(e))}<br>
        <span style="font-family:monospace">…/ver/#${esc(tokenCorto(e.token))}</span>
        · ${esc(textoUltimoAcceso(e))}
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secundario" style="flex:1"
                onclick="copiarEnlace('${esc(e.token)}')">📋 ${esc(t('enl.copiar', 'Copiar'))}</button>
        <button class="btn btn-secundario" style="flex:1;color:var(--danger);border-color:var(--danger)"
                data-revocar="${esc(e.id)}"
                onclick="revocarEnlace(this, '${esc(e.id)}')">${esc(t('enl.desactivar', 'Desactivar'))}</button>
      </div>
    </div>`).join('');
}


/* ── Crear ────────────────────────────────────────────────────── */
window.abrirNuevoEnlace = function() {
  if (!ninoActivo) return;

  const casilla = (clave, etiqueta) => moduloActivo(clave) ? `
    <label class="modulo-fila" style="margin-bottom:6px">
      <input type="checkbox" data-ver="${clave}" checked>
      <span>${esc(etiqueta)}</span>
    </label>` : '';

  document.getElementById('comidaModalTitulo').textContent = t('enl.tituloNuevo', '🔗 Compartir las gráficas');
  document.getElementById('comidaModalCuerpo').innerHTML = `
    <div class="field">
      <label for="enlEtiqueta">${t('enl.paraQuien', '¿Para quién es?')}</label>
      <input type="text" id="enlEtiqueta" maxlength="60" placeholder="${esc(t('enl.phEtiqueta', 'la abuela, la matrona…'))}">
      <p class="hint-txt" style="margin:8px 0 0">
        ${t('enl.etiquetaTxt', 'Es sólo para que sepas cuál desactivar después. '
          + 'No lo ve quien abra el enlace.')}
      </p>
    </div>

    <div class="field">
      <label>${t('enl.quePodra', '¿Qué podrá ver?')}</label>
      ${casilla('peso', t('enl.cPeso', '⚖️ Peso y percentiles'))}
      ${casilla('panales', t('enl.cPanales', '💧 Pañales'))}
      ${casilla('extraccion', t('enl.cExt', '🍼 Extracción de leche'))}
      <label class="modulo-fila" style="margin-bottom:0">
        <input type="checkbox" data-ver="resumen" checked>
        <span>${t('enl.cResumen', '🕐 El resumen de las últimas 24 h')}</span>
      </label>
    </div>

    <div class="field" style="margin-bottom:0">
      <label for="enlCaduca">${t('enl.cuanto', '¿Cuánto tiempo?')}</label>
      <select id="enlCaduca">
        ${CADUCIDADES.map(c => `<option value="${c.dias}"${
          c.dias === CADUCIDAD_DEFECTO ? ' selected' : ''}>${esc(c.txt)}</option>`).join('')}
      </select>
      <p class="hint-txt" style="margin:8px 0 0">
        <strong>Quien tenga el enlace entra, sin contraseña.</strong> No sale en
        Google y es imposible de adivinar, pero pásalo como pasarías una llave.
        Puedes desactivarlo cuando quieras.
      </p>
    </div>

    <p id="ajustesErr" class="error-txt" style="display:none"></p>`;

  document.getElementById('comidaModalBtns').innerHTML = `
    <button class="btn btn-primary" id="btnCrearEnlace"
            onclick="guardarEnlace()">${t('enl.crear', 'Crear el enlace')}</button>
    <button class="btn" onclick="abrirAjustes()"
            style="background:var(--surface2);color:var(--text)">← ${t('btn.volver', 'Volver')}</button>`;
};


window.guardarEnlace = async function() {
  const err = document.getElementById('ajustesErr');
  const btn = document.getElementById('btnCrearEnlace');
  err.style.display = 'none';

  const ver = { peso: false, panales: false, extraccion: false, resumen: false };
  document.querySelectorAll('#comidaModalCuerpo [data-ver]').forEach(cb => {
    ver[cb.dataset.ver] = cb.checked;
  });

  // Lo mismo que comprueba la base de datos con un CHECK: un enlace sin
  // ninguna gráfica está roto, porque el resumen solo no tiene de dónde
  // sacar los números.
  if (!ver.peso && !ver.panales && !ver.extraccion) {
    err.textContent = t('enl.eligeUna', 'Elige al menos una gráfica para compartir.');
    err.style.display = '';
    return;
  }

  const lista = await cargarEnlaces();
  if (lista && lista.length >= MAX_ENLACES) {
    err.textContent = `Ya hay ${MAX_ENLACES} enlaces activos. Desactiva alguno antes de crear otro.`;
    err.style.display = '';
    return;
  }

  const etiqueta = document.getElementById('enlEtiqueta').value.trim();
  const dias     = parseInt(document.getElementById('enlCaduca').value, 10);
  const token    = tokenNuevo();

  btn.disabled = true;
  btn.textContent = t('enl.creando', 'Creando…');

  // creado_por lo pone la base de datos con DEFAULT auth.uid(), y la
  // política del INSERT exige que sea justo ése.
  const { error } = await sb.from('enlaces').insert({
    nino_id:        ninoActivo.id,
    token,
    etiqueta:       etiqueta || null,
    ver_peso:       ver.peso,
    ver_panales:    ver.panales,
    ver_extraccion: ver.extraccion,
    ver_resumen:    ver.resumen,
    caduca_en:      dias ? new Date(Date.now() + dias * 864e5).toISOString() : null
  });

  btn.disabled = false;
  btn.textContent = t('enl.crear', 'Crear el enlace');

  if (error) {
    console.error(error);
    err.textContent = t('enl.noCreado', 'No se ha podido crear el enlace.');
    err.style.display = '';
    return;
  }

  mostrarEnlaceCreado(token, etiqueta);
};


/* Enseñarlo entero una vez, grande y con el botón de copiar al lado:
   es el momento en que la gente lo va a mandar. */
function mostrarEnlaceCreado(token, etiqueta) {
  const url = urlEnlace(token);

  document.getElementById('comidaModalTitulo').textContent = t('enl.creado', '✅ Enlace creado');
  document.getElementById('comidaModalCuerpo').innerHTML = `
    <div class="field">
      <p class="hint-txt" style="margin:0 0 10px">
        Ya puedes pasárselo${etiqueta ? ' a ' + esc(etiqueta) : ''}. Lo tienes
        siempre en ⚙️ Ajustes → Tus datos, por si lo pierdes.
      </p>
      <input type="text" id="enlUrl" readonly value="${esc(url)}"
             style="font-size:.85rem" onclick="this.select()">
      <button class="btn btn-primary" style="margin-top:8px"
              onclick="copiarEnlace('${esc(token)}')">📋 ${t('enl.copiarEnlace', 'Copiar el enlace')}</button>
    </div>

    <div class="field" style="margin-bottom:0">
      <p class="hint-txt" style="margin:0">
        Quien lo abra verá sólo las gráficas que has elegido. No puede apuntar
        nada, no ve el historial ni la comida ni las medicinas, y no sabe nada
        de ti ni de tu cuenta.
      </p>
    </div>`;

  document.getElementById('comidaModalBtns').innerHTML = `
    <button class="btn" onclick="abrirAjustes()"
            style="background:var(--surface2);color:var(--text)">← ${t('enl.volverAjustes', 'Volver a Ajustes')}</button>`;
}


/* ── Copiar ───────────────────────────────────────────────────── */
window.copiarEnlace = async function(token) {
  const url = urlEnlace(token);
  try {
    await navigator.clipboard.writeText(url);
    toast(t('enl.copiado', '📋 Enlace copiado'));
  } catch {
    // En file:// o sin permiso el portapapeles falla. Se enseña para
    // copiarlo a mano, igual que hace el resumen de alérgenos.
    const campo = document.getElementById('enlUrl');
    if (campo) { campo.select(); return; }
    document.getElementById('comidaModalTitulo').textContent = t('enl.copiaManual', 'Copia el enlace');
    document.getElementById('comidaModalCuerpo').innerHTML =
      `<textarea rows="3" readonly style="font-size:.8rem">${esc(url)}</textarea>`;
    document.getElementById('comidaModalBtns').innerHTML = `
      <button class="btn" onclick="abrirAjustes()"
              style="background:var(--surface2);color:var(--text)">← ${t('btn.volver', 'Volver')}</button>`;
  }
};


/* ── Desactivar ───────────────────────────────────────────────── */
/* Dos toques en vez de un confirm() del navegador: desactivar deja a
   alguien sin acceso y conviene no hacerlo de un resbalón, pero
   tampoco es el borrado de una cuenta como para montar un diálogo. */
window.revocarEnlace = async function(btn, id) {
  if (btn.dataset.seguro !== 'si') {
    btn.dataset.seguro = 'si';
    btn.textContent = t('enl.seguro', '¿Seguro?');
    setTimeout(() => {
      if (btn.isConnected && btn.dataset.seguro === 'si') {
        btn.dataset.seguro = '';
        btn.textContent = t('enl.desactivar', 'Desactivar');
      }
    }, 4000);
    return;
  }

  btn.disabled = true;
  btn.textContent = t('enl.desactivando', 'Desactivando…');

  // Se marca, no se borra: así quien abra el enlace lee «ya no está
  // activo» en vez de un error genérico.
  // .select() para detectar las cero filas: si RLS bloqueara el UPDATE,
  // Supabase no devuelve error, devuelve una lista vacía.
  const { data, error } = await sb.from('enlaces')
    .update({ revocado_en: new Date().toISOString() })
    .eq('id', id)
    .select();

  if (error || !data || !data.length) {
    console.error(error);
    toast(t('enl.noDesactivado', 'No se ha podido desactivar'));
    btn.disabled = false;
    btn.textContent = t('enl.desactivar', 'Desactivar');
    return;
  }

  toast(t('enl.desactivado', '🔒 Enlace desactivado'));
  pintarEnlaces();
};
