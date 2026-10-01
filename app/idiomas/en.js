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

  /* ── Botones generales ─────────────────────────────────────── */
  'btn.salir': 'Sign out'
};
