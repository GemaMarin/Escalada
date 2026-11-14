// Integración con la sala: información de Sharma Climbing Madrid y bloques/vías
// actuales publicados por la propia sala en Vertical-Life (widget público).
// App no oficial: los datos se leen del mismo widget que enlaza la web del rocódromo.
import { db } from './db.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeColor = (c) => (/^#[0-9a-f]{3,8}$|^[a-z]+$/i.test(c || '') ? c : '#afff00');
const safeURL = (u) => (/^https:\/\/[\w.-]+\/[\w./-]+$/.test(u || '') ? u : '');
export const GYM = {
  id: 'sharma-climbing-madrid',
  name: 'Sharma Climbing Madrid',
  address: 'C/ Julián Camarillo 55, 28037 Madrid',
  transport: [
    { icon: 'metro', text: 'Metro L5 · Suanzes / Torre Arias' },
    { icon: 'bus', text: 'Bus 105, 28 y 153' },
  ],
  facts: [
    { value: '~100', label: 'bloques · del IV a +8A' },
    { value: '120+', label: 'vías hasta 18 m' },
    { value: '22', label: 'autoseguros · muro de 12 m' },
  ],
  zones: ['Zona de bloque (sectores renovados cada semana)', 'Vías y vía de velocidad oficial', 'Autoseguros', 'Campus board y Kilter Board', 'Gimnasio, yoga y bar'],
  links: {
    web: 'https://sharmaclimbing.com/espana/madrid-centro/',
    hours: 'https://sharmaclimbing.com/espana/madrid-centro/horarios-y-tarifas/',
    maps: 'https://www.google.com/maps/search/?api=1&query=Sharma+Climbing+Madrid+Julian+Camarillo+55',
    vl: 'https://gyms.vertical-life.info/sharma-climbing-madrid/iframe',
  },
};

// Circuitos de bloque de la sala, de más fácil a más difícil (orden de Vertical-Life).
export const SHARMA_CIRCUITS = [
  { name: 'Blanco', color: '#f4f4f5', approx: '' },
  { name: 'Azul', color: '#2563eb', approx: '' },
  { name: 'Verde', color: '#16a34a', approx: '' },
  { name: 'Joker 1', color: '#94a3b8', approx: 'circuito especial', joker: true },
  { name: 'Amarillo', color: '#facc15', approx: '' },
  { name: 'Joker 2', color: '#64748b', approx: 'circuito especial', joker: true },
  { name: 'Rojo', color: '#dc2626', approx: '' },
  { name: 'Morado', color: '#7c3aed', approx: '' },
  { name: 'Negro', color: '#18181b', approx: '' },
];

const BASE = 'https://gyms.vertical-life.info';
const IFRAME = `${BASE}/${GYM.id}/iframe`;
const MAX_AGE = 3 * 3600 * 1000;

// Nombres de color de presa (Vertical-Life los da en inglés).
const HOLD_NAMES = {
  white: 'Blanca', black: 'Negra', pink: 'Rosa', yellow: 'Amarilla', purple: 'Morada', blue: 'Azul',
  green: 'Verde', 'fluoro green': 'Verde flúor', red: 'Roja', orange: 'Naranja', turquoise: 'Turquesa',
  cyan: 'Turquesa', grey: 'Gris', gray: 'Gris', brown: 'Marrón', wood: 'Madera', beige: 'Beige',
};
export const holdName = (n) => HOLD_NAMES[(n || '').toLowerCase()] || n || '';

