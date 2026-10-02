/* ═════════════════════════════════════════════════════════════
   ENGLISH

   Traducción incompleta a propósito. Lo que falte sale en español,
   que es el comportamiento que define t(): nada se rompe por una
   clave ausente.

   Para seguir traduciendo basta con añadir pares aquí. No hay que
   tocar ni una línea de lógica.

   Las claves acabadas en .one y .other las elige Intl.PluralRules
   con las reglas del idioma, no un `=== 1` escrito a mano.
   ═════════════════════════════════════════════════════════════ */

TEXTOS.en = {

  /* ── Plurales ──────────────────────────────────────────────── */
  'dia.one':       'day',
  'dia.other':     'days',
  'vez.one':       'time',
  'vez.other':     'times',
  'registro.one':  'entry',
  'registro.other':'entries',
  'hijo.one':      'child',
  'hijo.other':    'children',
  'pipi.one':      'wee',
  'pipi.other':    'wees',
  'caca.one':      'poo',
  'caca.other':    'poos',

  /* ── Entrada ───────────────────────────────────────────────── */
  'login.sub':       'Sign in to keep track of your baby',
  'login.google':    'Continue with Google',
  'login.separador': 'or with your email',
  'login.correo':    'Email address',
  'login.pwd':       'Password',
  'login.entrar':    'Sign in',
  'login.registro':  'Create an account',

  /* ── Pestañas ──────────────────────────────────────────────── */
  'tab.registrar': 'Log',
  'tab.graficas':  'Charts',
  'tab.medicacion':'Meds',
  'tab.comida':    'Food',
  'tab.historial': 'History',

  /* ── Resumen ───────────────────────────────────────────────── */
  'resumen.titulo': '🕐 Last 24 h',
  'resumen.desde':  'Since ',

  /* ── Plan ──────────────────────────────────────────────────── */
  'plan.prueba': 'Free trial: {n} {dias} left.',

  /* ── Ajustes ───────────────────────────────────────────────── */
  'ajustes.idioma': 'Language',

  /* ── Recuperar la contraseña ───────────────────────────────── */
  'login.olvide':    'Forgotten your password?',
  'recup.titulo':    'Choose a new password',
  'recup.sub':       'At least 8 characters',
  'recup.campo':     'New password',
  'recup.guardar':   'Save password',
  'recup.guardando': 'Saving…',
  'recup.falta':     'Type your email above and press again.',
  'recup.enviado':   'If that address has an account, you will get an email in a minute.',
  'recup.corta':     'At least 8 characters.',
  'recup.lista':     '✅ Password changed',

  /* ── Medicación ────────────────────────────────────────────── */
  'med.titulo':      'Medicines',
  'med.hoy':         'Right now',
  'med.nada':        'No dose is due right now.',
  'med.ahora':       'due now',
  'med.hace':        'overdue by',
  'med.luego':       'later',
  'med.ayer':        'yesterday',
  'med.dada':        'Given it',
  'med.dadaA':       'given at',
  'med.nodada':      'not given',
  'med.saltar':      'Record that it was not given',
  'med.deshacer':    'Undo',
  'med.verla':       'Open',
  'med.ahorano':     'Not now',
  'med.pospuesta':   'snoozed',
  'med.pospuesto':   '⌞ Reminding you in 30 min',
  'med.tu':          'you',
  'med.pareja':      'your partner',
  'med.tratamientos':'Treatments',
  'med.sinactivos':  'None under way.',
  'med.terminados':  'Finished treatments',
  'med.anadir':      'Add a medicine',
  'med.terminar':    'Stop now',
  'med.hasta':       'until',
  'med.terminaHoy':  'ends today',
  'med.termino':     'ended on',
  'med.empiezaManana':'starts tomorrow',
  'med.empiezaEl':   'starts on',
  'med.borrar':      'Delete',
  'med.horasBloqueadas':'There are doses logged against these times, so they are not edited here.',
  'med.atajoHecho':  '{n} doses a day, from {h}',
  'med.f.atajosAyuda':'Or spread the doses through the day from the first time:',
  'med.f.horasAyuda':'What counts is the list above: tap a time to remove it, or add any you like by hand.',
  'med.f.hastaAyuda':'Empty = no end date.',
  'med.sinfin':      'no end date',
  'med.cada':        'every',
  'med.aldia':       'a day',
  'med.guardada':    'added',
  'med.cambiarHoras':'change the times',
  'med.vacio.sub':   'No treatment yet',
  'med.vacio.txt':   'Write down what the doctor prescribed and at what times. When one of you marks a dose, the reminder disappears from the other phone.',
  'med.rehacerAviso':'The times of a running treatment are not edited: what you already logged would stop matching. This one ends today and the new one starts tomorrow.',
  'med.f.nombre':    'Medicine',
  'med.f.dosis':     'Dose',
  'med.f.dosisAyuda':'Exactly as the doctor told you. The app never works out doses.',
  'med.f.horas':     'Times of day',
  'med.f.anadirHora':'Add time',
  'med.f.quitar':    'Remove',
  'med.f.sinHoras':  'Add at least one time',
  'med.f.desde':     'Starts',
  'med.f.durante':   'For (days)',
  'med.f.duranteAyuda':'Leave it empty if there is no end date.',
  'med.f.hasta':     'Until',
  'med.f.nota':      'Note (optional)',
  'med.pie':         'Tracking Álex is not a medical device and only reminds you when you open it. For a dose that must not be missed, set your phone alarm too. Always follow your doctor’s instructions.',

  /* ── Fechas ───────────────────────────────────────── */
  'fecha.hoy':  'Today',
  'fecha.ayer': 'Yesterday',

  /* ── Enlaces de correo ─────────────────────────────────────── */
  'enlace.caducado': 'That link is no longer valid: it expired or had already been used. Ask for a new one.',
  'enlace.invalido': 'That link is not valid. Ask for a new one.',

  /* ── Botones generales ─────────────────────────────────────── */
  'btn.salir': 'Sign out'
};
