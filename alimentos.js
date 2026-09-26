/* ═════════════════════════════════════════════════════════════
   CATÁLOGO DE ALIMENTACIÓN COMPLEMENTARIA

   Datos puros, sin dependencias de otros ficheros (como oms.js).

   SOBRE EL ORDEN
   No existe un orden oficial de introducción. La AEP dice
   explícitamente que el orden NO importa, y AEPap reconoce que
   "aún no se dispone de guías unánimes". El campo `orden` es una
   sugerencia propia que prioriza el hierro (ESPGHAN: el lactante
   amamantado debe cubrir >90% del hierro con la complementaria)
   y mete los alérgenos pronto (ESPGHAN/LEAP: retrasarlos no
   previene alergias). La interfaz lo presenta como sugerencia.

   DOS NIVELES DE AVISO
   · desdeMeses  → madurez. Aviso suave, se registra sin fricción.
   · restriccion → seguridad (tóxicos, atragantamiento, infección).
                   Aviso fuerte con motivo y fuente. Se puede
                   registrar igualmente: la decisión es de los padres.

   CRITERIO PARA `desdeMeses`
   Para que no se descuadre al añadir alimentos nuevos:
     6 m  → se puede ofrecer desde el inicio con la textura adecuada.
            Es el valor por defecto, incluidos TODOS los alérgenos:
            retrasarlos no previene alergias (ESPGHAN, LEAP).
     9 m  → necesita más habilidad para masticar (calamar) o es un
            riesgo de atragantamiento que no se quita cortando
            (pepitas de granada).
     12 m → hay un motivo real: sal alta, o una `restriccion`.
     +    → lo que diga la restricción.

   Si un alimento está a 9 o 12 meses "porque suena prudente" pero
   no se puede escribir el motivo en una línea, va a 6.
   ═════════════════════════════════════════════════════════════ */


/* ── Restricciones de seguridad ──────────────────────────────
   `fuente` se muestra en la ficha. Cuando no ha sido posible
   verificar la fuente primaria, dice "Recomendación general" en
   vez de atribuirla a un organismo: no se le pone el nombre de
   una agencia a una cifra que no se ha podido comprobar.        */
const RESTRICCIONES = {
  mercurio: {
    edadMeses: 120,
    etiqueta: 'No antes de los 10 años',
    motivo: 'Mercurio. Son peces grandes y longevos, los que más acumulan. '
          + 'AESAN amplió el límite de 3 a 10 años tras detectar en población '
          + 'española concentraciones superiores a las de otros países europeos.',
    fuente: 'AESAN'
  },
  nitratos: {
    edadMeses: 12,
    etiqueta: 'No antes de los 12 meses',
    motivo: 'Nitratos. Después del año, que no pasen de 45 g/día y que no sean '
          + 'más del 20 % del puré.',
    fuente: 'AESAN'
  },
  botulismo: {
    edadMeses: 12,
    etiqueta: 'No antes de los 12 meses',
    motivo: 'Puede contener esporas de Clostridium botulinum. El intestino del '
          + 'lactante todavía no puede con ellas.',
    fuente: 'AEPap'
  },
  lecheVaca: {
    edadMeses: 12,
    etiqueta: 'No como bebida antes de los 12 meses',
    motivo: 'Desplaza a la leche materna o la fórmula y aporta poco hierro. '
          + 'En yogur o queso, en pequeña cantidad, sí desde los 6 meses.',
    fuente: 'AEPap'
  },
  lecheLigera: {
    edadMeses: 24,
    etiqueta: 'No antes de los 2 años',
    motivo: 'La desnatada y la semidesnatada llevan menos vitaminas liposolubles '
          + 'y menos grasa, que a esta edad hace falta.',
    fuente: 'AEPap'
  },
  arsenico: {
    edadMeses: 72,
    etiqueta: 'Mejor evitarlo en los primeros años',
    motivo: 'Arsénico inorgánico. El arroz lo acumula más que otros cereales, y '
          + 'los productos de arroz crudo (tortitas, bebidas) concentran más. '
          + 'El arroz cocido normal no tiene esta limitación.',
    fuente: 'Recomendación general (no se ha podido verificar la fuente primaria)'
  },
  cadmio: {
    edadMeses: 36,
    etiqueta: 'No antes de los 3 años',
    motivo: 'Cadmio, que se concentra en la cabeza del marisco y en el cuerpo de '
          + 'los cangrejos. La cola pelada no tiene este problema.',
    fuente: 'Recomendación general (no se ha podido verificar la fuente primaria)'
  },
  enteroAtragantamiento: {
    edadMeses: 60,
    etiqueta: 'Enteros no antes de los 5 años',
    motivo: 'Tamaño y forma de alto riesgo de atragantamiento. Molidos o en crema '
          + 'sí se pueden dar desde los 6 meses.',
    fuente: 'AEPap'
  },
  yodo: {
    edadMeses: 36,
    etiqueta: 'Mejor evitarlas',
    motivo: 'Cantidades muy altas y muy variables de yodo, que pueden alterar la '
          + 'función del tiroides.',
    fuente: 'Recomendación general'
  },
  nunca: {
    edadMeses: 9999,
    etiqueta: 'No añadir en el primer año',
    motivo: 'No aporta nada y acostumbra al sabor. La sal además sobrecarga el riñón.',
    fuente: 'AEPap / OMS'
  },
  sinValorNutritivo: {
    edadMeses: 24,
    etiqueta: 'Mejor evitarlo',
    motivo: 'Bebidas de escaso valor nutritivo: llenan sin alimentar y desplazan '
          + 'a la leche y a la comida. Las infusiones además pueden llevar azúcar '
          + 'y algunas plantas no son inocuas en lactantes.',
    fuente: 'AEPap'
  },
  azucarAnadido: {
    edadMeses: 24,
    etiqueta: 'Mejor evitarlo en los primeros años',
    motivo: 'Azúcar añadido. Que algo se venda como "de bebé" no lo hace adecuado: '
          + 'acostumbra al sabor dulce y favorece la caries.',
    fuente: 'AEPap / OMS'
  },
  embutidos: {
    edadMeses: 12,
    etiqueta: 'No antes de los 12 meses',
    motivo: 'Mucha sal y nitritos, y ningún nutriente que no dé la carne de verdad. '
          + 'Los curados y las lonchas enteras añaden riesgo de atragantamiento.',
    fuente: 'Recomendación general (no se ha podido verificar la fuente primaria)'
  },
  bebidaVegetal: {
    edadMeses: 12,
    etiqueta: 'No como sustituto de la leche antes de los 12 meses',
    motivo: 'No sustituyen a la leche materna ni a la fórmula: llevan muy poca '
          + 'proteína, grasa y calcio. En una receta puntual no pasa nada; como '
          + 'bebida principal, no.',
    fuente: 'AEPap'
  }
};


/* ── Alérgenos principales en lactantes ──────────────────────
   Son los que llevan ventana de 3 días. La evidencia (ESPGHAN,
   LEAP) dice que conviene introducirlos PRONTO y mantenerlos
   luego en la dieta con regularidad.                            */
