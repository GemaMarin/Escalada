// Modelo de dominio: grados, etiquetas de estilo y su relación con el cuerpo.

import { SHARMA_CIRCUITS } from './sharma.js';

// Grados franceses de vía, tal y como los publica la sala.
export const ROUTE_GRADES = ['4a', '4b', '4c', '5a', '5a+', '5b', '5b+', '5c', '5c+', '6a', '6a+', '6b', '6b+',
  '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a'];
const OLD_ROUTE_GRADES = ['4', '4+', '5a', '5a+', '5b', '5b+', '5c', '5c+', '6a', '6a+', '6b', '6b+',
  '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+', '8c'];

// Circuitos de bloque por defecto: los de Sharma Climbing Madrid (editables en Ajustes).
export const DEFAULT_BOULDER_SCALE = SHARMA_CIRCUITS;
const OLD_DEFAULT_NAMES = ['Verde', 'Amarillo', 'Naranja', 'Azul', 'Rojo', 'Rosa', 'Morado', 'Negro', 'Blanco'];
const OLD_NAME_MAP = { Naranja: 'Amarillo', Rosa: 'Rojo' };

// Migra datos de la versión 1 (otra escala de vías y circuitos genéricos).
export function migrate(settings, sessions) {
  if ((settings.dataVersion || 1) >= 2) return { settings, sessions, changed: false };
  const oldScale = settings.boulderScale;
  const wasOldDefault = !oldScale || (oldScale.length === OLD_DEFAULT_NAMES.length && oldScale.every((g, i) => g.name === OLD_DEFAULT_NAMES[i]));
  const newScale = wasOldDefault ? SHARMA_CIRCUITS : oldScale;
  const remapBoulder = (i) => {
    if (!wasOldDefault) return i;
    const name = OLD_DEFAULT_NAMES[i];
    const target = OLD_NAME_MAP[name] || name;
    const j = SHARMA_CIRCUITS.findIndex((g) => g.name === target);
    return j >= 0 ? j : i;
  };
  const remapRoute = (i) => {
    const label = OLD_ROUTE_GRADES[i];
    const mapped = label === '4' ? '4a' : label === '4+' ? '4c' : label;
    const j = ROUTE_GRADES.indexOf(mapped);
    return j >= 0 ? j : i;
  };
  const out = sessions.map((s) => ({
    ...s,
    climbs: (s.climbs || []).map((c) => ({ ...c, grade: c.discipline === 'route' ? remapRoute(c.grade) : remapBoulder(c.grade) })),
  }));
  return { settings: { ...settings, boulderScale: newScale, scalePreset: wasOldDefault ? 'sharma' : settings.scalePreset, dataVersion: 2 }, sessions: out, changed: true };
}

export function boulderIndexByName(settings, name) {
  return boulderScale(settings).findIndex((g) => g.name.toLowerCase() === (name || '').toLowerCase());
}

export const TRAINING = {
  kilter: 'Kilter Board', campus: 'Campus board', hangboard: 'Suspensiones', gym: 'Gimnasio / fuerza',
  core: 'Core', movilidad: 'Movilidad / yoga', autos: 'Autoseguros', velocidad: 'Velocidad',
};

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