function parsePane(doc, kind) {
  const pane = doc.getElementById(kind === 'route' ? 'routes' : 'boulders');
  if (!pane) return [];
  return [...pane.querySelectorAll('tbody.list tr')].map((tr) => {
    const a = tr.querySelector(`a.${kind}_name`);
    const sec = tr.querySelector('td.sector a');
    const circle = tr.querySelector('.iframe-circle');
    const color = (circle?.getAttribute('style') || '').match(/border-top-color:\s*([^;]+)/)?.[1]?.trim() || '#999';
    return {
      vlId: (a?.getAttribute('href') || '').match(/iframe\/(\d+)\//)?.[1] || null,
      kind,
      number: tr.querySelector(`.${kind}_number`)?.textContent.trim() || '',
      hold: a?.textContent.trim() || '',
      holdColor: color.toLowerCase(),
      grade: tr.querySelector('td.grade')?.textContent.trim() || '',
      sector: sec?.textContent.trim() || '',
      sectorId: (sec?.getAttribute('href') || '').match(/iframe\/(\d+)\//)?.[1] || null,
      setter: tr.querySelector('td.route_setter')?.textContent.trim() || '',
      date: Number(tr.querySelector('td.date')?.textContent.trim() || 0) * 1000,
      zlags: Number(tr.querySelector('td.zlags')?.textContent.trim() || 0),
      isNew: !!tr.querySelector('.new-small-badge'),
    };
  }).filter((x) => x.vlId);
}

export function parseGym(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return { boulders: parsePane(doc, 'boulder'), routes: parsePane(doc, 'route'), fetchedAt: Date.now() };
}

let memo = null;
let extras = null;

// Planos de sector y zonas de cada bloque: los prepara GitHub cada día (scripts/update-sharma.mjs)
// y se publican junto a la app, así cargan al instante.
async function loadExtras() {
  if (extras) return extras;
  try {
    const res = await fetch('data/sharma.json');
    if (!res.ok) throw new Error(res.status);
    extras = await res.json();
    db.put('settings', { key: 'gym-extras', value: extras });
  } catch {
    extras = (await db.get('settings', 'gym-extras'))?.value || { sectors: {}, topos: {}, boulders: [], routes: [], fetchedAt: 0 };
  }
  return extras;
}

// Devuelve los datos de la sala: caché local → lista en directo → copia publicada con la app.
export async function getGym({ force = false } = {}) {
  const ex = await loadExtras();
  if (!memo) memo = (await db.get('settings', 'gym-cache'))?.value || null;
  const fresh = memo && Date.now() - memo.fetchedAt < MAX_AGE;
  if (!force && fresh) return memo;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(IFRAME, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(res.status);
    const data = parseGym(await res.text());
    if (!data.boulders.length && !data.routes.length) throw new Error('vacío');
    memo = data;
    await db.put('settings', { key: 'gym-cache', value: data });
    return data;
  } catch {
    if (memo) return { ...memo, offline: true };
    if (ex.boulders?.length) return { boulders: ex.boulders, routes: ex.routes, fetchedAt: ex.fetchedAt, offline: true };
    return { boulders: [], routes: [], fetchedAt: 0, offline: true };
  }
}

export const cachedGym = () => memo;

export async function getDetail(item) {
  const ex = await loadExtras();
  const t = ex.topos?.[item.vlId];
  return {
    wall: t?.wall || null,
    map: ex.sectors?.[item.sectorId]?.map || null,
    stars: Math.min(5, t?.stars || 0),
    expires: t?.expires || null,
    missing: !t,
  };
}

export async function getSector(sectorId) {
  const ex = await loadExtras();
  return ex.sectors?.[sectorId]?.map || null;
}

// Dibuja una foto con una zona resaltada (coordenadas en píxeles de la imagen original).
export function topoHTML(topo, color, { cls = '', label = '', line = false } = {}) {
  const src = safeURL(topo?.src);
  if (!src) return '';
  const id = `t${Math.random().toString(36).slice(2, 8)}`;
  const pts = topo.path.map(([x, y]) => `${Number(x)},${Number(y)}`).join(' ');
  return `<figure class="topo ${cls}" id="${id}">
    <div class="topo-inner"><img src="${src}" alt="" loading="lazy"
      onload="const s=this.nextElementSibling;s.setAttribute('viewBox','0 0 '+this.naturalWidth+' '+this.naturalHeight);s.style.display='block';this.parentNode.classList.add('ready')"
      onerror="this.closest('figure').classList.add('broken')">
    <svg preserveAspectRatio="none" style="display:none">${line || topo.path.length < 3 ? `<polyline points="${pts}" style="--zc:${safeColor(color || topo.color)}"/>` : `<polygon points="${pts}" style="--zc:${safeColor(color || topo.color)}"/>`}</svg></div>
    ${label ? `<figcaption>${esc(label)}</figcaption>` : ''}
  </figure>`;
}

// Mapa general con todos los sectores (agrupados por imagen de fondo).
export function sectorMapHTML(sectors, active) {
  const byImage = {};
  for (const s of sectors) if (safeURL(s.topo?.src)) (byImage[s.topo.src] ||= []).push(s);
  return Object.entries(byImage).map(([src, list]) => `<figure class="topo map">
    <div class="topo-inner"><img src="${src}" alt="Plano de la sala" loading="lazy"
      onload="const s=this.nextElementSibling;s.setAttribute('viewBox','0 0 '+this.naturalWidth+' '+this.naturalHeight);s.style.display='block';this.parentNode.classList.add('ready')"
      onerror="this.closest('figure').classList.add('broken')">
    <svg preserveAspectRatio="none" style="display:none">${list.map((s) => `<polygon class="${active === s.id ? 'on' : ''}" data-action="gym-sector" data-v="${esc(s.id)}" points="${s.topo.path.map(([x, y]) => `${x},${y}`).join(' ')}"><title>${esc(s.name)}</title></polygon>`).join('')}</svg></div>
  </figure>`).join('');
}