const ALERGENOS = {
  huevo:      { nombre: 'Huevo' },
  leche:      { nombre: 'Leche de vaca' },
  gluten:     { nombre: 'Gluten' },
  cacahuete:  { nombre: 'Cacahuete' },
  frutosSecos:{ nombre: 'Frutos de cáscara' },
  pescado:    { nombre: 'Pescado' },
  crustaceos: { nombre: 'Crustáceos' },
  moluscos:   { nombre: 'Moluscos' },
  soja:       { nombre: 'Soja' },
  sesamo:     { nombre: 'Sésamo' },
  apio:       { nombre: 'Apio' },       // alérgeno oficial y muy común en caldos
  mostaza:    { nombre: 'Mostaza' },
  altramuces: { nombre: 'Altramuces' },
  sulfitos:   { nombre: 'Sulfitos' }
};
// Los 14 del reglamento europeo 1169/2011, completos. Crustáceos y
// moluscos van separados porque la UE los separa y porque no son lo
// mismo: se puede ser alérgico a las gambas y tolerar los mejillones.
// Los sulfitos son un aditivo y no un alimento, así que van colgados
// de la fruta desecada, que es donde un bebé se los encuentra.

const DIAS_VENTANA_ALERGENO = 3;   // la "regla de los 3 días"

// Cada cuántos días conviene repetir un alérgeno ya tolerado.
// LEAP: el efecto protector depende de seguir dándolo, no sólo
// de haberlo introducido una vez.
const DIAS_MANTENIMIENTO = 10;


/* ── Categorías ──────────────────────────────────────────────  */
const CATEGORIAS = {
  carne:      { nombre: 'Carne',        emoji: '🥩' },
  pescado:    { nombre: 'Pescado',      emoji: '🐟' },
  huevo:      { nombre: 'Huevo',        emoji: '🥚' },
  legumbre:   { nombre: 'Legumbres',    emoji: '🥫' },   // 🫘 no se dibuja en Windows
  cereal:     { nombre: 'Cereales',     emoji: '🌾' },
  verdura:    { nombre: 'Verduras',     emoji: '🥦' },
  fruta:      { nombre: 'Frutas',       emoji: '🍎' },
  lacteo:     { nombre: 'Lácteos',      emoji: '🧀' },
  frutosecos: { nombre: 'Frutos secos', emoji: '🥜' },
  otros:      { nombre: 'Otros',        emoji: '🥄' }    // 🫒 no se dibuja en Windows
};


/* ── El catálogo ─────────────────────────────────────────────
   { id, nombre, cat, hierro, alergeno, desdeMeses, restriccion,
     blw, cuchara, atragantamiento, nota, orden }                */
