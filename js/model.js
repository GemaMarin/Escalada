// Modelo de dominio: grados, etiquetas de estilo y su relación con el cuerpo.

export const ROUTE_GRADES = ['4', '4+', '5a', '5a+', '5b', '5b+', '5c', '5c+', '6a', '6a+', '6b', '6b+',
  '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+', '8c'];

// Circuito de colores para bloque. Los gimnasios cambian sus colores y rangos:
// se pueden editar desde Ajustes para que coincidan con los de la sala.
export const DEFAULT_BOULDER_SCALE = [
  { name: 'Verde', color: '#22c55e', approx: '4 – 5a' },
  { name: 'Amarillo', color: '#facc15', approx: '5a – 5c' },
  { name: 'Naranja', color: '#fb923c', approx: '5c – 6a+' },
  { name: 'Azul', color: '#3b82f6', approx: '6a+ – 6b+' },
  { name: 'Rojo', color: '#ef4444', approx: '6b+ – 6c+' },
  { name: 'Rosa', color: '#ec4899', approx: '6c+ – 7a+' },
  { name: 'Morado', color: '#8b5cf6', approx: '7a+ – 7b+' },
  { name: 'Negro', color: '#1f2937', approx: '7b+ – 7c+' },
  { name: 'Blanco', color: '#f8fafc', approx: '7c+ +' },
];

export const FONT_SCALE = ['4', '4+', '5', '5+', '6A', '6A+', '6B', '6B+', '6C', '6C+', '7A', '7A+', '7B', '7B+', '7C', '7C+', '8A']
  .map((g, i, arr) => ({ name: g, color: gradeHue(i / (arr.length - 1)), approx: g }));

function gradeHue(t) {
  const h = Math.round(140 - t * 140 + (t > 0.7 ? -(t - 0.7) * 200 : 0));
  return `hsl(${(h + 360) % 360} 75% 48%)`;
}

export const RESULTS = {
  flash: { label: 'Flash', short: '⚡', desc: 'A la primera', sent: true },
  onsight: { label: 'A vista', short: '👁', desc: 'A la primera sin info', sent: true },
  send: { label: 'Encadenado', short: '✓', desc: 'Tras varios intentos', sent: true },
  project: { label: 'Proyecto', short: '…', desc: 'Aún no sale', sent: false },
};

export const ROPE_MODES = { lead: 'De primera', toprope: 'En polea', auto: 'Autobelay' };

export const TAGS = {
  styles: {
    label: 'Inclinación',
    items: {
      placa: 'Placa', vertical: 'Vertical', desplome: 'Desplome', techo: 'Techo',
    },
  },
  holds: {
    label: 'Presas',
    items: {
      regletas: 'Regletas', romos: 'Romos', pinzas: 'Pinzas', agujeros: 'Agujeros / bidedos',
      cantos: 'Cantos', volumenes: 'Volúmenes', fisuras: 'Fisuras',
    },
  },
  moves: {
    label: 'Movimientos',
    items: {
      dinamico: 'Dinámico / lance', bloqueos: 'Bloqueos', talon: 'Talonamiento', puntera: 'Puntera',
      compresion: 'Compresión', coordinacion: 'Coordinación', equilibrio: 'Equilibrio', resistencia: 'Continuidad',
    },
  },
};

export const BODY_PARTS = {
  dedos: 'Dedos', antebrazos: 'Antebrazos', biceps: 'Bíceps', hombros: 'Hombros',
  espalda: 'Espalda', core: 'Core', cadera: 'Cadera', piernas: 'Piernas',
};

// Peso aproximado (0–3) que cada etiqueta pone sobre cada zona del cuerpo.
// Es un modelo orientativo pensado para ver tendencias, no una medida fisiológica.
export const BODY_WEIGHTS = {
  placa: { piernas: 3, cadera: 2, dedos: 1, core: 1 },
  vertical: { dedos: 2, antebrazos: 2, piernas: 2 },
  desplome: { core: 3, espalda: 2, hombros: 2, biceps: 2, antebrazos: 2 },
  techo: { core: 3, espalda: 3, hombros: 3, biceps: 2, piernas: 1 },
  regletas: { dedos: 3, antebrazos: 2 },
  romos: { hombros: 2, antebrazos: 2, core: 1, dedos: 1 },
  pinzas: { dedos: 2, antebrazos: 3 },
  agujeros: { dedos: 3, antebrazos: 1 },
  cantos: { espalda: 1, biceps: 2 },
  volumenes: { hombros: 2, core: 1, piernas: 1 },
  fisuras: { antebrazos: 2, hombros: 1, piernas: 1 },
  dinamico: { hombros: 2, piernas: 2, core: 2 },
  bloqueos: { biceps: 3, espalda: 2 },
  talon: { piernas: 2, cadera: 2, core: 1 },
  puntera: { core: 2, piernas: 1, cadera: 1 },
  compresion: { hombros: 2, core: 2, espalda: 1 },
  coordinacion: { core: 2, piernas: 2, hombros: 1 },
  equilibrio: { piernas: 2, cadera: 2, core: 1 },
  resistencia: { antebrazos: 3 },
};

export const MOODS = ['😫', '😕', '🙂', '😄', '🤩'];

export function boulderScale(settings) {
  return settings.boulderScale?.length ? settings.boulderScale : DEFAULT_BOULDER_SCALE;
}

export function gradeLabel(climb, settings) {
  if (climb.discipline === 'route') return ROUTE_GRADES[climb.grade] ?? '?';
  return boulderScale(settings)[climb.grade]?.name ?? '?';
}

export function gradeColor(climb, settings) {
  if (climb.discipline === 'route') return gradeHue(climb.grade / (ROUTE_GRADES.length - 1));
  return boulderScale(settings)[climb.grade]?.color ?? '#999';
}

export function routeColor(i) { return gradeHue(i / (ROUTE_GRADES.length - 1)); }

// Dificultad relativa 0–1 dentro de su escala, para comparar bloque y vía.
export function intensity(climb, settings) {
  const n = climb.discipline === 'route' ? ROUTE_GRADES.length : boulderScale(settings).length;
  return n > 1 ? climb.grade / (n - 1) : 0.5;
}

export const isSent = (c) => RESULTS[c.result]?.sent ?? false;

export function climbTags(c) {
  return [...(c.styles || []), ...(c.holds || []), ...(c.moves || [])];
}

export function tagLabel(tag) {
  for (const g of Object.values(TAGS)) if (g.items[tag]) return g.items[tag];
  return tag;
}
