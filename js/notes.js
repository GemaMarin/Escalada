// Clasifica las notas de cada sesión en temas sencillos mediante palabras clave.
// Funciona sin conexión y sin enviar nada fuera del móvil.
// Palabras completas; las terminadas en * valen como raíz (cansad* → cansada, cansadísima…).
export const TOPICS = {
  logro: { label: 'Logro', emoji: '🎉', words: ['por fin', 'conseguid*', 'consegui', 'me ha salido', 'me salio', 'primera vez', 'orgullos*', 'genial', 'increible', 'lo logre', 'contenta', 'feliz'] },
  pies: { label: 'Técnica de pies', emoji: '🦶', words: ['pie', 'pies', 'talon*', 'puntera*', 'gato', 'gatos', 'resbal*', 'equilibrio', 'cadera'] },
  tecnica: { label: 'Técnica', emoji: '🧩', words: ['tecnica', 'movimiento*', 'secuencia*', 'beta', 'leer', 'lectura', 'truco*', 'paso', 'pasos', 'lance*', 'dinamic*', 'coordinacion', 'posicion'] },
  fuerza: { label: 'Fuerza', emoji: '💪', words: ['fuerza', 'fuerte', 'brazo*', 'bloqueo*', 'colgar', 'traccion', 'debil', 'regleta*', 'romo*', 'pinza*', 'aguant*'] },
  cabeza: { label: 'Cabeza', emoji: '🧠', words: ['miedo*', 'caer', 'caida*', 'caerme', 'altura*', 'nervios*', 'confianza', 'susto', 'agobi*', 'bloqueada', 'insegur*', 'concentr*', 'frustr*'] },
  cansancio: { label: 'Cansancio', emoji: '🔋', words: ['cansad*', 'cansancio', 'agotad*', 'sin fuerza*', 'reventad*', 'dormido mal', 'sueno', 'sin energia', 'flojita'] },
  molestias: { label: 'Molestias', emoji: '🩹', words: ['dolor*', 'duele*', 'dolia', 'molesti*', 'lesion*', 'muneca*', 'hombro*', 'codo*', 'rodilla*', 'tobillo*', 'piel', 'ampolla*', 'tirantez', 'pinchazo*'] },
  social: { label: 'Buen rollo', emoji: '👯', words: ['amigas', 'amigos', 'risas', 'divertid*', 'buen rollo', 'lo hemos pasado'] },
};

const rx = {};
const matcher = (w) => (rx[w] ||= new RegExp(`(^|[^a-zñ])${w.replace('*', '')}${w.endsWith('*') ? '' : '(?![a-zñ])'}`));

const norm = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function topicsOf(text) {
  const t = norm(text);
  if (!t.trim()) return [];
  return Object.entries(TOPICS).filter(([, v]) => v.words.some((w) => matcher(w).test(t))).map(([k]) => k);
}

export function topicChips(keys) {
  return keys.map((k) => `<span class="topic t-${k}">${TOPICS[k].emoji} ${TOPICS[k].label}</span>`).join('');
}