const ALIMENTOS = [

  /* ── Primeros alimentos: hierro y facilidad ───────────────── */
  { id:'ternera', nombre:'Ternera', cat:'carne', hierro:'alto', desdeMeses:6, orden:1,
    blw:'Tira del grosor de un dedo adulto, guisada hasta que se deshaga sola.',
    cuchara:'Triturada con patata o calabaza y un chorro de aceite de oliva.' },

  { id:'aguacate', nombre:'Aguacate', cat:'fruta', hierro:null, desdeMeses:6, orden:2,
    blw:'Gajos gruesos, maduro. Si resbala, rebózalo en copos de avena molidos.',
    cuchara:'Chafado con un tenedor, solo o con plátano.' },

  { id:'boniato', nombre:'Boniato', cat:'verdura', hierro:null, desdeMeses:6, orden:3,
    blw:'Bastones asados o al vapor, blandos pero que no se deshagan al cogerlos.',
    cuchara:'Cocido y chafado. Va bien para suavizar la carne.' },

  { id:'pollo', nombre:'Pollo', cat:'carne', hierro:'medio', desdeMeses:6, orden:4,
    blw:'Muslo deshilachado, o una tira del contramuslo bien cocido.',
    cuchara:'Triturado con verdura. La pechuga sola queda seca.' },

  { id:'lentejas', nombre:'Lentejas', cat:'legumbre', hierro:'alto', desdeMeses:6, orden:5,
    blw:'Muy cocidas y chafadas, en forma de hamburguesita o sobre una tostada.',
    cuchara:'Trituradas con arroz o verdura.',
    nota:'Con algo de vitamina C (tomate, pimiento, naranja de postre) se absorbe '
       + 'bastante más hierro.' },

  { id:'platano', nombre:'Plátano', cat:'fruta', hierro:null, desdeMeses:6, orden:6,
    blw:'Medio plátano pelado dejando un trozo de piel como asa.',
    cuchara:'Chafado con tenedor.' },

  { id:'calabaza', nombre:'Calabaza', cat:'verdura', hierro:null, desdeMeses:6, orden:7,
    blw:'Bastones asados. Muy blanda, agárrala tú al principio.',
    cuchara:'Cocida y triturada.' },

  { id:'pera', nombre:'Pera', cat:'fruta', hierro:null, desdeMeses:6, orden:8,
    blw:'Muy madura, en gajos. Si está dura, al vapor un par de minutos.',
    cuchara:'Rallada o chafada.' },

  { id:'brocoli', nombre:'Brócoli', cat:'verdura', hierro:null, desdeMeses:6, orden:9,
    blw:'Un árbol entero cocido, con el tallo largo para que lo agarre.',
    cuchara:'Cocido y triturado con patata.' },

  { id:'avena', nombre:'Avena', cat:'cereal', hierro:'medio', alergeno:'gluten', desdeMeses:6, orden:10,
    blw:'Gachas espesas, o tortitas de avena y plátano en tiras.',
    cuchara:'Con leche materna o de fórmula, sin azúcar.',
    nota:'La avena en sí no tiene gluten, pero casi siempre se contamina en el '
       + 'molino. Cuenta como introducción de gluten salvo que sea certificada.' },

  /* ── Alérgenos, cuanto antes mejor ────────────────────────── */
  { id:'huevo', nombre:'Huevo entero', cat:'huevo', hierro:'medio', alergeno:'huevo', desdeMeses:6, orden:11,
    blw:'Tortilla francesa cuajada, en tiras. O huevo duro en gajos.',
    cuchara:'Duro y chafado con aguacate o patata.',
    nota:'Siempre bien cocinado, yema incluida, por la salmonela. Nada de huevo '
       + 'crudo ni poco hecho (mayonesa casera, merengue, tortilla babosa).' },

  { id:'crema-cacahuete', nombre:'Crema de cacahuete', cat:'frutosecos', hierro:null, alergeno:'cacahuete', desdeMeses:6, orden:12,
    blw:'Capa MUY fina sobre una tira de tostada. Nunca a cucharadas.',
    cuchara:'Una cucharadita diluida en yogur, papilla o agua tibia.',
    atragantamiento:'Espesa y pegajosa, se pega al paladar. Siempre diluida o en '
                  + 'capa fina, jamás un pegote.',
    nota:'Si Álex tuviera eczema grave o alergia al huevo ya conocida, LEAP indica '
       + 'consultarlo con la pediatra antes de introducirlo, no por libre.' },

  { id:'pan', nombre:'Pan', cat:'cereal', hierro:'medio', alergeno:'gluten', desdeMeses:6, orden:13,
    blw:'Tostado y en tiras: blando se le hace una bola en la boca.',
    cuchara:'Migas en el puré o sopas de pan.',
    nota:'Sin sal. El pan normal de panadería lleva bastante.' },

  { id:'yogur', nombre:'Yogur natural entero', cat:'lacteo', hierro:null, alergeno:'leche', desdeMeses:6, orden:14,
    blw:'En un cuenco con cuchara precargada, o para mojar tiras de fruta.',
    cuchara:'Tal cual, sin azúcar ni miel.',
    nota:'Natural entero, no de sabores ni azucarado. Nada de "yogures para bebés" '
       + 'azucarados.' },

  { id:'merluza', nombre:'Merluza', cat:'pescado', hierro:'medio', alergeno:'pescado', desdeMeses:6, orden:15,
    blw:'Lomo al vapor en trozos grandes, revisado espina a espina.',
    cuchara:'Desmenuzada con patata y aceite de oliva.',
    atragantamiento:'Las espinas. Revisa el lomo con los dedos antes de dárselo.' },

  { id:'tahini', nombre:'Tahini (sésamo)', cat:'frutosecos', hierro:'medio', alergeno:'sesamo', desdeMeses:6, orden:16,
    blw:'Capa fina sobre tostada, o mezclado en el hummus.',
    cuchara:'Una cucharadita diluida en el puré.',
    atragantamiento:'Igual que la crema de cacahuete: diluido o en capa fina.' },

  { id:'almendra-molida', nombre:'Almendra molida', cat:'frutosecos', hierro:'medio', alergeno:'frutosSecos', desdeMeses:6, orden:17,
    blw:'Espolvoreada sobre fruta o yogur, o en tortitas.',
    cuchara:'Una cucharadita en el puré o el yogur.',
    nota:'Molida fina o en crema. Enteras, ni pensarlo hasta los 5 años.' },

  { id:'tofu', nombre:'Tofu', cat:'legumbre', hierro:'medio', alergeno:'soja', desdeMeses:6, orden:18,
    blw:'Tofu firme en bastones, marcado en la sartén para que no resbale.',
    cuchara:'Chafado con verdura.' },

  /* ── Más carne y hierro ───────────────────────────────────── */
  { id:'pavo', nombre:'Pavo', cat:'carne', hierro:'medio', desdeMeses:6, orden:20,
    blw:'Deshilachado o en tira fina del muslo.',
    cuchara:'Triturado con verdura y aceite.' },

  { id:'cordero', nombre:'Cordero', cat:'carne', hierro:'alto', desdeMeses:6, orden:21,
    blw:'Chuleta con el hueso para agarrar, carne bien hecha y tierna.',
    cuchara:'Guisado y triturado.' },

  { id:'cerdo', nombre:'Cerdo (lomo)', cat:'carne', hierro:'medio', desdeMeses:6, orden:22,
    blw:'Tira de lomo guisado hasta que se deshaga.',
    cuchara:'Triturado con patata.' },

  { id:'conejo', nombre:'Conejo', cat:'carne', hierro:'medio', desdeMeses:6, orden:23,
    blw:'Deshilachado, revisando que no queden huesecillos.',
    cuchara:'Triturado con verdura.',
    atragantamiento:'Tiene huesos pequeños y astillables. Repásalo bien.' },

  { id:'higado', nombre:'Hígado', cat:'carne', hierro:'alto', desdeMeses:6, orden:24,
    blw:'Cocido y chafado sobre una tostada.',
    cuchara:'Una cucharadita mezclada en el puré de carne.',
    nota:'Es la fuente de hierro más potente que hay, pero lleva muchísima '
       + 'vitamina A: no más de una vez por semana.' },

  { id:'ternera-picada', nombre:'Carne picada', cat:'carne', hierro:'alto', desdeMeses:6, orden:25,
    blw:'En albóndiga alargada o hamburguesita blanda, no suelta.',
    cuchara:'Salteada y triturada con verdura.',
    atragantamiento:'Suelta se dispersa por la boca. Mejor compactada.' },

  /* ── Legumbres ────────────────────────────────────────────── */
  { id:'garbanzos', nombre:'Garbanzos', cat:'legumbre', hierro:'alto', desdeMeses:6, orden:26,
    blw:'Muy cocidos y chafados, o en hummus sobre tostada.',
    cuchara:'Triturados con verdura.',
    atragantamiento:'Enteros son redondos y duros: chafa siempre.' },

  { id:'hummus', nombre:'Hummus', cat:'legumbre', hierro:'alto', alergeno:'sesamo', desdeMeses:6, orden:27,
    blw:'Para mojar tiras de pan o de verdura.',
    cuchara:'Tal cual, una cucharadita.',
    nota:'Casero y sin sal. Lleva tahini, así que cuenta como sésamo.' },

  { id:'alubias', nombre:'Alubias', cat:'legumbre', hierro:'alto', desdeMeses:6, orden:28,
    blw:'Muy cocidas y chafadas.',
    cuchara:'Trituradas y pasadas por el chino si la piel molesta.' },

  { id:'guisantes', nombre:'Guisantes', cat:'legumbre', hierro:'medio', desdeMeses:6, orden:29,
    blw:'Chafados uno a uno, nunca enteros.',
    cuchara:'Triturados con patata.',
    atragantamiento:'Redondos y del tamaño justo de la vía aérea. Chafar siempre.' },

  /* ── Cereales ─────────────────────────────────────────────── */
  { id:'arroz', nombre:'Arroz', cat:'cereal', hierro:null, desdeMeses:6, orden:30,
    blw:'Arroz redondo pasado de cocción, en bolitas que pueda coger.',
    cuchara:'Hervido y chafado con caldo.',
    nota:'El arroz cocido normal no tiene problema. Lo que conviene limitar son '
       + 'las tortitas y las bebidas de arroz.' },

  { id:'cereales-hierro', nombre:'Cereales fortificados con hierro', cat:'cereal', hierro:'alto', alergeno:'gluten', desdeMeses:6, orden:31,
    blw:'Espesos, sobre tostada o en tortita.',
    cuchara:'Con leche materna o de fórmula.',
    nota:'ESPGHAN los menciona junto a la carne como vía para cubrir el hierro. '
       + 'Mira que no lleven azúcar añadido.' },

  { id:'maiz', nombre:'Maíz', cat:'cereal', hierro:null, desdeMeses:6, orden:32,
    blw:'Mazorca cocida para que la roa, o granos chafados.',
    cuchara:'Triturado.',
    atragantamiento:'Los granos enteros: chafa o tritura hasta el año.' },

  { id:'quinoa', nombre:'Quinoa', cat:'cereal', hierro:'medio', desdeMeses:6, orden:33,
    blw:'Compactada en bolitas o mezclada con verdura chafada.',
    cuchara:'Bien cocida y chafada.' },

  { id:'pasta', nombre:'Pasta', cat:'cereal', hierro:'medio', alergeno:'gluten', desdeMeses:6, orden:34,
    blw:'Formas grandes (espirales, lazos) muy cocidas, fáciles de agarrar.',
    cuchara:'Cortada pequeña con salsa de verdura.' },

  { id:'cuscus', nombre:'Cuscús', cat:'cereal', hierro:'medio', alergeno:'gluten', desdeMeses:6, orden:35,
    blw:'Compactado con verdura en bolitas.',
    cuchara:'Hidratado y mezclado.' },

  /* ── Verduras ─────────────────────────────────────────────── */
  { id:'patata', nombre:'Patata', cat:'verdura', hierro:null, desdeMeses:6, orden:40,
    blw:'Bastones asados, o cocida en gajos gruesos.',
    cuchara:'Cocida y chafada con aceite de oliva.' },

  { id:'calabacin', nombre:'Calabacín', cat:'verdura', hierro:null, desdeMeses:6, orden:41,
    blw:'Bastones al vapor con la piel, que ayuda a que no se deshaga.',
    cuchara:'Cocido y triturado.' },

  { id:'zanahoria', nombre:'Zanahoria', cat:'verdura', hierro:null, desdeMeses:6, orden:42,
    blw:'Bastón cocido hasta que se chafe con los dedos. Cruda no.',
    cuchara:'Cocida y triturada.',
    atragantamiento:'Cruda es de los alimentos con más riesgo: dura y cilíndrica. '
                  + 'Siempre cocida o rallada fina en el primer año.' },

  { id:'judia-verde', nombre:'Judía verde', cat:'verdura', hierro:null, desdeMeses:6, orden:43,
    blw:'Vaina entera cocida, sin hilos.',
    cuchara:'Cocida y triturada.' },

  { id:'coliflor', nombre:'Coliflor', cat:'verdura', hierro:null, desdeMeses:6, orden:44,
    blw:'Ramillete cocido con el tallo como mango.',
    cuchara:'Cocida y triturada con patata.' },

  { id:'puerro', nombre:'Puerro', cat:'verdura', hierro:null, desdeMeses:6, orden:45,
    blw:'Sólo la parte blanca, muy cocida y en tiras.',
    cuchara:'En crema con patata.' },

  { id:'cebolla', nombre:'Cebolla', cat:'verdura', hierro:null, desdeMeses:6, orden:46,
    blw:'Pochada hasta que esté dulce y blanda.',
    cuchara:'Como base del sofrito del puré.' },

  { id:'tomate', nombre:'Tomate', cat:'verdura', hierro:null, desdeMeses:6, orden:47,
    blw:'Pelado y sin semillas, en gajos gruesos.',
    cuchara:'Triturado en salsa sin sal.',
    nota:'La vitamina C del tomate ayuda a absorber el hierro de la legumbre.' },

  { id:'pimiento', nombre:'Pimiento', cat:'verdura', hierro:null, desdeMeses:6, orden:48,
    blw:'Asado y pelado, en tiras.',
    cuchara:'Asado y triturado.' },

  { id:'berenjena', nombre:'Berenjena', cat:'verdura', hierro:null, desdeMeses:6, orden:49,
    blw:'Asada en bastones, sin piel.',
    cuchara:'Asada y chafada.' },

  { id:'alcachofa', nombre:'Alcachofa', cat:'verdura', hierro:'medio', desdeMeses:6, orden:50,
    blw:'Corazón cocido en gajos.',
    cuchara:'Cocida y triturada.' },

  { id:'esparrago', nombre:'Espárrago', cat:'verdura', hierro:null, desdeMeses:6, orden:51,
    blw:'Cocido, la parte tierna de la punta.',
    cuchara:'Cocido y triturado.' },

  { id:'champinon', nombre:'Champiñón', cat:'verdura', hierro:'medio', desdeMeses:6, orden:52,
    blw:'Salteado y cortado en cuartos, no entero.',
    cuchara:'Salteado y triturado.',
    atragantamiento:'Entero es resbaladizo y del tamaño justo. Corta siempre.' },

  { id:'pepino', nombre:'Pepino', cat:'verdura', hierro:null, desdeMeses:6, orden:53,
    blw:'Bastones pelados. Frío va bien cuando le salen los dientes.',
    cuchara:'Rallado.' },

  { id:'lechuga', nombre:'Lechuga', cat:'verdura', hierro:null, desdeMeses:12, orden:54,
    blw:'Hojas tiernas cortadas pequeñas.',
    cuchara:'Picada muy fina en el plato.',
    nota:'Las hojas grandes se pegan al paladar; córtalas.' },

  { id:'espinacas', nombre:'Espinacas', cat:'verdura', hierro:'medio', desdeMeses:12,
    restriccion:'nitratos', orden:55,
    blw:'Cocidas y bien escurridas, mezcladas en una tortilla.',
    cuchara:'Cocidas y trituradas, como parte menor del puré.' },

  { id:'acelgas', nombre:'Acelgas', cat:'verdura', hierro:'medio', desdeMeses:12,
    restriccion:'nitratos', orden:56,
    blw:'Penca cocida en bastones.',
    cuchara:'Cocidas y trituradas con patata.' },

  { id:'borraja', nombre:'Borraja', cat:'verdura', hierro:null, desdeMeses:12,
    restriccion:'nitratos', orden:57,
    blw:'Penca cocida en bastones.',
    cuchara:'Cocida y triturada.' },

  { id:'remolacha', nombre:'Remolacha', cat:'verdura', hierro:'medio', desdeMeses:12,
    restriccion:'nitratos', orden:58,
    blw:'Cocida en bastones. Mancha muchísimo.',
    cuchara:'Cocida y triturada.',
    nota:'Puede teñir el pipí y la caca de rojo. Es normal y no es sangre.' },

  /* ── Frutas ───────────────────────────────────────────────── */
  { id:'manzana', nombre:'Manzana', cat:'fruta', hierro:null, desdeMeses:6, orden:60,
    blw:'Al vapor o asada en gajos. Cruda no en el primer año.',
    cuchara:'Rallada o en compota sin azúcar.',
    atragantamiento:'Cruda y dura es de los alimentos de más riesgo. Cocerla o '
                  + 'rallarla muy fina.' },

  { id:'melocoton', nombre:'Melocotón', cat:'fruta', hierro:null, desdeMeses:6, orden:61,
    blw:'Maduro, pelado, en gajos gruesos.',
    cuchara:'Chafado.' },

  { id:'nectarina', nombre:'Nectarina', cat:'fruta', hierro:null, desdeMeses:6, orden:62,
    blw:'Madura y pelada, en gajos.',
    cuchara:'Chafada.' },

  { id:'ciruela', nombre:'Ciruela', cat:'fruta', hierro:null, desdeMeses:6, orden:63,
    blw:'Madura, sin hueso, en mitades o cuartos.',
    cuchara:'Chafada.',
    nota:'Va muy bien si anda estreñido.' },

  { id:'albaricoque', nombre:'Albaricoque', cat:'fruta', hierro:null, desdeMeses:6, orden:64,
    blw:'Maduro, sin hueso, en mitades.',
    cuchara:'Chafado.' },

  { id:'mango', nombre:'Mango', cat:'fruta', hierro:null, desdeMeses:6, orden:65,
    blw:'Gajos gruesos. Resbala mucho: deja algo de piel como asa.',
    cuchara:'Chafado.' },

  { id:'papaya', nombre:'Papaya', cat:'fruta', hierro:null, desdeMeses:6, orden:66,
    blw:'Gajos, muy blanda de por sí.',
    cuchara:'Chafada.' },

  { id:'sandia', nombre:'Sandía', cat:'fruta', hierro:null, desdeMeses:6, orden:67,
    blw:'Triángulos gruesos sin pepitas.',
    cuchara:'Chafada.' },

  { id:'melon', nombre:'Melón', cat:'fruta', hierro:null, desdeMeses:6, orden:68,
    blw:'Gajos gruesos, maduro.',
    cuchara:'Chafado.' },

  { id:'naranja', nombre:'Naranja', cat:'fruta', hierro:null, desdeMeses:6, orden:69,
    blw:'Gajos pelados, sin la telilla ni pepitas.',
    cuchara:'Zumo natural mejor no: la fruta entera.',
    nota:'Su vitamina C multiplica la absorción del hierro de legumbres y cereales. '
       + 'Buen postre tras las lentejas.' },

  { id:'mandarina', nombre:'Mandarina', cat:'fruta', hierro:null, desdeMeses:6, orden:70,
    blw:'Gajos sin telilla ni pepitas.',
    cuchara:'Chafada.' },

  { id:'fresa', nombre:'Fresa', cat:'fruta', hierro:null, desdeMeses:6, orden:71,
    blw:'Grandes y maduras, enteras sin el rabo, o en mitades a lo largo.',
    cuchara:'Chafada.',
    atragantamiento:'Las pequeñas enteras son de riesgo: córtalas a lo largo.' },

  { id:'kiwi', nombre:'Kiwi', cat:'fruta', hierro:null, desdeMeses:6, orden:72,
    blw:'Maduro, pelado, en gajos.',
    cuchara:'Chafado.' },

  { id:'arandanos', nombre:'Arándanos', cat:'fruta', hierro:null, desdeMeses:6, orden:73,
    blw:'Chafados o cortados por la mitad, nunca enteros.',
    cuchara:'Chafados en el yogur.',
    atragantamiento:'Redondos y del tamaño de la vía aérea. Cortar siempre.' },

  { id:'frambuesa', nombre:'Frambuesa', cat:'fruta', hierro:null, desdeMeses:6, orden:74,
    blw:'Enteras, se deshacen solas en la boca.',
    cuchara:'Chafadas.' },

  { id:'higo', nombre:'Higo', cat:'fruta', hierro:'medio', desdeMeses:6, orden:75,
    blw:'Maduro, pelado, en cuartos.',
    cuchara:'Chafado.' },

  { id:'pina', nombre:'Piña', cat:'fruta', hierro:null, desdeMeses:6, orden:76,
    blw:'Madura, en tiras largas sin el corazón duro.',
    cuchara:'Triturada.' },

  { id:'uva', nombre:'Uva', cat:'fruta', hierro:null, desdeMeses:6, orden:77,
    blw:'Cortada a lo LARGO en cuartos, nunca entera ni en rodajas.',
    cuchara:'Chafada sin piel.',
    atragantamiento:'Es el alimento que más atragantamientos graves causa en niños. '
                  + 'Cortada a lo largo en cuatro, hasta los 4-5 años.' },

  { id:'cereza', nombre:'Cereza', cat:'fruta', hierro:null, desdeMeses:6, orden:78,
    blw:'Sin hueso y cortada a lo largo en cuartos.',
    cuchara:'Chafada sin hueso.',
    atragantamiento:'Mismo riesgo que la uva, y además el hueso.' },

  { id:'granada', nombre:'Granada', cat:'fruta', hierro:'medio', desdeMeses:9, orden:79,
    blw:'Granos chafados, no enteros.',
    cuchara:'Chafada y colada.',
    atragantamiento:'Los granos enteros son pequeños y duros.' },

  /* ── Pescado ──────────────────────────────────────────────── */
  { id:'lenguado', nombre:'Lenguado', cat:'pescado', hierro:'medio', alergeno:'pescado', desdeMeses:6, orden:80,
    blw:'Al vapor en trozos, revisado de espinas.',
    cuchara:'Desmenuzado con patata.' },

  { id:'rape', nombre:'Rape', cat:'pescado', hierro:'medio', alergeno:'pescado', desdeMeses:6, orden:81,
    blw:'En dados, es firme y se sujeta bien.',
    cuchara:'Desmenuzado.',
    nota:'Casi sin espinas, buena opción para empezar.' },

  { id:'bacalao', nombre:'Bacalao fresco', cat:'pescado', hierro:'medio', alergeno:'pescado', desdeMeses:6, orden:82,
    blw:'Lomo al vapor en lascas grandes.',
    cuchara:'Desmenuzado con patata.',
    nota:'Fresco o bien desalado. El salado lleva muchísima sal.' },

  { id:'dorada', nombre:'Dorada', cat:'pescado', hierro:'medio', alergeno:'pescado', desdeMeses:6, orden:83,
    blw:'Lomo al horno, revisado de espinas.',
    cuchara:'Desmenuzada.' },

  { id:'lubina', nombre:'Lubina', cat:'pescado', hierro:'medio', alergeno:'pescado', desdeMeses:6, orden:84,
    blw:'Lomo al horno en trozos.',
    cuchara:'Desmenuzada.' },

  { id:'salmon', nombre:'Salmón', cat:'pescado', hierro:'medio', alergeno:'pescado', desdeMeses:6, orden:85,
    blw:'Lomo al horno en tiras, sin piel ni espinas.',
    cuchara:'Desmenuzado.',
    nota:'Azul pequeño: omega-3 para el desarrollo del cerebro y sin el problema '
       + 'de mercurio de los peces grandes.' },

  { id:'sardina', nombre:'Sardina', cat:'pescado', hierro:'alto', alergeno:'pescado', desdeMeses:6, orden:86,
    blw:'A la plancha, abierta y desespinada con cuidado.',
    cuchara:'Desmenuzada en el puré.',
    atragantamiento:'Muchas espinas finas. Repásala dos veces.' },

  { id:'boqueron', nombre:'Boquerón', cat:'pescado', hierro:'medio', alergeno:'pescado', desdeMeses:6, orden:87,
    blw:'Cocinado, abierto y desespinado.',
    cuchara:'Desmenuzado.',
    nota:'Cocinado, nunca en vinagre: el boquerón crudo puede llevar anisakis.' },

  { id:'caballa', nombre:'Caballa', cat:'pescado', hierro:'medio', alergeno:'pescado', desdeMeses:6, orden:88,
    blw:'Lomo a la plancha, desespinado.',
    cuchara:'Desmenuzada.' },

  { id:'bonito', nombre:'Bonito del norte', cat:'pescado', hierro:'medio', alergeno:'pescado', desdeMeses:6, orden:89,
    blw:'En lascas, bien cocinado.',
    cuchara:'Desmenuzado.',
    nota:'El bonito y el atún claro no están en la lista de mercurio. El que hay '
       + 'que evitar es el atún ROJO.' },

  { id:'gambas', nombre:'Gambas y langostinos', cat:'pescado', hierro:'medio', alergeno:'crustaceos', desdeMeses:6, orden:90,
    blw:'Cola pelada, bien cocida, cortada a lo largo.',
    cuchara:'Picada muy fina.',
    atragantamiento:'La textura elástica cuesta de masticar. Corta pequeño.',
    nota:'Sólo la cola. La cabeza, no: ahí se concentra el cadmio.' },

  { id:'mejillones', nombre:'Mejillones y almejas', cat:'pescado', hierro:'alto', alergeno:'moluscos', desdeMeses:6, orden:91,
    blw:'Bien cocidos y picados, no enteros.',
    cuchara:'Picados muy finos.',
    atragantamiento:'Elásticos y resbaladizos. Picar siempre.' },

  { id:'calamar', nombre:'Calamar y pulpo', cat:'pescado', hierro:'medio', alergeno:'moluscos', desdeMeses:9, orden:92,
    blw:'Muy cocido y en tiras finas.',
    cuchara:'Picado fino.',
    atragantamiento:'De los alimentos más elásticos que hay. Cocción larga y trozo '
                  + 'pequeño.' },

  { id:'cabezas-marisco', nombre:'Cabezas de marisco', cat:'pescado', hierro:null, alergeno:'crustaceos',
    desdeMeses:36, restriccion:'cadmio', orden:93,
    blw:'—', cuchara:'—' },

  { id:'pez-espada', nombre:'Pez espada / emperador', cat:'pescado', hierro:'medio', alergeno:'pescado',
    desdeMeses:120, restriccion:'mercurio', orden:94,
    blw:'—', cuchara:'—' },

  { id:'atun-rojo', nombre:'Atún rojo', cat:'pescado', hierro:'alto', alergeno:'pescado',
    desdeMeses:120, restriccion:'mercurio', orden:95,
    blw:'—', cuchara:'—' },

  { id:'tiburon', nombre:'Tiburón (cazón, marrajo, tintorera)', cat:'pescado', hierro:'medio', alergeno:'pescado',
    desdeMeses:120, restriccion:'mercurio', orden:96,
    blw:'—', cuchara:'—' },

  { id:'lucio', nombre:'Lucio', cat:'pescado', hierro:'medio', alergeno:'pescado',
    desdeMeses:120, restriccion:'mercurio', orden:97,
    blw:'—', cuchara:'—' },

  /* ── Huevo y lácteos ──────────────────────────────────────── */
  { id:'tortilla', nombre:'Tortilla', cat:'huevo', hierro:'medio', alergeno:'huevo', desdeMeses:6, orden:100,
    blw:'Cuajada del todo, en tiras.',
    cuchara:'Chafada.',
    nota:'Bien cuajada, nada de tortilla poco hecha.' },

  { id:'queso-fresco', nombre:'Queso fresco', cat:'lacteo', hierro:null, alergeno:'leche', desdeMeses:6, orden:101,
    blw:'En dados grandes o bastones.',
    cuchara:'Chafado.',
    nota:'Busca el de menos sal. El queso es de los alimentos que más sal aporta.' },

  { id:'queso-curado', nombre:'Queso curado', cat:'lacteo', hierro:null, alergeno:'leche', desdeMeses:9, orden:102,
    blw:'Rallado o en bastones finos.',
    cuchara:'Rallado sobre la pasta.',
    nota:'En poca cantidad: lleva bastante sal.' },

  { id:'requeson', nombre:'Requesón', cat:'lacteo', hierro:null, alergeno:'leche', desdeMeses:6, orden:103,
    blw:'Sobre tostada.', cuchara:'Tal cual, sin azúcar.' },

  { id:'mantequilla', nombre:'Mantequilla', cat:'lacteo', hierro:null, alergeno:'leche', desdeMeses:6, orden:104,
    blw:'Fina sobre la tostada.', cuchara:'Una punta en el puré.',
    nota:'Sin sal. Mejor aún, aceite de oliva.' },

  { id:'leche-vaca', nombre:'Leche de vaca (como bebida)', cat:'lacteo', hierro:null, alergeno:'leche',
    desdeMeses:12, restriccion:'lecheVaca', orden:105,
    blw:'En vaso, no en biberón.', cuchara:'—' },

  { id:'leche-desnatada', nombre:'Leche desnatada o semi', cat:'lacteo', hierro:null, alergeno:'leche',
    desdeMeses:24, restriccion:'lecheLigera', orden:106,
    blw:'—', cuchara:'—' },

  /* ── Frutos secos y otros ─────────────────────────────────── */
  { id:'nuez-molida', nombre:'Nuez molida', cat:'frutosecos', hierro:'medio', alergeno:'frutosSecos', desdeMeses:6, orden:110,
    blw:'Espolvoreada sobre fruta o yogur.', cuchara:'Una cucharadita en el puré.' },

  { id:'avellana-molida', nombre:'Avellana molida', cat:'frutosecos', hierro:'medio', alergeno:'frutosSecos', desdeMeses:6, orden:111,
    blw:'Espolvoreada.', cuchara:'Una cucharadita.' },

  { id:'anacardo-molido', nombre:'Anacardo molido', cat:'frutosecos', hierro:'medio', alergeno:'frutosSecos', desdeMeses:6, orden:112,
    blw:'Espolvoreado o en crema fina.', cuchara:'Una cucharadita.' },

  { id:'pistacho-molido', nombre:'Pistacho molido', cat:'frutosecos', hierro:'medio', alergeno:'frutosSecos', desdeMeses:6, orden:113,
    blw:'Espolvoreado.', cuchara:'Una cucharadita.' },

  { id:'frutos-secos-enteros', nombre:'Frutos secos enteros', cat:'frutosecos', hierro:'medio', alergeno:'frutosSecos',
    desdeMeses:60, restriccion:'enteroAtragantamiento', orden:114,
    blw:'—', cuchara:'—' },

  { id:'aceite-oliva', nombre:'Aceite de oliva virgen extra', cat:'otros', hierro:null, desdeMeses:6, orden:120,
    blw:'Un chorrito sobre la verdura.', cuchara:'Una cucharadita en cada puré.',
    nota:'AEPap lo prefiere a cualquier otra grasa. Unos 10-20 g al día si no toma '
       + 'alimentos de origen animal a diario, 5 g si sí.' },

  { id:'miel', nombre:'Miel', cat:'otros', hierro:null, desdeMeses:12, restriccion:'botulismo', orden:121,
    blw:'—', cuchara:'—' },

  { id:'sal', nombre:'Sal', cat:'otros', hierro:null, desdeMeses:12, restriccion:'nunca', orden:122,
    blw:'—', cuchara:'—' },

  { id:'azucar', nombre:'Azúcar', cat:'otros', hierro:null, desdeMeses:24, restriccion:'nunca', orden:123,
    blw:'—', cuchara:'—' },

  { id:'tortitas-arroz', nombre:'Tortitas de arroz', cat:'cereal', hierro:null,
    desdeMeses:72, restriccion:'arsenico', orden:124,
    blw:'—', cuchara:'—' },

  { id:'bebida-arroz', nombre:'Bebida de arroz', cat:'otros', hierro:null,
    desdeMeses:72, restriccion:'arsenico', orden:125,
    blw:'—', cuchara:'—' },

  { id:'algas', nombre:'Algas', cat:'otros', hierro:'medio',
    desdeMeses:36, restriccion:'yodo', orden:126,
    blw:'—', cuchara:'—' },

  { id:'palomitas', nombre:'Palomitas', cat:'otros', hierro:null,
    desdeMeses:60, restriccion:'enteroAtragantamiento', orden:127,
    blw:'—', cuchara:'—' },

  { id:'aceitunas', nombre:'Aceitunas', cat:'otros', hierro:null, desdeMeses:12, orden:128,
    blw:'Sin hueso y cortadas a lo largo en cuartos.',
    cuchara:'Picadas muy finas.',
    atragantamiento:'Forma y tamaño de alto riesgo, además del hueso.',
    nota:'Llevan mucha sal; que sea algo puntual.' },

  { id:'salchicha', nombre:'Salchichas y embutido', cat:'otros', hierro:'medio', desdeMeses:12, orden:129,
    blw:'Cortadas a lo LARGO, nunca en rodajas.',
    cuchara:'Picadas.',
    atragantamiento:'En rodajas tiene justo la forma y el tamaño de la vía aérea.',
    nota:'Mucha sal y poca calidad. Mejor carne de verdad.' },

  { id:'chocolate', nombre:'Chocolate', cat:'otros', hierro:'medio', desdeMeses:24, orden:130,
    blw:'—', cuchara:'—',
    nota:'Azúcar, y además cafeína. No hay prisa ninguna.' },

  { id:'zumo', nombre:'Zumo de fruta', cat:'otros', hierro:null, desdeMeses:12, orden:131,
    blw:'En vaso, nunca en biberón.', cuchara:'—',
    nota:'Máximo 180 ml al día (AAP) y siempre mejor la fruta entera: el zumo tiene '
       + 'el azúcar sin la fibra y favorece la caries.' },

  /* ══ Bebidas ══════════════════════════════════════════════ */
  { id:'agua', nombre:'Agua', cat:'otros', hierro:null, desdeMeses:6, orden:19,
    blw:'En vaso abierto o de aprendizaje, con las comidas. Pequeños sorbos.',
    cuchara:'Unos sorbos entre cucharadas.',
    nota:'Desde que empieza la complementaria hay que ofrecerle agua en las comidas. '
       + 'AEPap: los líquidos en taza o vaso desde los 6 meses, no en biberón. No '
       + 'sustituye tomas de leche: es un acompañamiento.' },

  { id:'infusiones', nombre:'Infusiones, té y café', cat:'otros', hierro:null,
    desdeMeses:24, restriccion:'sinValorNutritivo', orden:132,
    blw:'—', cuchara:'—' },

  { id:'bebida-avena', nombre:'Bebida de avena', cat:'otros', hierro:null, alergeno:'gluten',
    desdeMeses:12, restriccion:'bebidaVegetal', orden:133,
    blw:'—', cuchara:'—' },

  { id:'bebida-almendra', nombre:'Bebida de almendra', cat:'otros', hierro:null,
    alergeno:'frutosSecos', desdeMeses:12, restriccion:'bebidaVegetal', orden:134,
    blw:'—', cuchara:'—' },

  { id:'bebida-soja', nombre:'Bebida de soja', cat:'otros', hierro:null, alergeno:'soja',
    desdeMeses:12, restriccion:'bebidaVegetal', orden:135,
    blw:'—', cuchara:'—',
    nota:'De las vegetales es la única con proteína comparable a la de la leche, pero '
       + 'aun así no sustituye a la fórmula en el primer año. Si hay que retirar los '
       + 'lácteos, que lo dirija la pediatra.' },

  /* ══ Fiambres y procesados ════════════════════════════════ */
  { id:'jamon-cocido', nombre:'Jamón cocido y fiambre de pavo', cat:'carne', hierro:'medio',
    desdeMeses:12, restriccion:'embutidos', orden:136,
    blw:'Si lo dais pasado el año, en tiras finas, no en lonchas enteras.',
    cuchara:'Picado muy fino.',
    atragantamiento:'La loncha entera puede pegarse al paladar. Córtala en tiras.',
    nota:'Si lo compráis, mirad la etiqueta: más del 90 % de carne, sal por debajo de '
       + '1,2 g/100 g y sin azúcares añadidos. La mayoría del "jamón de york" del '
       + 'supermercado no llega.' },

  { id:'jamon-serrano', nombre:'Jamón serrano y curados', cat:'carne', hierro:'medio',
    desdeMeses:12, restriccion:'embutidos', orden:137,
    blw:'—', cuchara:'—',
    atragantamiento:'Fibroso y difícil de masticar sin muelas.',
    nota:'Muchísima sal. Conviene retrasarlo bastante más allá del año.' },

  /* ══ Dulces y ultraprocesados ═════════════════════════════ */
  { id:'fruta-desecada', nombre:'Fruta desecada (dátiles, pasas, orejones)', cat:'fruta',
    hierro:'medio', alergeno:'sulfitos', desdeMeses:12, orden:138,
    blw:'Remojada y cortada muy pequeña, nunca entera.',
    cuchara:'Remojada y triturada con el yogur.',
    atragantamiento:'Pegajosa y del tamaño justo de la vía aérea. Remojar y picar.',
    nota:'Azúcar muy concentrado y se pega a los dientes. Además suele llevar '
       + 'sulfitos como conservante, que son alérgeno declarable.' },

  { id:'galletas', nombre:'Galletas (incluidas las "de bebé")', cat:'otros', hierro:null,
    alergeno:'gluten', desdeMeses:24, restriccion:'azucarAnadido', orden:139,
    blw:'—', cuchara:'—',
    nota:'Las galletas infantiles llevan azúcar aunque el envase diga otra cosa. Para '
       + 'mordisquear, mejor una tira de pan tostado o de fruta.' },

  { id:'papilla-azucarada', nombre:'Papillas y potitos azucarados', cat:'otros', hierro:null,
    desdeMeses:24, restriccion:'azucarAnadido', orden:140,
    blw:'—', cuchara:'—',
    nota:'Revisad la etiqueta: muchas papillas de cereales llevan azúcar o cereales '
       + 'hidrolizados, que es azúcar con otro nombre.' },

  /* ══ Alérgenos que faltaban del listado europeo ═══════════ */
  { id:'apio', nombre:'Apio', cat:'verdura', hierro:null, alergeno:'apio',
    desdeMeses:6, orden:59,
    blw:'Sólo cocido y sin hebras, en bastones.',
    cuchara:'Cocido y triturado, o como base del caldo.',
    atragantamiento:'Crudo tiene hebras duras que no puede masticar.',
    nota:'Es alérgeno oficial y pasa desapercibido: está en casi todos los caldos y '
       + 'sofritos. Si lo usáis para el caldo, cuenta como introducción.' },

  { id:'mostaza', nombre:'Mostaza', cat:'otros', hierro:null, alergeno:'mostaza',
    desdeMeses:12, orden:141,
    blw:'—', cuchara:'—',
    nota:'Alérgeno oficial. Poco habitual a esta edad, pero aparece en salsas y '
       + 'algunos embutidos.' },

  { id:'altramuces', nombre:'Altramuces y harina de altramuz', cat:'legumbre',
    hierro:'medio', alergeno:'altramuces', desdeMeses:12, orden:31,
    blw:'Pelados, sin piel y chafados. Los de bote hay que enjuagarlos mucho.',
    cuchara:'Chafados y mezclados con el puré.',
    atragantamiento:'Redondos, firmes y con una piel dura que no puede masticar. '
                  + 'Pelar y chafar siempre.',
    nota:'Ojo con este, que pasa desapercibido: es alérgeno oficial en la UE y '
       + 'tiene reactividad cruzada alta con el cacahuete — en pruebas de '
       + 'provocación, el 44 % de los alérgicos al cacahuete reaccionaron también '
       + 'al altramuz. Si Álex reacciona al cacahuete, consultad antes de darle '
       + 'altramuces. Aparece además como harina en panes sin gluten y en productos '
       + 'veganos, así que mirad la etiqueta. Los de aperitivo van en salmuera y '
       + 'llevan muchísima sal.' },

  /* ══ Más verdura ══════════════════════════════════════════ */
  { id:'nabo', nombre:'Nabo', cat:'verdura', hierro:null, desdeMeses:6, orden:44,
    blw:'Cocido en bastones.', cuchara:'Cocido y triturado con patata.' },

  { id:'chirivia', nombre:'Chirivía', cat:'verdura', hierro:null, desdeMeses:6, orden:45,
    blw:'Asada en bastones, sale dulce.', cuchara:'Cocida y triturada.' },

  { id:'col', nombre:'Col o repollo', cat:'verdura', hierro:null, desdeMeses:6, orden:46,
    blw:'Hoja cocida hasta que esté muy blanda, en tiras.',
    cuchara:'Cocida y triturada.' },

  { id:'coles-bruselas', nombre:'Coles de Bruselas', cat:'verdura', hierro:null,
    desdeMeses:6, orden:47,
    blw:'Cocidas y cortadas por la mitad, no enteras.',
    cuchara:'Cocidas y trituradas.',
    atragantamiento:'Enteras son redondas y del tamaño justo. Partir siempre.' },

  { id:'ajo', nombre:'Ajo', cat:'verdura', hierro:null, desdeMeses:6, orden:48,
    blw:'En el sofrito, no en trozo.', cuchara:'Como base del guiso.',
    nota:'Da sabor sin sal, que es justo lo que interesa.' },

  /* ══ Más fruta ════════════════════════════════════════════ */
  { id:'caqui', nombre:'Caqui', cat:'fruta', hierro:null, desdeMeses:6, orden:80,
    blw:'Muy maduro, en gajos. El persimon, más firme, va mejor para agarrar.',
    cuchara:'Chafado.',
    nota:'Si está poco maduro es muy áspero y lo va a rechazar.' },

  { id:'chirimoya', nombre:'Chirimoya', cat:'fruta', hierro:null, desdeMeses:6, orden:81,
    blw:'En trozos, quitando todas las pepitas.',
    cuchara:'Chafada y colada.',
    atragantamiento:'Las pepitas son grandes, duras y negras: repásalas una a una.' },

  { id:'nispero', nombre:'Níspero', cat:'fruta', hierro:null, desdeMeses:6, orden:82,
    blw:'Pelado, sin huesos, en mitades.', cuchara:'Chafado.',
    atragantamiento:'Los huesos son grandes y lisos.' },

  { id:'coco', nombre:'Coco', cat:'fruta', hierro:'medio', desdeMeses:6, orden:83,
    blw:'Rallado fino sobre la fruta, o en crema.',
    cuchara:'Rallado en el yogur.',
    atragantamiento:'En trozo es durísimo. Sólo rallado fino.',
    nota:'En algunos países se clasifica como fruto de cáscara. En la UE no, pero si '
       + 'hay alergia a frutos secos en la familia, coméntalo con la pediatra.' },

  /* ══ Más cereal ═══════════════════════════════════════════ */
  { id:'trigo-sarraceno', nombre:'Trigo sarraceno', cat:'cereal', hierro:'medio',
    desdeMeses:6, orden:36,
    blw:'Bien cocido y compactado en bolitas, o en tortita.',
    cuchara:'Cocido y chafado.',
    nota:'A pesar del nombre no lleva gluten ni es trigo.' },

  { id:'mijo', nombre:'Mijo', cat:'cereal', hierro:'medio', desdeMeses:6, orden:37,
    blw:'Compactado con verdura.', cuchara:'Bien cocido y chafado.' },

  { id:'espelta', nombre:'Espelta', cat:'cereal', hierro:'medio', alergeno:'gluten',
    desdeMeses:6, orden:38,
    blw:'Pan de espelta tostado, en tiras.', cuchara:'En papilla.' },

  { id:'centeno', nombre:'Centeno', cat:'cereal', hierro:'medio', alergeno:'gluten',
    desdeMeses:6, orden:39,
    blw:'Pan de centeno tostado, en tiras.', cuchara:'Miga en el puré.' },

  /* ══ Otros ════════════════════════════════════════════════ */
  { id:'edamame', nombre:'Edamame', cat:'legumbre', hierro:'medio', alergeno:'soja',
    desdeMeses:6, orden:30,
    blw:'Fuera de la vaina y chafado, nunca entero.',
    cuchara:'Chafado con patata.',
    atragantamiento:'La vaina no, y el grano entero tampoco: es redondo y firme.' },

  { id:'kefir', nombre:'Kéfir', cat:'lacteo', hierro:null, alergeno:'leche',
    desdeMeses:6, orden:107,
    blw:'Para mojar tiras de fruta.', cuchara:'Natural, sin azúcar.' },

  { id:'conserva-pescado', nombre:'Pescado en conserva', cat:'pescado', hierro:'alto',
    alergeno:'pescado', desdeMeses:6, orden:98,
    blw:'Sardinillas o atún claro al natural, escurridos y desmenuzados.',
    cuchara:'Desmenuzado en el puré.',
    nota:'Al natural mejor que en aceite, y escurrido para quitar sal. El atún claro '
       + 'y el bonito no tienen el problema de mercurio del atún rojo.' },

  { id:'caldo-casero', nombre:'Caldo casero', cat:'otros', hierro:null, desdeMeses:6,
    orden:121,
    blw:'—',
    cuchara:'Como base del puré, en vez de agua.',
    nota:'Sin sal y sin pastilla de caldo, que es prácticamente sal. Si lleva apio, '
       + 'cuenta como introducción de un alérgeno.' },

  { id:'hierbas-especias', nombre:'Hierbas y especias suaves', cat:'otros', hierro:null,
    desdeMeses:6, orden:122,
    blw:'Una pizca sobre la verdura: orégano, perejil, comino, canela, pimentón dulce.',
    cuchara:'Una pizca en el puré.',
    nota:'Recomendación positiva: exponerle a sabores variados sin recurrir a la sal '
       + 'ni al azúcar. Evita sólo el picante.' }
];


/* ── Ayudas de consulta ──────────────────────────────────────  */
const ALIMENTOS_POR_ID = Object.fromEntries(ALIMENTOS.map(a => [a.id, a]));

function alimentoPorId(id) { return ALIMENTOS_POR_ID[id] || null; }

function restriccionDe(alimento) {
  return alimento && alimento.restriccion ? RESTRICCIONES[alimento.restriccion] : null;
}

// Edad mínima efectiva en meses: la más restrictiva de las dos
function edadMinimaMeses(alimento) {
  const r = restriccionDe(alimento);
  return Math.max(alimento.desdeMeses || 0, r ? r.edadMeses : 0);
}
