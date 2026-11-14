import { db, uid, compressImage, blobToDataURL, dataURLToBlob } from './db.js';
import * as M from './model.js';
import * as I from './insights.js';
import * as C from './charts.js';
import * as S from './sharma.js';
import { icon } from './icons.js';
import { makeDemo } from './demo.js';
import * as P from './schedule.js';
import * as N from './notes.js';
import { sessionImage, progressImage } from './shareimg.js';

const DATA_VERSION = 4;
const DEFAULT_SETTINGS = {
  key: 'settings', name: 'Laura', gym: S.GYM.name, weeklyGoal: 1, theme: 'light',
  boulderScale: M.DEFAULT_BOULDER_SCALE, scalePreset: 'sharma', dataVersion: DATA_VERSION, liveGym: true,
  schedule: { days: [4], time: '19:00' }, extraDates: [], skipped: [],
};

const state = {
  sessions: [], settings: { ...DEFAULT_SETTINGS }, photos: new Map(), urls: new Map(),
  draft: null, stash: null, gym: null, gymLoading: false, gymSectors: {}, installEvt: null,
  ui: {
    histTab: 'sessions', progTab: 'resumen', profTab: 'diario', progDisc: 'boulder', bodyRange: '28',
    gymDisc: 'boulder', gymSector: 'all', gymCircuit: 'all', gymFilter: 'all', gymMap: false, onb: 0,
    logDisc: 'boulder', logCircuit: null, logSector: 'all', logOpen: false, routeRows: [], tip: 0,
  },
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const set = () => state.settings;
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* sin soporte */ } };
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const WEEK = 7 * 86400000;

// Estados sencillos de un bloque o vía.
const STATUS = {
  flash: { label: 'A la primera', icon: 'bolt', cls: 'flash' },
  send: { label: 'Lo conseguí', icon: 'check', cls: 'send' },
  project: { label: 'Lo intenté', icon: 'refresh', cls: 'proj' },
};
const statusOf = (result) => (result === 'onsight' ? 'flash' : result);

// ---------------- Arranque ----------------
async function init() {
  const [settings, sessions, photos, draft] = await Promise.all([
    db.get('settings', 'settings'), db.all('sessions'), db.all('photos'), db.get('settings', 'draft'),
  ]);
  state.sessions = sessions;
  const legacy = settings ? !settings.dataVersion : sessions.length > 0 || !!draft?.value;
  const stored = settings || {};
  const mig = M.migrate({ ...stored, dataVersion: legacy ? 1 : 2 }, state.sessions);
  state.settings = { ...DEFAULT_SETTINGS, ...stored, ...(mig.changed ? mig.settings : {}) };
  if (mig.changed) {
    state.sessions = mig.sessions;
    if (state.sessions.length) await db.putMany('sessions', state.sessions);
    if (draft?.value) draft.value = M.migrate({ dataVersion: 1, boulderScale: settings?.boulderScale }, [draft.value]).sessions[0];
  }
  // v3: el objetivo semanal pasa a 1 sesión (antes 3 por defecto).
  if ((stored.dataVersion || 1) < 3 && settings) {
    if (!stored.weeklyGoal || stored.weeklyGoal === 3) state.settings.weeklyGoal = 1;
  }
  // v4: tema claro por defecto y nombre de Laura si no había ninguno.
  if ((stored.dataVersion || 1) < 4 && settings) {
    if (!stored.theme) state.settings.theme = 'light';
    if (!stored.name) state.settings.name = 'Laura';
  }
  state.settings.dataVersion = DATA_VERSION;
  if (!state.settings.planSince) {
    const d = new Date(); d.setDate(d.getDate() - 7);
    state.settings.planSince = I.toISO(d);
  }
  if (!state.settings.seenAch) state.settings.seenAch = '__init__';
  if (settings) await db.put('settings', state.settings);
  photos.forEach((p) => state.photos.set(p.id, p));
  const av = await db.get('settings', 'avatar');
  if (av?.blob) state.avatarURL = URL.createObjectURL(av.blob);
  if (draft?.value) state.draft = { newPhotos: [], removedPhotos: [], ...draft.value };
  if (mig.changed && state.draft) await db.put('settings', { key: 'draft', value: state.draft });
  applyTheme();
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
  window.addEventListener('hashchange', () => render({ transition: true }));
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installEvt = e; if (route() === 'inicio') rerender(); });
  setupSheetGestures();
  render();
  document.body.classList.add('ready');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
    // Si llega una versión nueva con la app abierta, recarga una vez (el borrador ya está guardado).
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true; saveDraftNow();
      setTimeout(() => location.reload(), 300);
    });
  }
  protectStorage();
  if (set().liveGym !== false) loadGym();
  loadEvents();
  if (set().seenAch === '__init__') { state.settings.seenAch = I.unlockedKeys(achievementsNow()); saveSettings(); }
}

async function loadEvents() {
  try {
    const res = await fetch('data/events.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    state.events = await res.json();
    db.put('settings', { key: 'events-cache', value: state.events });
  } catch {
    state.events = (await db.get('settings', 'events-cache'))?.value || { events: [], fetchedAt: 0 };
  }
  if (['inicio', 'eventos'].includes(route()) && !document.querySelector('dialog[open]')) rerender();
}

// Pide al navegador que no borre nunca los datos guardados (sesiones y fotos).
async function protectStorage() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist();
    state.persisted = await navigator.storage?.persisted?.();
  } catch { /* sin soporte */ }
}

function applyTheme() {
  const t = state.settings.theme || 'light';
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

async function loadGym(force = false) {
  if (state.gymLoading) return;
  state.gymLoading = true;
  if (['sala', 'nueva'].includes(route())) rerender();
  try { state.gym = await S.getGym({ force }); } finally { state.gymLoading = false; }
  if (['sala', 'inicio', 'nueva', 'perfil', 'eventos', 'progreso', 'objetivos'].includes(route()) && !document.querySelector('dialog[open]')) rerender();
}

// ---------------- Router ----------------
const routes = [
  [/^#?\/?(inicio)?$/, viewHome, 'inicio'],
  [/^#\/perfil$/, viewProfile, 'perfil'],
  [/^#\/diario$/, () => { state.ui.profTab = 'diario'; return viewProfile(); }, 'perfil'],
  [/^#\/historial$/, () => { state.ui.profTab = 'diario'; return viewProfile(); }, 'perfil'],
  [/^#\/sesion\/([\w-]+)$/, viewDetail, 'perfil'],
  [/^#\/nueva$/, viewEditor, 'nueva'],
  [/^#\/editar\/([\w-]+)$/, viewEditor, 'nueva'],
  [/^#\/sala$/, viewGym, 'sala'],
  [/^#\/progreso$/, viewProgress, 'progreso'],
  [/^#\/cuerpo$/, viewProgress, 'progreso'],
  [/^#\/ajustes$/, viewSettings, 'perfil'],
  [/^#\/eventos$/, viewEvents, 'eventos'],
  [/^#\/objetivos$/, viewObjectives, 'objetivos'],
  [/^#\/logros$/, viewObjectives, 'objetivos'],
];
const route = () => document.body.dataset.route;

function render({ transition = false } = {}) {
  const hash = location.hash || '#/inicio';
  for (const [re, fn, tab] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    const swap = () => {
      const view = $('#view');
      view.innerHTML = fn(m[1]);
      view.classList.toggle('enter', !render.keepScroll);
      if (!render.keepScroll) [...view.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 10)));
      document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
      document.body.dataset.route = tab;
      if (!render.keepScroll) window.scrollTo(0, 0);
      render.keepScroll = false;
    };
    if (transition && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(swap);
    else swap();
    return;
  }
  location.hash = '#/inicio';
}
const rerender = () => { render.keepScroll = true; render(); };
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

// ---------------- Datos derivados ----------------
// Las sesiones «de verdad». Los bloques apuntados por separado se guardan en registros
// «sueltos» (loose) que cuentan para bloques, nivel y logros, pero no como sesión.
const realSessions = () => state.sessions.filter((x) => !x.loose);
const looseId = (date) => `loose-${date}`;
const gymItems = () => (state.gym ? [...state.gym.boulders, ...state.gym.routes] : []);
const findItem = (vlId) => gymItems().find((i) => i.vlId === vlId);

// Historial de cada bloque de la sala: mejor resultado, intentos y fechas.
function myLog() {
  const map = new Map();
  const rank = { onsight: 4, flash: 3, send: 2, project: 1 };
  const add = (c, date) => {
    if (!c.vlId) return;
    const cur = map.get(c.vlId) || { best: null, tries: 0, sessions: 0, last: null, sentOn: null };
    cur.tries += c.attempts || 1; cur.sessions++;
    if (!cur.best || rank[c.result] > rank[cur.best]) cur.best = c.result;
    if (M.RESULTS[c.result]?.sent && (!cur.sentOn || date < cur.sentOn)) cur.sentOn = date;
    if (!cur.last || date > cur.last) cur.last = date;
    map.set(c.vlId, cur);
  };
  for (const s of state.sessions) for (const c of s.climbs || []) add(c, s.date);
  if (state.draft?.isNew) for (const c of state.draft.climbs) add(c, state.draft.date);
  return map;
}
const itemStatus = (st) => (!st ? 'none' : M.RESULTS[st.best]?.sent ? 'sent' : 'trying');

// Devuelve el logro recién conseguido (si hay) y lo marca como visto.
function checkNewAchievements() {
  const ach = achievementsNow();
  const keys = I.unlockedKeys(ach);
  const seen = new Set(set().seenAch || []);
  const fresh = keys.filter((k) => !seen.has(k));
  state.settings.seenAch = [...new Set([...seen, ...keys])];
  saveSettings();
  if (!fresh.length) return null;
  const fam = fresh[fresh.length - 1].split(':')[0];
  return ach.find((a) => a.key === fam);
}

function circuitProgress(g) {
  const log = myLog();
  return M.boulderScale(set()).map((c) => {
    const items = g.boulders.filter((b) => b.grade === c.name);
    return {
      name: c.name, color: c.color, joker: c.joker, total: items.length,
      done: items.filter((b) => itemStatus(log.get(b.vlId)) === 'sent').length,
      trying: items.filter((b) => itemStatus(log.get(b.vlId)) === 'trying').length,
    };
  });
}

function tryingNow() {
  const log = myLog();
  return gymItems().filter((x) => itemStatus(log.get(x.vlId)) === 'trying')
    .sort((a, b) => (log.get(b.vlId).last || '').localeCompare(log.get(a.vlId).last || ''));
}

function climbFromGym(item) {
  const isRoute = item.kind === 'route';
  let grade = isRoute ? M.ROUTE_GRADES.indexOf(item.grade) : M.boulderIndexByName(set(), item.grade);
  if (grade < 0) grade = isRoute ? 11 : 2;
  return {
    id: uid(), discipline: isRoute ? 'route' : 'boulder', grade, result: 'send', attempts: 2,
    styles: [], holds: [], moves: [], notes: '',
    zone: item.sector, name: `${item.sector} ${item.number}`,
    vlId: item.vlId, vlNumber: item.number, holdColor: item.holdColor, holdName: item.hold,
  };
}

const itemGradeColor = (x) => {
  const fake = { discipline: x.kind === 'route' ? 'route' : 'boulder', grade: x.kind === 'route' ? M.ROUTE_GRADES.indexOf(x.grade) : M.boulderIndexByName(set(), x.grade) };
  return fake.grade >= 0 ? M.gradeColor(fake, set()) : '#999';
};

// ---------------- Componentes ----------------
function gradeChip(c, size = '') {
  if (c.gymColor) return `<span class="grade ${size}" style="${C.gradeStyle(c.gymColorHex || '#999')}">${esc(c.gymColor)}</span>`;
  const g = M.boulderScale(set())[c.grade];
  return `<span class="grade ${size}${c.discipline !== 'route' && g?.joker ? ' joker' : ''}" style="${C.gradeStyle(M.gradeColor(c, set()))}">${esc(M.gradeLabel(c, set()))}</span>`;
}

function holdDot(color, number = '', size = '') {
  if (!color) return '';
  return `<span class="hold ${size}" style="--h:${esc(color)}">${esc(number)}</span>`;
}

function statusBadge(status) {
  if (!status || status === 'none') return '';
  const k = status === 'sent' ? 'send' : status === 'trying' ? 'project' : statusOf(status);
  return `<span class="st-badge st-${STATUS[k].cls}">${icon(STATUS[k].icon)}</span>`;
}

function photoURL(id) {
  const p = state.photos.get(id) || state.draft?.newPhotos?.find((x) => x.id === id);
  if (!p) return '';
  if (!state.urls.has(id)) state.urls.set(id, URL.createObjectURL(p.blob));
  return state.urls.get(id);
}

const sessionPhotos = (sid) => [...state.photos.values()].filter((p) => p.sessionId === sid).sort((a, b) => a.createdAt - b.createdAt);
const TYPE_LABEL = { boulder: 'Bloque', route: 'Vías', mixed: 'Bloque y vías', training: 'Entreno' };
const titleOf = (s) => `${s.kind === 'free' ? 'Sesión libre' : s.kind === 'class' ? 'Clase' : 'Sesión'} · ${(TYPE_LABEL[s.type] || 'escalada').toLowerCase()}`;
const gymOf = (s) => (s.where === 'other' && s.gym ? s.gym : S.GYM.name);
// Colores (circuito) de otros rocódromos, de más fácil a más difícil, con su equivalente del Sharma.
const gymKey = (name) => (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
const gymCircuit = (name) => set().otherGyms?.[gymKey(name)] || null;
const sharmaRegular = () => M.boulderScale(set()).map((g, i) => ({ ...g, i })).filter((g) => !g.joker);
function defaultEq(pos, n) {
  const reg = sharmaRegular();
  return reg[Math.round((pos * (reg.length - 1)) / Math.max(1, n - 1))]?.i ?? 0;
}
const COMMON_COLORS = [['Blanco', '#f4f4f5'], ['Amarillo', '#facc15'], ['Naranja', '#f97316'], ['Verde', '#16a34a'], ['Azul', '#2563eb'], ['Rojo', '#dc2626'], ['Rosa', '#ec4899'], ['Morado', '#7c3aed'], ['Marrón', '#92400e'], ['Gris', '#6b7280'], ['Negro', '#18181b']];
const otherGyms = () => [...new Set(state.sessions.filter((x) => x.where === 'other' && x.gym).map((x) => x.gym))];
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`);
const ago = (ts) => {
  const d = Math.floor((Date.now() - ts) / 86400000);
  return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : d < 7 ? `hace ${d} días` : d < 30 ? `hace ${Math.floor(d / 7)} sem` : `hace ${Math.floor(d / 30)} mes${d >= 60 ? 'es' : ''}`;
};

function avatarHTML(size = '') {
  const name = set().name?.trim() || '';
  return state.avatarURL
    ? `<span class="avatar ${size}"><img src="${state.avatarURL}" alt=""></span>`
    : `<span class="avatar ${size}">${esc((name || '🧗').slice(0, 1).toUpperCase())}</span>`;
}

function sessionCard(s) {
  const climbs = s.climbs || [];
  const sent = climbs.filter(M.isSent).length;
  const tried = climbs.length - sent;
  const photos = sessionPhotos(s.id);
  const top = [...climbs].sort((a, b) => M.intensity(b, set()) - M.intensity(a, set())).slice(0, 12);
  return `<a class="card session-card" href="#/sesion/${s.id}">
    <div class="sc-date"><b>${I.parseDate(s.date).getDate()}</b><span>${I.fmtDate(s.date, { month: 'short' }).replace('.', '')}</span></div>
    <div class="sc-main">
      <div class="sc-title">${esc(titleOf(s))}${s.mood != null ? ` <span class="mood-i">${M.MOODS[s.mood]}</span>` : ''}</div>
      <div class="sc-meta">${climbs.length ? `${plural(sent, 'conseguido', 'conseguidos')}${tried ? ` · ${tried} intentado${tried > 1 ? 's' : ''}` : ''}` : 'Sin bloques apuntados'}${(s.with || []).length ? ` · con ${esc(s.with.join(', '))}` : s.solo ? ' · sola' : ''}${s.where === 'other' ? ` · 📍 ${esc(s.gym)}` : ''}</div>
      ${top.length ? `<div class="sc-grades">${top.map((c) => `<span class="dot${M.isSent(c) ? '' : ' open'}" style="--g:${M.gradeColor(c, set())}"></span>`).join('')}</div>` : ''}
    </div>
    ${photos[0] ? `<img class="sc-thumb" src="${photoURL(photos[0].id)}" alt="">` : `<span class="sc-go">${icon('chevron')}</span>`}
  </a>`;
}

function insightCard(i) {
  return `<div class="insight ${i.tone}"><div class="ins-icon">${i.icon}</div><div><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div></div>`;
}

function emptyState(title, text, actions = '', art = 'wall') {
  return `<div class="empty"><div class="empty-art">${icon(art)}</div><h2>${title}</h2><p>${text}</p>${actions}</div>`;
}

function seg(action, current, options) {
  return `<div class="seg" role="tablist">${Object.entries(options).map(([k, v]) => `<button role="tab" aria-selected="${current === k}" class="${current === k ? 'on' : ''}" data-action="${action}" data-v="${k}">${v}</button>`).join('')}</div>`;
}

const kpi = (v, l, raw = false) => `<div class="kpi"><div class="kpi-v">${raw ? v : esc(v)}</div><div class="kpi-l">${l}</div></div>`;

function ring(value, goal, size = 92) {
  const r = (size - 10) / 2; const c = 2 * Math.PI * r; const p = Math.min(1, goal ? value / goal : 0);
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" style="--len:${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}

// Ficha compacta de un bloque/vía de la sala.
function itemTile(x, status, { inSession = null, showGrade = true } = {}) {
  const isNew = Date.now() - x.date < WEEK;
  return `<button class="tile-b ${inSession ? `in st-${STATUS[statusOf(inSession)].cls}` : `was-${status}`}" data-action="item" data-id="${esc(x.vlId)}">
    ${holdDot(x.holdColor, x.number)}
    ${showGrade ? `<span class="grade xs" style="${C.gradeStyle(itemGradeColor(x))}">${esc(x.grade)}</span>` : ''}
    <small>${isNew ? '<em class="new">NUEVO</em>' : esc(x.sector)}</small>
    ${inSession ? statusBadge(statusOf(inSession)) : statusBadge(status)}
  </button>`;
}

// ---------------- Inicio ----------------
function viewHome() {
  const s = realSessions();
  if (!state.sessions.length && !set().onboarded) return viewOnboarding();
  const name = set().name?.trim();
  const now = new Date();
  const wk = I.weekStart(now).getTime();
  const weekSessions = s.filter((x) => I.parseDate(x.date) >= wk).length;
  const goal = set().weeklyGoal || 1;
  const streak = I.weekStreak(s);
  const pending = state.draft?.isNew ? state.draft : state.stash;
  const insights = I.buildInsights(s, set());
  const last = I.sortSessions(s)[0];
  const hello = now.getHours() < 13 ? 'Buenos días' : now.getHours() < 21 ? 'Buenas tardes' : 'Buenas noches';
  const plan = pending ? null : P.planState(set(), s, state.draft);
  const trying = tryingNow().slice(0, 8);
  const log = myLog();
  const live = pending ? `<a class="live-card" href="#/nueva">
      <span class="pulse"></span>
      <div><b>Sesión en curso</b><small>${plural(pending.climbs.length, 'bloque apuntado', 'bloques apuntados')}</small></div>
      <span class="btn sm light">Continuar</span></a>` : '';
  return `<header class="home-head">
      <div><p class="eyebrow">${esc(now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
      <h1>${hello}${name ? `, ${esc(name)}` : ''}</h1></div>
      <a href="#/perfil" aria-label="Tu perfil">${avatarHTML()}</a>
    </header>
    ${live}${plan ? planCardHTML(plan) : ''}
    ${levelCard()}
    <section class="hero">
      <div class="hero-ring">${ring(weekSessions, goal)}<div class="hero-ring-v"><b>${weekSessions}</b><small>de ${goal}</small></div></div>
      <div class="hero-txt">
        <p class="hero-k">Esta semana</p>
        <h2>${weekSessions >= goal ? '¡Objetivo cumplido!' : goal - weekSessions === 1 ? (goal === 1 ? 'Te falta tu sesión' : 'Te queda 1 sesión') : `Te quedan ${goal - weekSessions} sesiones`}</h2>
        ${streak ? `<div class="hero-chips"><span>${icon('fire')} ${plural(streak, 'semana seguida', 'semanas seguidas')}</span></div>` : ''}
      </div>
    </section>
    ${!pending && !(plan?.today || plan?.pending) ? `<a class="btn primary block big" href="#/nueva" data-action="start-session">${icon('plus')} Registrar sesión</a>` : ''}
    ${trying.length ? `<section><div class="section-head"><h2 class="section-title">Bloques que estás intentando</h2><a href="#/sala" data-action="gym-filter-trying">Ver todos</a></div>
      <p class="muted small sub">Bloques que has intentado y siguen montados. ¡A por ellos!</p>
      <div class="tiles-row">${trying.map((x) => itemTile(x, itemStatus(log.get(x.vlId)))).join('')}</div></section>` : ''}
    ${last ? `<section><div class="section-head"><h2 class="section-title">Tu última sesión</h2><a href="#/diario">Ver todas</a></div>${sessionCard(last)}</section>` : ''}
    ${insights.length ? `<section><h2 class="section-title">Para ti</h2><div class="insights">${[...noteInsights(), ...insights].slice(0, 2).map(insightCard).join('')}</div></section>` : ''}
    ${homeEvents()}
    ${backupCard()}
    ${installCard()}
    ${!s.length ? `<div class="card soft center"><p>¿Quieres ver cómo queda con datos? Puedes cargar datos de ejemplo y borrarlos después en Ajustes.</p><button class="btn ghost" data-action="demo">Ver con datos de ejemplo</button></div>` : ''}`;
}

// Siguiente color/grado a por el que ir, según lo conseguido.
// «Rojo» → «rojos», «Azul» → «azules».
const colorPlural = (n) => { const w = n.toLowerCase(); return /[aeiou]$/.test(w) ? `${w}s` : `${w}es`; };

// Tarjeta de nivel: tu color actual como medalla, progreso y siguiente color.
function levelCard() {
  const climbs = I.allClimbs(state.sessions);
  const scale = M.boulderScale(set());
  const regular = scale.map((g, i) => ({ ...g, i })).filter((g) => !g.joker);
  const bSent = climbs.filter((c) => c.discipline === 'boulder' && M.isSent(c)).map((c) => c.grade);
  const best = bSent.length ? Math.max(...bSent) : null;
  const cur = best != null ? regular.filter((g) => g.i <= best).pop() : null;
  const start = cur ? null : regular.find((g) => g.name === set().usualCircuit) || regular[0];
  const next = cur ? regular.find((g) => g.i > cur.i) : start;
  const level = cur || start;
  if (!level) return '';
  const atLevel = cur ? bSent.filter((g) => g === cur.i).length : 0;
  const goal = atLevel < 3 ? 3 : atLevel < 5 ? 5 : atLevel < 10 ? 10 : 20;
  const tried = next ? climbs.filter((c) => c.discipline === 'boulder' && !M.isSent(c) && c.grade === next.i).length : 0;
  const rSent = climbs.filter((c) => c.discipline === 'route' && M.isSent(c)).map((c) => c.grade);
  const bestR = rSent.length ? Math.max(...rSent) : null;
  const fg = C.textOn(level.color.startsWith('#') ? level.color : '#888');
  const levelNum = regular.findIndex((g) => g.i === level.i) + 1;
  return `<a class="card level-card" href="#/progreso" data-action="prog-tab" data-v="resumen" style="--lc:${esc(level.color)};--lt:${fg}">
    <div class="lc-medal"><span class="lc-ring"></span><b>${levelNum}</b><small>nivel</small></div>
    <div class="lc-main">
      <p class="lc-k">${cur ? 'Tu nivel' : 'Empiezas en'}</p>
      <h3>${esc(level.name)}</h3>
      ${cur ? `<div class="lc-bar"><i style="width:${Math.min(100, Math.round(atLevel / goal * 100))}%"></i></div>
        <small>${atLevel} ${atLevel === 1 ? `bloque ${esc(level.name.toLowerCase())}` : `bloques ${esc(colorPlural(level.name))}`} · objetivo ${goal}</small>`
        : '<small>Apunta tu primera sesión para empezar a subir</small>'}
      ${next && cur ? `<div class="lc-next">Siguiente ${gradeChip({ discipline: 'boulder', grade: next.i }, 'xs')} ${tried ? `<span>· lo has intentado ${plural(tried, 'vez', 'veces')}</span>` : ''}</div>` : (cur && !next ? '<div class="lc-next">👑 ¡Estás en el color más difícil!</div>' : '')}
      ${bestR != null ? `<div class="lc-next">En vías ${gradeChip({ discipline: 'route', grade: bestR }, 'xs')} <span>· siguiente ${esc(M.ROUTE_GRADES[Math.min(bestR + 1, M.ROUTE_GRADES.length - 1)])}</span></div>` : ''}
    </div>
  </a>`;
}

// Avisos a partir de las notas (p. ej. molestias repetidas).
function noteInsights() {
  const recent = I.sortSessions(state.sessions).slice(0, 4);
  const hurt = recent.filter((s) => (s.topics || N.topicsOf(s.notes)).includes('molestias')).length;
  const fear = recent.filter((s) => (s.topics || N.topicsOf(s.notes)).includes('cabeza')).length;
  const out = [];
  if (hurt >= 2) out.push({ icon: '🩹', tone: 'warn', title: 'Has apuntado molestias varias veces', text: 'Escúchate: baja un poco la intensidad, calienta bien y, si el dolor sigue, consulta con un fisio.' });
  if (fear >= 2) out.push({ icon: '🧠', tone: 'info', title: 'El miedo aparece en tus notas', text: 'Es muy normal. Practica caídas desde poca altura y sube en bloques fáciles para ganar confianza.' });
  return out;
}

function planCardHTML(plan) {
  const typeBtns = (date) => `<div class="plan-btns">
      <button class="btn primary" data-action="plan-start" data-date="${date}" data-type="boulder">${icon('boulder')} Bloque</button>
      <button class="btn primary alt" data-action="plan-start" data-date="${date}" data-type="route">${icon('rope')} Vías</button></div>`;
  if (plan.pending) {
    return `<div class="card plan warn-card">
      <div class="plan-head"><span class="plan-ic">${icon('calendar')}</span><div><b>¿Qué tal la sesión ${esc(P.sessionOf(plan.pending))}?</b><small>Aún no la has registrado. ¿Qué tocó?</small></div></div>
      ${typeBtns(plan.pending)}
      <button class="link muted-link" data-action="plan-skip" data-date="${plan.pending}">No fui a escalar</button></div>`;
  }
  if (plan.today) {
    return `<div class="card plan">
      <div class="plan-head"><span class="plan-ic">${icon('clock')}</span><div><b>Hoy toca escalar${plan.today.after ? '' : ` a las ${esc(plan.time)}`}</b><small>${plan.today.after ? 'Apunta los bloques que has hecho.' : '¿Bloque o vías? Ábrelo al llegar.'}</small></div></div>
      ${typeBtns(plan.today.date)}</div>`;
  }
  if (plan.next) {
    return `<button class="next-line" data-action="open-plan">${icon('calendar')}<span>Próxima sesión: <b>${esc(P.niceDate(plan.next, false))}</b> · ${esc(plan.time)}</span>${icon('chevron')}</button>`;
  }
  return `<button class="next-line" data-action="open-plan">${icon('calendar')}<span>Configura tus días de escalada</span>${icon('chevron')}</button>`;
}

function planSheet() {
  const st = set(); const sch = st.schedule || { days: [4], time: '19:00' };
  const extras = (st.extraDates || []).filter((d) => d >= I.today()).sort();
  openSheet(`<div class="sheet">
    <div class="grabber"></div>
    <div class="sheet-head"><span></span><b>Tus días de escalada</b><button class="link" data-action="close-sheet" type="button">Listo</button></div>
    <div class="sheet-body">${scheduleFields(sch, extras)}</div></div>`);
}

function scheduleFields(sch, extras) {
  return `<div class="field"><span>Días fijos</span>
      <div class="weekdays">${P.WEEKDAYS.map(([d, l]) => `<button class="wd ${(sch.days || []).map(String).includes(d) ? 'on' : ''}" data-action="sch-day" data-v="${d}" aria-label="${l}">${l}</button>`).join('')}</div></div>
    <label class="field inline"><span>Hora de la clase</span><input type="time" data-sch-time value="${esc(sch.time || '19:00')}"></label>
    <div class="field"><span>Días sueltos <small class="muted">p. ej. un sábado que vais</small></span>
      <div class="chips">${extras.map((d) => `<span class="chip on">${esc(P.niceDate(d))} <button class="chip-x" data-action="sch-extra-del" data-v="${d}" aria-label="Quitar">${icon('close')}</button></span>`).join('')}
        <button class="chip" data-action="sch-extra-add" data-v="${I.toISO(new Date(Date.now() + 86400000))}">＋ Mañana</button>
        <label class="chip">＋ Otro día<input type="date" data-sch-extra min="${I.today()}" class="hidden-date"></label></div></div>
    <button class="btn ghost block" data-action="ics">${icon('calendar')} Añadir recordatorios a mi calendario</button>
    <p class="muted small">Se crea un evento semanal en el calendario del móvil que te avisa antes de la clase y, al terminar, te recuerda apuntar la sesión.</p>`;
}

// ---------------- Eventos y novedades ----------------
const SHARMA_IG = 'https://www.instagram.com/sharmaclimbingmadrid/';
const evDate = (iso) => new Date(iso.replace(' ', 'T'));
const evDay = (iso) => evDate(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });

function allEvents() {
  const web = (state.events?.events || []).map((e) => ({ ...e, source: 'sharma', cats: [...new Set(e.cats || [])] }));
  const mine = (set().myEvents || []).map((e) => ({ id: e.id, title: e.title, start: `${e.date} 00:00:00`, end: `${e.end || e.date} 23:59:59`, url: e.url, summary: e.note, source: 'mine', cats: [] }));
  return [...web, ...mine].sort((a, b) => a.start.localeCompare(b.start));
}

function newBlocks(days = 30) {
  const items = gymItems().filter((x) => Date.now() - x.date < days * 86400000);
  const groups = {};
  items.forEach((x) => { const k = `${I.toISO(new Date(x.date))}|${x.sector}`; (groups[k] ||= []).push(x); });
  return Object.entries(groups).map(([k, list]) => { const [date, sector] = k.split('|'); return { date, sector, list }; })
    .sort((a, b) => b.date.localeCompare(a.date) || a.sector.localeCompare(b.sector));
}

// Tarjeta visual de evento (con la imagen del evento si la hay).
function evTile(e) {
  const d = evDate(e.start);
  const img = e.image && /^https:\/\//.test(e.image) ? e.image : null;
  const hue = [...(e.title || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `<a class="ev-tile ${img ? 'has-img' : ''}" ${e.url && /^https?:\/\//.test(e.url) ? `href="${esc(e.url)}" target="_blank" rel="noopener"` : 'href="#/eventos"'} style="--h:${hue}">
    ${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
    <span class="ev-badge"><b>${d.getDate()}</b>${esc(d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', ''))}</span>
    <span class="ev-tile-txt"><small>${e.source === 'mine' ? 'Apuntado por ti' : esc((e.cats || [])[0] || 'Sharma')}</small><b>${esc(e.title)}</b></span>
  </a>`;
}

function homeEvents() {
  const now = new Date();
  const upcoming = allEvents().filter((e) => evDate(e.end || e.start) >= now);
  const fresh = gymItems().filter((x) => Date.now() - x.date < WEEK).length;
  return `<section class="home-events"><div class="section-head"><h2 class="section-title">Eventos</h2><a href="#/eventos">Ver todo</a></div>
    ${upcoming.length ? `<div class="ev-carousel">${upcoming.slice(0, 6).map((e) => evTile(e)).join('')}</div>`
      : `<a class="card ev-empty" href="#/eventos"><span>🎉</span><div><b>Sin eventos próximos</b><small>${fresh ? `Pero hay ${plural(fresh, 'bloque nuevo', 'bloques nuevos')} en la sala esta semana` : 'Mira las novedades de la sala'}</small></div>${icon('chevron', 'muted')}</a>`}
  </section>`;
}

function eventCard(e, past = false) {
  const d = evDate(e.start);
  const multi = e.end && e.end.slice(0, 10) !== e.start.slice(0, 10);
  const img = e.image && /^https:\/\//.test(e.image) ? e.image : null;
  return `<div class="card event ${past ? 'past' : ''} ${img ? 'with-img' : ''}">
    ${img ? `<img class="ev-img" src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
    <div class="ev-date"><b>${d.getDate()}</b><span>${d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}</span></div>
    <div class="ev-main">
      <div class="ev-tags">${e.source === 'mine' ? '<span class="ev-tag mine">Apuntado por ti</span>' : '<span class="ev-tag">Sharma</span>'}${(e.cats || []).map((c) => `<span class="ev-tag">${esc(c)}</span>`).join('')}</div>
      <b>${esc(e.title)}</b>
      ${multi ? `<small class="muted">Hasta el ${esc(evDay(e.end))}</small>` : ''}
      ${e.summary ? `<p>${esc(e.summary)}</p>` : ''}
      <div class="row-gap">${e.url && /^https?:\/\//.test(e.url) ? `<a class="link" href="${esc(e.url)}" target="_blank" rel="noopener">Ver más ${icon('external')}</a>` : ''}
        ${e.source === 'mine' ? `<button class="link danger" data-action="myev-del" data-id="${esc(e.id)}">${icon('trash')} Borrar</button>` : ''}</div>
    </div></div>`;
}

function viewEvents() {
  const now = new Date();
  const evs = allEvents();
  const upcoming = evs.filter((e) => evDate(e.end || e.start) >= now);
  const past = evs.filter((e) => evDate(e.end || e.start) < now).reverse().slice(0, 6);
  const blocks = newBlocks(30).slice(0, 8);
  const scale = M.boulderScale(set());
  const fetched = state.events?.fetchedAt;
  return `<section class="ev-hero">
      <p class="eyebrow">${esc(S.GYM.name)}</p>
      <h1>Eventos</h1>
      <p>Lo que pasa en tu rocódromo: eventos, bloques nuevos y planes.</p>
      <button class="btn light sm" data-action="myev-add">${icon('plus')} Apuntar evento</button>
    </section>
    <h2 class="section-title">Próximos</h2>
    ${upcoming.length ? `<div class="list">${upcoming.map((e) => eventCard(e)).join('')}</div>`
      : `<div class="card ev-none"><span>📭</span><div><b>No hay eventos publicados</b><small>¿Has visto algo en su Instagram (Black Friday, Día del Socio…)? Apúntalo arriba.</small></div></div>`}
    <a class="card ig" href="${SHARMA_IG}" target="_blank" rel="noopener"><span class="ig-ic">📷</span><div><b>Instagram del Sharma Madrid</b><small>Promociones, avisos y novedades del día a día</small></div>${icon('external', 'muted')}</a>
    ${blocks.length ? `<div class="section-head"><h2 class="section-title">Bloques nuevos</h2><a href="#/sala" data-action="gym-filter-new">Ver en la sala</a></div>
      <div class="nb-carousel">${blocks.map((b) => {
        const byColor = {};
        b.list.forEach((x) => { byColor[x.grade] = (byColor[x.grade] || 0) + 1; });
        const dots = Object.entries(byColor).sort((x, y) => (scale.findIndex((g) => g.name === x[0]) - scale.findIndex((g) => g.name === y[0])) || x[0].localeCompare(y[0]))
          .map(([g, n]) => `<i style="background:${itemGradeColor(b.list.find((x) => x.grade === g))}" title="${esc(g)}"></i>`.repeat(Math.min(n, 6))).join('');
        return `<button class="nb-card" data-action="news-sector" data-sector="${esc(b.sector)}" data-kind="${b.list[0].kind}" data-recent="${Date.now() - b.list[0].date < WEEK ? 1 : ''}">
          <small>${esc(P.niceDate(b.date, false))}</small><b>${esc(b.sector)}</b>
          <span class="nb-n">${b.list.length}<em>${b.list[0].kind === 'route' ? (b.list.length === 1 ? 'vía nueva' : 'vías nuevas') : (b.list.length === 1 ? 'bloque nuevo' : 'bloques nuevos')}</em></span>
          <span class="nb-dots">${dots}</span>
        </button>`;
      }).join('')}</div>` : ''}
    ${past.length ? `<h2 class="section-title">Anteriores</h2><div class="ev-carousel">${past.map((e) => evTile(e)).join('')}</div>` : ''}
    <p class="muted small center src">Se actualiza solo cada día${fetched ? ` · última vez ${ago(fetched)}` : ''}.</p>`;
}

function myEventSheet() {
  openSheet(`<div class="sheet">
    <div class="grabber"></div>
    <div class="sheet-head"><button class="link" data-action="close-sheet" type="button">Cancelar</button><b>Apuntar evento</b><span></span></div>
    <div class="sheet-body">
      <label class="field"><span>¿Qué es?</span><input data-myev="title" placeholder="p. ej. Black Friday en el Sharma" maxlength="80"></label>
      <div class="two"><label class="field"><span>Empieza</span><input type="date" data-myev="date" value="${I.today()}"></label>
      <label class="field"><span>Termina <small class="muted">opcional</small></span><input type="date" data-myev="end"></label></div>
      <label class="field"><span>Nota <small class="muted">opcional</small></span><textarea data-myev="note" rows="2" placeholder="p. ej. 20% en abonos y material"></textarea></label>
      <label class="field"><span>Enlace <small class="muted">opcional</small></span><input data-myev="url" type="url" placeholder="https://…"></label>
    </div>
    <div class="sheet-foot"><button class="btn primary block" data-action="myev-save">Guardar evento</button></div></div>`);
}

function backupCard() {
  const n = state.sessions.filter((x) => !x.demo).length;
  const last = set().lastBackup || 0;
  if (n < 4 || Date.now() - last < 30 * 86400000) return '';
  return `<div class="card install backup">${icon('download')}<div><b>Guarda una copia de tus sesiones</b><small>${last ? 'Hace más de un mes de tu última copia.' : 'Por si cambias de móvil o algo falla.'}</small></div>
    <button class="btn sm primary" data-action="export">Guardar</button></div>`;
}

function installCard() {
  if (isStandalone() || set().installDismissed) return '';
  if (state.installEvt) {
    return `<div class="card install">${icon('install')}<div><b>Instala la app</b><small>Se abre como una app, funciona sin cobertura y tus sesiones quedan guardadas.</small></div>
      <button class="btn sm primary" data-action="install">Instalar</button><button class="x-btn" data-action="install-dismiss" aria-label="Cerrar">${icon('close')}</button></div>`;
  }
  if (isIOS()) {
    return `<div class="card install">${icon('install')}<div><b>Instálala en tu pantalla de inicio</b><small>Así se abre como una app y tus sesiones quedan guardadas. En Safari: ${icon('share', 'inline')} Compartir → «Añadir a pantalla de inicio».</small></div>
      <button class="x-btn" data-action="install-dismiss" aria-label="Cerrar">${icon('close')}</button></div>`;
  }
  return '';
}

// ---------------- Bienvenida ----------------
function viewOnboarding() {
  if (state.ui.onb === 0) {
    return `<div class="onb">
      <div class="onb-art">${icon('wall')}</div>
      <p class="eyebrow">Tu cuaderno de escalada</p>
      <h1>Escala, apunta,<br><span class="accent">progresa.</span></h1>
      <p class="onb-sub">Tu diario de escalada en ${esc(S.GYM.name)}.</p>
      <ul class="onb-list">
        <li>${icon('check')}<div><b>Apunta tus bloques con un toque</b><small>Salen los bloques que hay montados en la sala.</small></div></li>
        <li>${icon('refresh')}<div><b>Sabe cuáles te faltan</b><small>Conseguidos, los que estás intentando y los que no has probado.</small></div></li>
        <li>${icon('chart')}<div><b>Mira cómo mejoras</b><small>Tu color más difícil, tus colores y tu constancia.</small></div></li>
      </ul>
      <button class="btn primary block big" data-action="onb-next">Empezar</button>
      <button class="btn ghost block" data-action="demo">Ver con datos de ejemplo</button>
    </div>`;
  }
  const scale = M.boulderScale(set()).filter((g) => !g.joker);
  return `<div class="onb">
    <p class="eyebrow">Paso 2 de 2</p>
    <h1>Cuéntanos un poco de ti</h1>
    <label class="field"><span>¿Cómo te llamas?</span><input data-setting="name" value="${esc(set().name)}" placeholder="Tu nombre" autocomplete="given-name"></label>
    <div class="field"><span>¿Qué días sueles ir a escalar?</span>
      <div class="weekdays">${P.WEEKDAYS.map(([d, l]) => `<button class="wd ${(set().schedule?.days || []).map(String).includes(d) ? 'on' : ''}" data-action="sch-day" data-v="${d}">${l}</button>`).join('')}</div></div>
    <label class="field inline"><span>¿A qué hora?</span><input type="time" data-sch-time value="${esc(set().schedule?.time || '19:00')}"></label>
    <div class="field"><span>¿Qué color de bloque sueles escalar?</span>
      <div class="grade-grid">${scale.map((g) => `<button class="grade-pick ${set().usualCircuit === g.name ? 'on' : ''}" style="${C.gradeStyle(g.color)}" data-action="set-usual" data-v="${esc(g.name)}">${esc(g.name)}</button>`).join('')}</div></div>
    <button class="btn primary block big" data-action="onb-done">¡Vamos!</button>
  </div>`;
}

// ---------------- Diario ----------------
// ---------------- Perfil ----------------
function viewProfile() {
  const st = set();
  const ss = state.sessions;
  const first = ss.length ? I.sortSessions(ss)[ss.length - 1].date : null;
  const nReal = realSessions().length;
  const sent = I.allClimbs(ss).filter((c) => M.isSent(c) && c.discipline === 'boulder');
  const best = sent.length ? sent.reduce((m, c) => (c.grade > m.grade ? c : m)) : null;
  const ach = achievementsNow();
  const got = ach.reduce((a, x) => a + x.level, 0);
  return `<div class="topline"><a href="#/inicio" class="back">${icon('back')} Inicio</a><a href="#/ajustes" class="icon-btn ghost" aria-label="Ajustes">${icon('settings')}</a></div>
    <section class="profile">
      <label class="prof-photo" aria-label="Cambiar foto de perfil">${avatarHTML('xl')}<span class="prof-cam">${icon('camera')}</span><input type="file" accept="image/*" data-upload="avatar" hidden></label>
      <h1>${esc(st.name || 'Tu perfil')}</h1>
      <p class="prof-sub">${first ? `Escalando desde ${esc(I.parseDate(first).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }))}` : 'Bienvenida a tu cuaderno'} · ${esc(S.GYM.name.replace('Sharma Climbing', 'Sharma'))}</p>
      ${best ? `<div class="prof-level">Nivel ${gradeChip(best, 'sm')}</div>` : ''}
      <div class="prof-stats">
        <div><b>${nReal}</b><span>sesiones</span></div>
        <div><b>${I.allClimbs(ss).filter(M.isSent).length}</b><span>conseguidos</span></div>
        <div><b>${got}</b><span>logros</span></div>
      </div>
    </section>
    <div class="prof-links">
      <a class="card prof-link" href="#/progreso" data-action="prog-tab" data-v="resumen">${icon('chart')}<span><b>Tu progreso</b><small>Nivel, colores y semanas</small></span>${icon('chevron', 'muted')}</a>
      <a class="card prof-link" href="#/objetivos">${icon('trophy')}<span><b>Tus objetivos</b><small>${got} conseguidos</small></span>${icon('chevron', 'muted')}</a>
    </div>
    ${monthCalendar()}
    <div class="section-head"><h2 class="section-title">Mis sesiones</h2><button class="link" data-action="past-session">${icon('plus')} Añadir sesión pasada</button></div>
    ${historyBody()}
    ${looseSection()}`;
}

// Calendario del mes con los días de clase, libres y bloques sueltos.
function monthCalendar() {
  const now = new Date();
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const ym = state.ui.calMonth || cur;
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const byDay = {};
  realSessions().forEach((x) => {
    if (!x.date.startsWith(ym)) return;
    const b = (byDay[x.date] ||= { cls: 0, free: 0 });
    if (x.kind === 'free') b.free++; else b.cls++;
  });
  const tot = Object.values(byDay).reduce((a, b) => ({ cls: a.cls + b.cls, free: a.free + b.free }), { cls: 0, free: 0 });
  const t = I.today();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<span class="cd empty"></span>');
  for (let dd = 1; dd <= days; dd++) {
    const iso = `${ym}-${String(dd).padStart(2, '0')}`;
    const b = byDay[iso];
    const kind = b ? (b.cls && b.free ? 'both' : b.cls ? 'cls' : b.free ? 'free' : '') : '';
    const cls = ['cd', kind, iso === t ? 'today' : '', iso > t ? 'future' : ''].filter(Boolean).join(' ');
    cells.push(b ? `<button class="${cls}" data-action="cal-day" data-v="${iso}" aria-label="${dd}">${dd}</button>` : `<span class="${cls}">${dd}</span>`);
  }
  const label = cap(first.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }));
  return `<div class="card cal">
    <div class="cal-head"><button class="icon-btn ghost" data-action="cal-nav" data-d="-1" aria-label="Mes anterior">${icon('back')}</button>
      <b>${esc(label)}</b>
      <button class="icon-btn ghost" data-action="cal-nav" data-d="1" aria-label="Mes siguiente" ${ym >= cur ? 'disabled' : ''}>${icon('chevron')}</button></div>
    <div class="cal-grid">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((w) => `<span class="cw">${w}</span>`).join('')}${cells.join('')}</div>
    <div class="cal-foot"><span><i class="k cls"></i>Clase${tot.cls ? ` · ${tot.cls}` : ''}</span><span><i class="k free"></i>Libre${tot.free ? ` · ${tot.free}` : ''}</span></div>
  </div>`;
}

// Bloques apuntados fuera de una sesión, agrupados por día.
function looseSection() {
  const loose = I.sortSessions(state.sessions.filter((x) => x.loose && (x.climbs || []).length));
  if (!loose.length) return '';
  return `<h2 class="section-title">Apuntados por separado</h2>
    <p class="muted small sub">Bloques que marcaste desde la Sala, sin sesión. Para borrar uno, ábrelo en la Sala.</p>
    ${loose.slice(0, 12).map((x) => `<h3 class="month">${esc(cap(P.niceDate(x.date, false)))}</h3><div class="list">${x.climbs.slice().reverse().map(climbRow).join('')}</div>`).join('')}`;
}

function historyBody() {
  const { histTab } = state.ui;
  const tabs = `<div class="chips">${Object.entries({ sessions: 'Lista', photos: 'Fotos' }).map(([k, v]) => `<button class="chip sm ${histTab === k ? 'on' : ''}" data-action="hist-tab" data-v="${k}">${v}</button>`).join('')}</div>`;
  if (histTab === 'photos') {
    const photos = [...state.photos.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
    return `${tabs}${photos.length ? `<div class="gallery">${photos.map((p) => `<button class="thumb" data-action="photo" data-id="${p.id}"><img src="${photoURL(p.id)}" alt="" loading="lazy"></button>`).join('')}</div>`
      : emptyState('Sin fotos todavía', 'Puedes añadir fotos al apuntar una sesión.', '', 'camera')}`;
  }
  const list = I.sortSessions(realSessions());
  const groups = {};
  list.forEach((x) => { const k = x.date.slice(0, 7); (groups[k] ||= []).push(x); });
  return `${list.length ? tabs : ''}
    ${list.length ? Object.entries(groups).map(([k, ss]) => {
      const [y, m] = k.split('-').map(Number);
      const label = cap(new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }));
      return `<h2 class="month">${label} <span class="muted">${plural(ss.length, 'sesión', 'sesiones')}</span></h2><div class="list">${ss.map(sessionCard).join('')}</div>`;
    }).join('') : emptyState('Aún no hay sesiones', 'Cuando apuntes tu primera sesión aparecerá aquí.', '<a class="btn primary" href="#/nueva">Registrar sesión</a>', 'book')}`;
}

// ---------------- Detalle de sesión ----------------
function viewDetail(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return emptyState('Sesión no encontrada', '', '<a class="btn" href="#/diario">Volver</a>');
  const climbs = s.climbs || [];
  const photos = sessionPhotos(s.id);
  const sent = climbs.filter(M.isSent);
  const flashes = climbs.filter((c) => statusOf(c.result) === 'flash').length;
  const specific = climbs.filter((c) => c.vlId);
  const date = I.parseDate(s.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const topics = s.topics || N.topicsOf(s.notes);
  const byGrade = {};
  climbs.forEach((c) => { const k = `${c.discipline}|${c.gymColor ? `gc:${c.gymColor}` : c.grade}`; const r = (byGrade[k] ||= { c, sent: 0, tried: 0 }); if (M.isSent(c)) r.sent++; else r.tried++; });
  const rows = Object.values(byGrade).sort((a, b) => a.c.discipline.localeCompare(b.c.discipline) || b.c.grade - a.c.grade);
  return `<div class="topline"><a href="#/diario" class="back">${icon('back')} Mis sesiones</a>
      <a class="btn sm" href="#/editar/${s.id}">${icon('edit')} Editar</a></div>
    <p class="eyebrow">${esc(date)}</p>
    <h1 class="page-title">${esc(titleOf(s))}${s.mood != null ? ` ${M.MOODS[s.mood]}` : ''}</h1>
    <p class="with-line">📍 ${esc(gymOf(s))}${(s.with || []).length ? ` · 👯 Con ${esc(s.with.join(', '))}` : s.solo ? ' · 🙋‍♀️ Sola' : ''}</p>
    <section class="kpis three">
      ${kpi(sent.length, 'conseguidos')}
      ${kpi(flashes, 'a la primera')}
      ${kpi(climbs.length - sent.length, 'intentados')}
    </section>
    <button class="btn share-btn block" data-action="share-img" data-id="${s.id}">${icon('camera')} Crear imagen para compartir</button>
    ${rows.length ? `<div class="card"><h3>Por ${rows.some((r) => r.c.discipline === 'route') && !rows.some((r) => r.c.discipline === 'boulder') ? 'grado' : 'color'}</h3>
      ${rows.map((r) => `<div class="drow">${r.c.gymColor ? `<span class="eqwrap">${gradeChip(r.c, 'sm')}<small>≈ ${esc(M.gradeLabel({ discipline: 'boulder', grade: r.c.grade }, set()))}</small></span>` : gradeChip(r.c, 'sm')}<span class="st-text-send">${r.sent ? `${icon('check', 'inline')} ${r.sent}` : ''}</span><span class="st-text-proj">${r.tried ? `${icon('refresh', 'inline')} ${r.tried}` : ''}</span></div>`).join('')}</div>` : ''}
    ${s.notes ? `<div class="card notes">${esc(s.notes).replace(/\n/g, '<br>')}${topics.length ? `<div class="note-topics">${N.topicChips(topics)}</div>` : ''}</div>` : ''}
    ${specific.length ? `<h2 class="section-title">Bloques de la sala</h2><div class="list">${specific.map(climbRow).join('')}</div>` : ''}
    ${photos.length ? `<h2 class="section-title">Fotos</h2><div class="gallery">${photos.map((p) => `<button class="thumb" data-action="photo" data-id="${p.id}"><img src="${photoURL(p.id)}" alt=""></button>`).join('')}</div>` : ''}
    <button class="btn danger ghost block" data-action="delete-session" data-id="${s.id}">${icon('trash')} Eliminar sesión</button>`;
}

// Doble toque para acciones que borran: el primer toque pide confirmación.
function armed(el, text) {
  if (el.classList.contains('confirm')) { clearTimeout(el._t); return true; }
  const orig = el.innerHTML;
  el.classList.add('confirm'); el.innerHTML = `${icon('trash')} ${text}`; haptic(20);
  el._t = setTimeout(() => { if (el.isConnected) { el.classList.remove('confirm'); el.innerHTML = orig; } }, 4000);
  return false;
}

async function shareSessionImage(id, opts = {}) {
  const s = state.sessions.find((x) => x.id === id); if (!s) return;
  toast('Creando imagen…');
  const climbs = s.climbs || [];
  const disc = climbs.some((c) => c.discipline === 'boulder') ? 'boulder' : 'route';
  const by = {};
  climbs.filter((c) => c.discipline === disc).forEach((c) => { const r = (by[c.gymColor ? `gc:${c.gymColor}` : c.grade] ||= { label: c.gymColor || M.gradeLabel(c, set()), color: toHex(c.gymColorHex || M.gradeColor(c, set())), sent: 0, tried: 0, g: c.grade + (c.gymColor ? 0.5 : 0) }); if (M.isSent(c)) r.sent++; else r.tried++; });
  const sent = climbs.filter(M.isSent);
  const best = [...sent].sort((a, b) => (a.discipline === b.discipline ? b.grade - a.grade : a.discipline === disc ? -1 : 1))[0];
  const blob = await sessionImage({
    name: set().name, title: titleOf(s).replace(' · ', ' de '), gym: gymOf(s),
    date: I.parseDate(s.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }),
    with: (s.with || []).join(', '), solo: !!s.solo && !(s.with || []).length, mood: s.mood != null ? M.MOODS[s.mood] : '',
    sent: sent.length, flash: climbs.filter((c) => statusOf(c.result) === 'flash').length, tried: climbs.length - sent.length,
    rowsTitle: disc === 'route' ? 'Vías por grado' : 'Bloques por color',
    rows: [...Object.values(by).sort((a, b) => b.g - a.g), ...(() => { const inv = climbs.filter((c) => c.discipline === 'invented'); return inv.length ? [{ label: 'Inventado', color: M.INVENTED_COLOR, sent: inv.filter(M.isSent).length, tried: inv.filter((c) => !M.isSent(c)).length }] : []; })()],
    hardest: best ? { label: M.gradeLabel(best, set()), color: toHex(M.gradeColor(best, set())) } : null,
  });
  showShareSheet(blob, `escalada-${s.date}.png`, opts.afterSave ? '¡Sesión guardada! 💪' : 'Tu sesión', opts.afterSave ? '¿Quieres compartir el resumen o guardarlo en tu móvil?' : '');
}

// Hoja con la imagen generada y botones para compartir o guardar.
function showShareSheet(blob, filename, title, subtitle = '') {
  const file = new File([blob], filename, { type: 'image/png' });
  if (state.shareURL) URL.revokeObjectURL(state.shareURL);
  const url = URL.createObjectURL(blob);
  state.shareURL = url; state.shareFile = file;
  openSheet(`<div class="sheet">
    <div class="grabber"></div>
    <div class="sheet-head"><span></span><b>${esc(title)}</b><button class="link" data-action="close-sheet" type="button">Cerrar</button></div>
    <div class="sheet-body">${subtitle ? `<p class="muted small center share-sub">${esc(subtitle)}</p>` : ''}<img class="share-preview" src="${url}" alt="Imagen resumen"></div>
    <div class="sheet-foot">
      <a class="btn ghost" href="${url}" download="${esc(filename)}">${icon('download')} Guardar</a>
      ${navigator.canShare?.({ files: [file] }) ? `<button class="btn primary" data-action="share-file">${icon('share')} Compartir</button>` : ''}
    </div></div>`);
}

// Imagen de «Mi progreso».
async function shareProgressImage() {
  toast('Creando imagen…');
  const all = state.sessions; const real = realSessions();
  const climbs = I.allClimbs(all);
  const scale = M.boulderScale(set());
  const regular = scale.map((g, i) => ({ ...g, i })).filter((g) => !g.joker);
  const bSent = climbs.filter((c) => c.discipline === 'boulder' && M.isSent(c));
  const best = bSent.length ? Math.max(...bSent.map((c) => c.grade)) : null;
  const cur = best != null ? regular.filter((g) => g.i <= best).pop() : null;
  const next = cur ? regular.find((g) => g.i > cur.i) : null;
  const first = real.length ? I.sortSessions(real)[real.length - 1].date : (all.length ? I.sortSessions(all)[all.length - 1].date : null);
  const weeks = I.weeklyProgress(all, 'boulder', 10);
  const top = Math.max(1, ...weeks.map((w) => w.max ?? 0)) + 1;
  const blob = await progressImage({
    name: set().name, gym: set().gym, avatar: state.avatarURL,
    since: first ? `Escalando desde ${I.parseDate(first).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}` : '',
    level: cur ? { name: cur.name, color: toHex(cur.color), num: regular.findIndex((g) => g.i === cur.i) + 1, next: next?.name } : null,
    stats: [[real.length, 'sesiones'], [climbs.filter(M.isSent).length, 'conseguidos'], [climbs.filter((c) => statusOf(c.result) === 'flash').length, 'a la primera'], [I.weekStreak(real), 'semanas seguidas']],
    rowsTitle: 'Bloques conseguidos por color',
    rows: regular.map((g) => ({ label: g.name, color: toHex(g.color), sent: bSent.filter((c) => c.grade === g.i).length })).filter((r) => r.sent).reverse(),
    weeks: weeks.map((w) => ({ color: w.max != null ? toHex(M.gradeColor({ discipline: 'boulder', grade: w.max }, set())) : null, h: w.max != null ? (w.max + 1) / top : 0 })),
  });
  showShareSheet(blob, `mi-progreso-${I.today()}.png`, 'Mi progreso');
}

function climbRow(c) {
  const st = STATUS[statusOf(c.result)] || STATUS.send;
  const photo = [...state.photos.values()].find((p) => p.climbId === c.id);
  const title = c.vlId ? `${esc(c.zone)} · ${esc(c.vlNumber || '')}` : (c.name ? esc(c.name) : (c.discipline === 'route' ? 'Vía' : 'Bloque'));
  return `<div class="card climb">
    ${c.holdColor ? holdDot(c.holdColor, c.vlNumber) : `<span class="hold blank">${icon(c.discipline === 'route' ? 'rope' : 'boulder')}</span>`}
    <div class="climb-main">
      <div class="climb-title">${gradeChip(c, 'xs')} ${title}</div>
      <div class="climb-meta st-text-${st.cls}">${icon(st.icon, 'inline')} ${st.label}</div>
      ${c.notes ? `<p class="climb-notes">${esc(c.notes)}</p>` : ''}
    </div>
    ${photo ? `<img class="climb-thumb" src="${photoURL(photo.id)}" alt="" data-action="photo" data-id="${photo.id}">` : ''}
  </div>`;
}

// ---------------- Registrar sesión ----------------
function newDraft() {
  const t = I.today();
  return { id: uid(), isNew: true, date: t, kind: P.isPlannedDay(t, set()) ? 'class' : 'free', with: [], type: 'boulder', duration: 90, rpe: null, mood: null, notes: '', climbs: [], newPhotos: [], removedPhotos: [], where: 'sharma', gymName: '' };
}

function ensureDraft() {
  if (state.draft?.isNew) return state.draft;
  if (state.draft && !state.draft.isNew) return state.draft; // editando una sesión guardada
  state.draft = state.stash || newDraft();
  state.stash = null;
  saveDraftSoon();
  return state.draft;
}

const EFFORT = { 3: 'Suave', 6: 'Normal', 8: 'Dura' };

function viewEditor(editId) {
  if (editId && state.draft?.id !== editId) {
    const s = state.sessions.find((x) => x.id === editId);
    if (!s) return emptyState('Sesión no encontrada', '');
    if (state.draft?.isNew) state.stash = state.draft;
    state.draft = { with: [], ...structuredClone(s), isNew: false, newPhotos: [], removedPhotos: [], gymName: s.where === 'other' ? s.gym : '' };
    state.ui.logDisc = s.type === 'route' ? 'route' : 'boulder';
  }
  if (!editId && !state.draft?.isNew) { state.draft = state.stash || newDraft(); state.stash = null; saveDraftSoon(); }
  const d = state.draft;
  d.with ||= [];
  const disc = state.ui.logDisc;
  const photos = [...sessionPhotos(d.id).filter((p) => !d.removedPhotos.includes(p.id) && !p.climbId), ...d.newPhotos.filter((p) => !p.climbId)];
  const dateLabel = I.parseDate(d.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const specific = d.climbs.filter((c) => c.vlId && c.discipline === disc).length;
  const friends = [...new Set(state.sessions.flatMap((x) => x.with || []))].filter((f) => !d.with.includes(f)).slice(0, 8);
  const topics = N.topicsOf(d.notes);
  return `<div class="topline"><button class="back" data-action="cancel-draft">${icon('back')} ${d.isNew ? 'Descartar' : 'Cancelar'}</button>
</div>
    <h1 class="page-title">${d.isNew ? `Sesión ${esc(P.sessionOf(d.date))}` : 'Editar sesión'}</h1>
    <div class="card when-card"><b>¿Cuándo fue?</b>
      <div class="when-chips">
        <button class="chip ${d.date === I.today() ? 'on' : ''}" data-action="set-date" data-v="${I.today()}">Hoy</button>
        <button class="chip ${d.date === I.toISO(new Date(Date.now() - 86400000)) ? 'on' : ''}" data-action="set-date" data-v="${I.toISO(new Date(Date.now() - 86400000))}">Ayer</button>
        <label class="chip ${d.date < I.toISO(new Date(Date.now() - 86400000)) ? 'on' : ''}">${icon('calendar')} ${d.date < I.toISO(new Date(Date.now() - 86400000)) ? esc(cap(dateLabel)) : 'Otro día'}<input type="date" data-field="date" value="${d.date}" max="${I.today()}" class="hidden-date"></label>
      </div></div>

    <div class="kind-pick">
      <button class="kind ${d.kind !== 'free' ? 'on' : ''}" data-action="set-kind" data-v="class"><span>🎓</span><b>Clase</b></button>
      <button class="kind ${d.kind === 'free' ? 'on' : ''}" data-action="set-kind" data-v="free"><span>🧗‍♀️</span><b>Libre</b></button>
    </div>
    ${d.kind === 'free' ? `<div class="card with-card"><b>¿Con quién has ido?</b>
      <div class="chips"><button class="chip ${d.solo ? 'on' : ''}" data-action="with-solo">🙋‍♀️ Sola</button>${d.with.map((f) => `<button class="chip on" data-action="with-del" data-v="${esc(f)}">${esc(f)} ${icon('close')}</button>`).join('')}
        ${friends.map((f) => `<button class="chip" data-action="with-add" data-v="${esc(f)}">＋ ${esc(f)}</button>`).join('')}</div>
      <div class="with-input"><input data-with placeholder="Escribe un nombre" enterkeyhint="done"><button class="btn sm" data-action="with-add-input">Añadir</button></div></div>` : ''}
    ${d.kind === 'free' ? `<div class="card where-card"><b>¿Dónde has escalado?</b>
      ${seg('set-where', d.where === 'other' ? 'other' : 'sharma', { sharma: `${icon('pin')} ${esc(S.GYM.name.replace('Sharma Climbing', 'Sharma'))}`, other: 'Otro rocódromo' })}
      ${d.where === 'other' ? `<input data-gymname value="${esc(d.gymName || '')}" placeholder="Nombre del rocódromo" maxlength="60" autocomplete="off">
        ${otherGyms().length ? `<div class="chips">${otherGyms().map((g) => `<button class="chip ${d.gymName === g ? 'on' : ''}" data-action="pick-gym" data-v="${esc(g)}">📍 ${esc(g)}</button>`).join('')}</div>` : ''}
        <small class="muted">Para los bloques, elige el color del Sharma que más se parezca en dificultad.</small>` : ''}</div>` : ''}

    ${seg('log-disc', disc, { boulder: `${icon('boulder')} Bloques`, route: `${icon('rope')} Vías` })}
    ${countsCard(disc)}

    ${d.kind === 'free' && d.where === 'other' ? '' : `<details class="card picker-box" ${state.ui.logOpen || specific ? 'open' : ''}>
      <summary data-action="log-open">${icon('wall')}<span><b>Elegir ${disc === 'route' ? 'vías concretas' : 'bloques concretos'}</b><small>${specific ? `${plural(specific, 'elegido', 'elegidos')} de la sala` : 'Opcional · si te acuerdas de cuál era'}</small></span>${icon('chevron', 'chev')}</summary>
      ${state.ui.logOpen || specific ? logPicker(disc) : ''}
    </details>`}

    <div class="card form">
      <div class="field"><span>¿Cómo te has sentido?</span><div class="moods">${M.MOODS.map((m, i) => `<button class="mood ${d.mood === i ? 'on' : ''}" data-action="set-mood" data-v="${i}">${m}</button>`).join('')}</div></div>
      <div class="field"><span>¿Cuánto ha durado?</span><div class="chips dur">${[45, 60, 90, 120, 150, 180].map((m) => `<button class="chip ${Number(d.duration) === m ? 'on' : ''}" data-action="set-duration" data-v="${m}">${fmtMin(m)}</button>`).join('')}</div></div>
      <div class="field"><span>¿Cómo ha sido?</span><div class="seg">${Object.entries(EFFORT).map(([v, l]) => `<button class="${Number(d.rpe) === Number(v) ? 'on' : ''}" data-action="set-effort" data-v="${v}">${l}</button>`).join('')}</div></div>
    </div>

    <div class="card notes-card">
      <b>Notas</b>
      <textarea data-field="notes" rows="3" placeholder="¿Qué tal ha ido? ¿Qué te ha costado? ¿Algo que quieras recordar?">${esc(d.notes)}</textarea>
      <div class="note-topics">${topics.length ? `<small class="muted">Lo apunto como:</small> ${N.topicChips(topics)}` : ''}</div>
      <div class="gallery">
        ${photos.map((p) => `<div class="thumb"><img src="${photoURL(p.id)}" alt=""><button class="x" data-action="remove-photo" data-id="${p.id}" aria-label="Quitar foto">${icon('close')}</button></div>`).join('')}
        <label class="thumb add-photo"><input type="file" accept="image/*" multiple data-upload="session" hidden>${icon('camera')}<span>Foto</span></label>
      </div>
    </div>
    <div class="save-bar"><button class="btn primary block big" data-action="save-session">${icon('check')} ${d.isNew ? 'Guardar sesión' : 'Guardar cambios'}</button></div>`;
}

// Contadores rápidos por color (bloque) o grado (vía): conseguidos e intentados.
function countsCard(disc) {
  const d = state.draft;
  if (disc === 'boulder' && d.kind === 'free' && d.where === 'other') return otherCountsCard(d);
  const mine = d.climbs.filter((c) => c.discipline === disc);
  const cnt = (g, sent) => mine.filter((c) => c.grade === g && M.isSent(c) === sent).length;
  let grades;
  if (disc === 'boulder') {
    grades = M.boulderScale(set()).map((g, i) => ({ i, label: g.name, color: g.color, joker: g.joker })).filter((g) => !g.joker || mine.some((c) => c.grade === g.i));
  } else {
    const rows = new Set([...mine.map((c) => c.grade), ...state.ui.routeRows]);
    grades = [...rows].sort((a, b) => a - b).map((i) => ({ i, label: M.ROUTE_GRADES[i], color: M.routeColor(i) }));
  }
  const sentG = mine.filter(M.isSent).map((c) => c.grade);
  const triedG = mine.filter((c) => !M.isSent(c)).map((c) => c.grade);
  const label = (g) => M.gradeLabel({ discipline: disc, grade: g }, set());
  const hardest = sentG.length ? Math.max(...sentG) : null;
  const hardestTry = triedG.length ? Math.max(...triedG) : null;
  const ctr = (g, sent) => {
    const n = cnt(g.i, sent);
    return `<div class="ctr ${sent ? 'send' : 'proj'} ${n ? 'has' : ''}">
      <button data-action="cnt" data-g="${g.i}" data-r="${sent ? 'send' : 'project'}" data-d="-1" aria-label="Menos" ${n ? '' : 'disabled'}>${icon('minus')}</button>
      <b>${n}</b>
      <button data-action="cnt" data-g="${g.i}" data-r="${sent ? 'send' : 'project'}" data-d="1" aria-label="Más">${icon('plus')}</button></div>`;
  };
  const addRoute = disc === 'route' ? `<div class="add-grade"><small class="muted">${grades.length ? 'Añadir otro grado' : '¿Qué grados has hecho?'}</small>
      <div class="chips scroll">${M.ROUTE_GRADES.slice(0, 24).map((g, i) => (grades.some((x) => x.i === i) ? '' : `<button class="chip sm" data-action="route-row" data-v="${i}">${g}</button>`)).join('')}</div></div>` : '';
  return `<div class="card counts">
    <div class="counts-head"><b>¿Qué has hecho?</b><span class="ch-k"><i class="k-send">${icon('check')}</i>Conseguidos</span><span class="ch-k"><i class="k-proj">${icon('refresh')}</i>Intentados</span></div>
    ${grades.map((g) => `<div class="crow ${cnt(g.i, true) + cnt(g.i, false) ? 'active' : ''}">
      <span class="grade sm${g.joker ? ' joker' : ''}" style="${C.gradeStyle(g.color)}">${esc(g.label)}</span>${ctr(g, true)}${ctr(g, false)}</div>`).join('')}
    ${addRoute}
    ${(() => { const inv = d.climbs.filter((c) => c.discipline === 'invented' && c.invKind === disc); const n1 = inv.filter(M.isSent).length; const n2 = inv.length - n1;
      const c2 = (sent, n) => `<div class="ctr ${sent ? 'send' : 'proj'} ${n ? 'has' : ''}"><button data-action="cnt" data-g="inv" data-r="${sent ? 'send' : 'project'}" data-d="-1" aria-label="Menos" ${n ? '' : 'disabled'}>${icon('minus')}</button><b>${n}</b><button data-action="cnt" data-g="inv" data-r="${sent ? 'send' : 'project'}" data-d="1" aria-label="Más">${icon('plus')}</button></div>`;
      return `<div class="crow inv-row ${inv.length ? 'active' : ''}"><span class="inv-label"><b>✏️ Inventado</b><small>libre del profe</small></span>${c2(true, n1)}${c2(false, n2)}</div>`; })()}
    ${mine.length ? `<p class="counts-sum">${hardest != null ? `Lo más difícil conseguido: <b>${esc(label(hardest))}</b>` : ''}${hardestTry != null && (hardest == null || hardestTry > hardest) ? `${hardest != null ? ' · ' : ''}Has llegado a intentar <b>${esc(label(hardestTry))}</b>` : ''}</p>` : ''}
  </div>`;
}

// Contadores con los colores del otro rocódromo (cada uno equivale a un color del Sharma).
function otherCountsCard(d) {
  const name = (d.gymName || '').trim();
  const circ = gymCircuit(name);
  if (!name) return `<div class="card counts"><p class="muted small">Escribe arriba el nombre del rocódromo para apuntar sus bloques por color.</p></div>`;
  if (!circ) {
    return `<div class="card circ-prompt">${icon('layers')}<div><b>¿Qué colores tiene ${esc(name)}?</b><small>Ordénalos de más fácil a más difícil una vez y se guardan para la próxima.</small></div>
      <button class="btn primary sm" data-action="circ-open">Configurar</button></div>`;
  }
  const mine = d.climbs.filter((c) => c.discipline === 'boulder');
  const cnt = (name2, sent) => mine.filter((c) => c.gymColor === name2 && M.isSent(c) === sent).length;
  const ctr = (k, sent) => { const n = cnt(circ.colors[k].name, sent); return `<div class="ctr ${sent ? 'send' : 'proj'} ${n ? 'has' : ''}">
      <button data-action="cnt" data-gc="${k}" data-r="${sent ? 'send' : 'project'}" data-d="-1" aria-label="Menos" ${n ? '' : 'disabled'}>${icon('minus')}</button><b>${n}</b>
      <button data-action="cnt" data-gc="${k}" data-r="${sent ? 'send' : 'project'}" data-d="1" aria-label="Más">${icon('plus')}</button></div>`; };
  const inv = d.climbs.filter((c) => c.discipline === 'invented' && c.invKind === 'boulder');
  const c2 = (sent, n) => `<div class="ctr ${sent ? 'send' : 'proj'} ${n ? 'has' : ''}"><button data-action="cnt" data-g="inv" data-r="${sent ? 'send' : 'project'}" data-d="-1" aria-label="Menos" ${n ? '' : 'disabled'}>${icon('minus')}</button><b>${n}</b><button data-action="cnt" data-g="inv" data-r="${sent ? 'send' : 'project'}" data-d="1" aria-label="Más">${icon('plus')}</button></div>`;
  return `<div class="card counts">
    <div class="counts-head"><b>¿Qué has hecho?</b><span class="ch-k"><i class="k-send">${icon('check')}</i>Conseguidos</span><span class="ch-k"><i class="k-proj">${icon('refresh')}</i>Intentados</span></div>
    ${circ.colors.map((g, k) => `<div class="crow ${cnt(g.name, true) + cnt(g.name, false) ? 'active' : ''}">
      <span class="eqwrap"><span class="grade sm" style="${C.gradeStyle(g.color)}">${esc(g.name)}</span><small>≈ ${esc(M.gradeLabel({ discipline: 'boulder', grade: g.eq }, set()))}</small></span>${ctr(k, true)}${ctr(k, false)}</div>`).join('')}
    <div class="crow inv-row ${inv.length ? 'active' : ''}"><span class="inv-label"><b>✏️ Inventado</b><small>libre del profe</small></span>${c2(true, inv.filter(M.isSent).length)}${c2(false, inv.filter((c) => !M.isSent(c)).length)}</div>
    <button class="link circ-edit" data-action="circ-open">${icon('edit')} Cambiar colores de ${esc(circ.name)}</button>
  </div>`;
}

// Hoja para configurar los colores de otro rocódromo.
function openCircuitSheet(name) {
  const c = state.circ;
  const reg = sharmaRegular();
  const used = new Set(c.colors.map((x) => x.name.toLowerCase()));
  openSheet(`<div class="sheet">
    <div class="grabber"></div>
    <div class="sheet-head"><button class="link" data-action="close-sheet" type="button">Cancelar</button><b>Colores de ${esc(name)}</b><span></span></div>
    <div class="sheet-body">
      <p class="muted small">Del más fácil (arriba) al más difícil (abajo). Cada color se compara con uno del Sharma para tu progreso; cámbialo si no encaja.</p>
      <div class="circ-list">${c.colors.length ? c.colors.map((g, k) => `<div class="circ-row">
        <input type="color" value="${esc(toHex(g.color))}" data-circ-color="${k}" aria-label="Color">
        <input value="${esc(g.name)}" data-circ-name="${k}" aria-label="Nombre" maxlength="20">
        <label class="eq-sel">≈<select data-circ-eq="${k}" aria-label="Equivale a">${reg.map((r) => `<option value="${r.i}" ${g.eq === r.i ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
        <div class="circ-btns"><button class="icon-btn" data-action="circ-move" data-i="${k}" data-d="-1" aria-label="Más fácil" ${k === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-btn" data-action="circ-move" data-i="${k}" data-d="1" aria-label="Más difícil" ${k === c.colors.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="icon-btn" data-action="circ-del" data-i="${k}" aria-label="Quitar">${icon('close')}</button></div></div>`).join('') : '<p class="muted small center pad">Añade los colores que tiene este rocódromo 👇</p>'}</div>
      <div class="field"><span>Añadir color</span><div class="chips">${COMMON_COLORS.filter(([n]) => !used.has(n.toLowerCase())).map(([n, col]) => `<button class="chip dotchip" data-action="circ-add" data-name="${n}" data-color="${col}"><i style="background:${col}"></i>${n}</button>`).join('')}
        <button class="chip" data-action="circ-add" data-name="Nuevo" data-color="#64748b">＋ Otro</button></div></div>
    </div>
    <div class="sheet-foot"><button class="btn primary block" data-action="circ-save" ${c.colors.length ? '' : 'disabled'}>Guardar colores</button></div></div>`, 'circ-sheet');
}

// Recalcula la equivalencia automática si el usuario no la ha tocado.
function autoEq() {
  const cs = state.circ.colors;
  cs.forEach((g, k) => { if (!g.eqManual) g.eq = defaultEq(k, cs.length); });
}

// Selector de bloques/vías de la sala para apuntar.
function logPicker(disc) {
  const g = state.gym;
  const d = state.draft;
  const inSession = new Map(d.climbs.filter((c) => c.vlId).map((c) => [c.vlId, c.result]));
  const generic = '';
  if (!g && state.gymLoading) return `<div class="skeleton-list">${'<div class="skel"></div>'.repeat(4)}</div>${generic}`;
  const items = g ? (disc === 'route' ? g.routes : g.boulders) : [];
  if (!items.length) return `<div class="card soft"><p class="muted small">No se han podido cargar los ${disc === 'route' ? 'vías' : 'bloques'} de la sala. Puedes apuntarlos por color:</p></div>${generic}`;
  const log = myLog();
  const scale = M.boulderScale(set());
  let filterChips; let list;
  if (disc === 'boulder') {
    const present = scale.filter((c) => items.some((x) => x.grade === c.name));
    if (!state.ui.logCircuit || (state.ui.logCircuit !== 'new' && !present.some((c) => c.name === state.ui.logCircuit))) {
      state.ui.logCircuit = present.find((c) => c.name === set().usualCircuit)?.name || present[0]?.name || 'new';
    }
    const sel = state.ui.logCircuit;
    filterChips = `<div class="chips scroll color-chips">
      <button class="chip ${sel === 'new' ? 'on' : ''}" data-action="log-circuit" data-v="new">${icon('sparkle')} Nuevos</button>
      ${present.map((c) => `<button class="chip dotchip ${sel === c.name ? 'on' : ''}" data-action="log-circuit" data-v="${esc(c.name)}"><i style="background:${c.color}"></i>${esc(c.name)}</button>`).join('')}</div>`;
    list = sel === 'new' ? items.filter((x) => Date.now() - x.date < WEEK) : items.filter((x) => x.grade === sel);
  } else {
    if (!state.ui.logCircuit || !ROUTE_BANDS[state.ui.logCircuit]) state.ui.logCircuit = 'b6a';
    const sel = state.ui.logCircuit;
    filterChips = `<div class="chips scroll">${Object.entries(ROUTE_BANDS).filter(([k]) => k !== 'all').map(([k, v]) => `<button class="chip ${sel === k ? 'on' : ''}" data-action="log-circuit" data-v="${k}">${v}</button>`).join('')}</div>`;
    list = items.filter((x) => bandOf(x.grade) === sel);
  }
  const sectors = [...new Set(list.map((x) => x.sector))].sort();
  if (state.ui.logSector !== 'all' && !sectors.includes(state.ui.logSector)) state.ui.logSector = 'all';
  const shown = list.filter((x) => state.ui.logSector === 'all' || x.sector === state.ui.logSector)
    .sort((a, b) => a.sector.localeCompare(b.sector) || a.number.localeCompare(b.number, undefined, { numeric: true }));
  return `<section class="picker">
    <p class="muted small sub">Toca uno y elige cómo te ha ido. Se suma a los contadores de arriba.</p>
    ${filterChips}
    ${sectors.length > 1 ? `<div class="chips scroll sector-chips"><button class="chip sm ${state.ui.logSector === 'all' ? 'on' : ''}" data-action="log-sector" data-v="all">Todos los sectores</button>${sectors.map((x) => `<button class="chip sm ${state.ui.logSector === x ? 'on' : ''}" data-action="log-sector" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
    ${shown.length ? `<div class="tile-grid">${shown.map((x) => itemTile(x, itemStatus(log.get(x.vlId)), { inSession: inSession.get(x.vlId), showGrade: disc === 'route' || state.ui.logCircuit === 'new' })).join('')}</div>`
      : '<p class="muted small center pad">No hay nada aquí ahora mismo.</p>'}
    <p class="tile-legend">${statusBadge('sent')} conseguido antes · ${statusBadge('trying')} intentado antes</p>
  </section>
  ${generic}`;
}

function genericRow(disc) {
  const grades = disc === 'route'
    ? M.ROUTE_GRADES.map((g, i) => ({ i, label: g, color: M.routeColor(i) })).slice(3, 19)
    : M.boulderScale(set()).map((g, i) => ({ i, label: g.name, color: g.color, joker: g.joker })).filter((g) => !g.joker);
  return `<div class="card generic">
    <b>¿No sabes cuál era?</b><p class="muted small">Apúntalo solo con el ${disc === 'route' ? 'grado' : 'color'}.</p>
    <div class="chips">${grades.map((g) => `<button class="grade-pick sm" style="${C.gradeStyle(g.color)}" data-action="add-generic" data-disc="${disc}" data-v="${g.i}">${esc(g.label)}</button>`).join('')}</div>
  </div>`;
}

// ---------------- Hojas inferiores ----------------
function openSheet(html, cls = '') {
  const dlg = $('#sheet');
  dlg.className = `sheet-dialog ${cls}`;
  dlg.innerHTML = html;
  if (!dlg.open) { dlg.showModal(); haptic(); }
}

function statusButtons(action, id, current, extra = '') {
  return `<div class="log-btns">${Object.entries(STATUS).map(([k, s]) => `<button type="button" class="btn log ${s.cls} ${current && statusOf(current) === k ? 'on' : ''}" data-action="${action}" data-id="${esc(id)}" data-v="${k}" ${extra}>${icon(s.icon)}<span>${s.label}</span></button>`).join('')}</div>`;
}

// Ficha de un bloque de la sala: foto, estado y botones para apuntarlo.
async function openItemSheet(vlId, keepDate = false) {
  const x = findItem(vlId);
  const editing = route() === 'nueva' && !!state.draft;
  if (!keepDate) state.looseDate = I.today();
  state.sheetItem = vlId;
  const looseRec = state.sessions.find((r) => r.id === looseId(state.looseDate));
  const inDraft = editing ? state.draft.climbs.find((c) => c.vlId === vlId) : looseRec?.climbs.find((c) => c.vlId === vlId);
  if (!x && !inDraft) return;
  const item = x || { vlId, kind: inDraft.discipline, number: inDraft.vlNumber, hold: inDraft.holdName, holdColor: inDraft.holdColor, grade: M.gradeLabel(inDraft, set()), sector: inDraft.zone, sectorId: null, date: 0 };
  const isRoute = item.kind === 'route';
  const before = (() => { // historial sin contar la sesión abierta
    let best = null; let n = 0; let sentOn = null;
    for (const s of state.sessions) for (const c of s.climbs || []) if (c.vlId === vlId && s.id !== (editing ? state.draft?.id : looseId(state.looseDate))) { n++; if (M.RESULTS[c.result]?.sent) { best = 'sent'; if (!sentOn || s.date < sentOn) sentOn = s.date; } else if (!best) best = 'trying'; }
    return { best, n, sentOn };
  })();
  const fake = climbFromGym(item);
  const draw = (detail) => `<div class="sheet">
    <div class="grabber"></div>
    <div class="sheet-head"><span></span><b>${isRoute ? 'Vía' : 'Bloque'} ${esc(item.number)}</b><button class="link" data-action="close-sheet" type="button">Cerrar</button></div>
    <div class="sheet-body">
      <div class="gd-head">${holdDot(item.holdColor, item.number, 'lg')}
        <div><div class="gd-title">${gradeChip(fake)} <span>${esc(item.sector)}</span></div>
        <small class="muted">Presa ${esc(S.holdName(item.hold)).toLowerCase()}${item.date ? ` · montado ${ago(item.date)}` : ''}</small>
        ${before.best ? `<div class="hist-line st-text-${before.best === 'sent' ? 'send' : 'proj'}">${icon(before.best === 'sent' ? 'check' : 'refresh', 'inline')} ${before.best === 'sent' ? `Ya lo conseguiste ${esc(P.niceDate(before.sentOn))}` : `Lo has intentado ${plural(before.n, 'vez', 'veces')}`}</div>` : ''}</div></div>
      ${detail === undefined ? '<div class="skel tall"></div>' : detail?.wall ? S.topoHTML(detail.wall, item.holdColor, { label: isRoute ? 'Línea de la vía en el muro' : 'Dónde está en el muro', line: isRoute }) : ''}
      <div class="ask"><b>¿Cómo te ha ido ${esc(editing ? whenText(state.draft) : whenText({ isNew: true, date: state.looseDate }))}?</b></div>
      ${editing ? '' : `<label class="date-line small-date">${icon('calendar')} <span>${esc(P.niceDate(state.looseDate, false) === 'hoy' ? 'Hoy' : P.niceDate(state.looseDate, false))}</span> <b>Cambiar día</b><input type="date" data-loose-date value="${state.looseDate}" max="${I.today()}" class="hidden-date"></label>`}
      ${statusButtons('item-log', vlId, inDraft?.result)}
      ${inDraft ? `<button type="button" class="link muted-link" data-action="item-remove" data-id="${esc(vlId)}">${editing ? 'Quitar de la sesión' : 'Quitar'}</button>` : ''}
      ${before.n ? `<button type="button" class="btn ghost danger sm forget" data-action="item-forget" data-id="${esc(vlId)}">${icon('trash')} ¿Te equivocaste? Borrarlo de tus sesiones</button>` : ''}
      ${detail?.map ? `<details class="map-mini"><summary>${icon('map')} Ver en el plano de la sala</summary>${S.topoHTML(detail.map, '#ff5a1f', { cls: 'small' })}</details>` : ''}
    </div></div>`;
  openSheet(draw(undefined), 'item-sheet');
  let detail = null;
  try { detail = await S.getDetail(item); } catch { detail = null; }
  const dlg = $('#sheet');
  if (dlg.open && dlg.classList.contains('item-sheet') && $('#sheet [data-action=item-log]')?.dataset.id === vlId) {
    const scroll = $('#sheet .sheet-body')?.scrollTop || 0;
    dlg.innerHTML = draw(detail);
    $('#sheet .sheet-body').scrollTop = scroll;
  }
}

// «hoy», «ayer», «el jueves 12» o «en esta sesión»
function whenText(d) {
  if (d && !d.isNew) return 'en esta sesión';
  const n = P.niceDate(d?.date || I.today(), false);
  return ['hoy', 'ayer'].includes(n) ? n : `el ${n}`;
}

// Bloque/vía apuntado solo por color o grado.
function openGenericSheet(climb) {
  const isRoute = climb.discipline === 'route';
  const grades = isRoute ? M.ROUTE_GRADES.map((g, i) => ({ i, label: g, color: M.routeColor(i) })).slice(0, 22)
    : M.boulderScale(set()).map((g, i) => ({ i, label: g.name, color: g.color, joker: g.joker }));
  const exists = state.draft.climbs.some((c) => c.id === climb.id);
  state.generic = climb;
  openSheet(`<div class="sheet">
    <div class="grabber"></div>
    <div class="sheet-head"><span></span><b>${isRoute ? 'Vía' : 'Bloque'} ${esc(M.gradeLabel(climb, set()))}</b><button class="link" data-action="close-sheet" type="button">Cerrar</button></div>
    <div class="sheet-body">
      <div class="field"><span>${isRoute ? 'Grado' : 'Color'}</span>
        <div class="grade-grid">${grades.map((g) => `<button type="button" class="grade-pick ${climb.grade === g.i ? 'on' : ''}${g.joker ? ' joker' : ''}" style="${C.gradeStyle(g.color)}" data-action="generic-grade" data-v="${g.i}">${esc(g.label)}</button>`).join('')}</div></div>
      <div class="ask"><b>¿Cómo te ha ido?</b></div>
      ${statusButtons('generic-log', climb.id, exists ? climb.result : null)}
      ${exists ? `<button type="button" class="link muted-link" data-action="generic-remove" data-id="${esc(climb.id)}">Quitar de la sesión</button>` : ''}
    </div></div>`, 'generic-sheet');
}

function closeSheet() {
  const dlg = $('#sheet');
  if (!dlg.open) return;
  dlg.classList.add('closing');
  setTimeout(() => { dlg.close(); dlg.classList.remove('closing'); dlg.style.transform = ''; }, 180);
}

// ---------------- Sala ----------------
const ROUTE_BANDS = { all: 'Todas', b4: '4 – 5', b6a: '6a – 6b+', b6c: '6c – 7a+', b7b: '7b y más' };
const bandOf = (g) => { const i = M.ROUTE_GRADES.indexOf(g); return i < 9 ? 'b4' : i < 13 ? 'b6a' : i < 17 ? 'b6c' : 'b7b'; };

function viewGym() {
  const g = state.gym; const ui = state.ui;
  const head = `<div class="gym-hero">
      <h1 class="page-title">Sala</h1>
      <p class="gym-addr">${icon('pin')} ${esc(S.GYM.name)} · <a href="${S.GYM.links.maps}" target="_blank" rel="noopener">Cómo llegar</a> · <a href="${S.GYM.links.hours}" target="_blank" rel="noopener">Horarios</a></p>
    </div>`;
  if (!g && state.gymLoading) return `${head}<div class="skeleton-list">${'<div class="skel"></div>'.repeat(6)}</div>`;
  if (!g || (!g.boulders.length && !g.routes.length)) {
    return `${head}${emptyState('No se pudo cargar la sala', set().liveGym === false ? 'Has desactivado los datos de la sala en Ajustes.' : 'Comprueba tu conexión e inténtalo de nuevo.', `<button class="btn primary" data-action="gym-refresh">${icon('refresh')} Reintentar</button>`)}`;
  }
  const disc = ui.gymDisc;
  const items = disc === 'route' ? g.routes : g.boulders;
  const log = myLog();
  const sectors = [...new Set(items.map((x) => x.sector))].sort();
  if (ui.gymSector !== 'all' && !sectors.includes(ui.gymSector)) ui.gymSector = 'all';
  const counts = { sent: 0, trying: 0, none: 0 };
  items.forEach((x) => { counts[itemStatus(log.get(x.vlId))]++; });
  const filtered = items.filter((x) => {
    if (ui.gymSector !== 'all' && x.sector !== ui.gymSector) return false;
    if (disc === 'boulder' && ui.gymCircuit !== 'all' && x.grade !== ui.gymCircuit) return false;
    if (disc === 'route' && ui.gymCircuit !== 'all' && bandOf(x.grade) !== ui.gymCircuit) return false;
    const st = itemStatus(log.get(x.vlId));
    if (ui.gymFilter === 'new' && Date.now() - x.date > WEEK) return false;
    if (['sent', 'trying', 'none'].includes(ui.gymFilter) && st !== ui.gymFilter) return false;
    return true;
  });
  const groups = {};
  filtered.sort((a, b) => a.sector.localeCompare(b.sector) || a.number.localeCompare(b.number, undefined, { numeric: true }))
    .forEach((x) => (groups[x.sector] ||= []).push(x));
  const prog = disc === 'boulder' ? circuitProgress(g).filter((c) => c.total) : [];
  const updated = g.fetchedAt ? `Actualizado ${ago(g.fetchedAt) === 'hoy' ? `hoy a las ${new Date(g.fetchedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : ago(g.fetchedAt)}` : '';
  const sectorMeta = Object.fromEntries(items.map((x) => [x.sector, x.sectorId]));
  const filtersOn = ui.gymSector !== 'all' || ui.gymCircuit !== 'all' || ui.gymFilter !== 'all';
  const stTab = (k, label, n) => `<button class="st-tab ${ui.gymFilter === k ? 'on' : ''} ${k}" data-action="gym-filter" data-v="${k}"><b>${n}</b><span>${label}</span></button>`;
  return `${head}
    ${seg('gym-disc', disc, { boulder: `Bloques <small>${g.boulders.length}</small>`, route: `Vías <small>${g.routes.length}</small>` })}
    <div class="st-tabs">
      ${stTab('sent', 'Conseguidos', counts.sent)}
      ${stTab('trying', 'Intentando', counts.trying)}
      ${stTab('none', 'Sin probar', counts.none)}
    </div>
    ${prog.length ? `<div class="card"><h3>Por colores <small class="muted">toca uno para verlo</small></h3><div class="circuits">${prog.map((p) => `<button class="circ ${ui.gymCircuit === p.name ? 'on' : ''}" data-action="gym-circuit" data-v="${esc(p.name)}">
        <span class="grade sm${p.joker ? ' joker' : ''}" style="${C.gradeStyle(p.color)}">${esc(p.name)}</span><small>${p.done}/${p.total}</small>
        <div class="bar"><i style="width:${Math.round(p.done / p.total * 100)}%;background:${p.color}"></i></div></button>`).join('')}</div></div>`
      : `<div class="chips scroll">${Object.entries(ROUTE_BANDS).map(([k, v]) => `<button class="chip ${ui.gymCircuit === k ? 'on' : ''}" data-action="gym-circuit" data-v="${k}">${v}</button>`).join('')}</div>`}
    <div class="filter-bar">
      <label class="select">${icon('pin')}<select data-gym-select="gymSector" aria-label="Sector"><option value="all">Todos los sectores</option>${sectors.map((x) => `<option ${ui.gymSector === x ? 'selected' : ''} value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label>
      <button class="chip ${ui.gymFilter === 'new' ? 'on' : ''}" data-action="gym-filter" data-v="new">${icon('sparkle')} Nuevos</button>
      <button class="icon-btn ${ui.gymMap ? 'on' : ''}" data-action="gym-map" aria-label="Mapa de sectores">${icon('map')}</button>
    </div>
    ${ui.gymMap ? gymMapCard(sectors.map((name) => ({ name, id: sectorMeta[name] }))) : ''}
    ${filtersOn ? `<p class="filters-note">${plural(filtered.length, 'resultado', 'resultados')} · <button class="link" data-action="gym-clear">Ver todos</button></p>` : ''}
    ${Object.keys(groups).length ? Object.entries(groups).map(([sector, list]) => `<h2 class="month">${esc(sector)} <span class="muted">${list.length}</span></h2>
      <div class="tile-grid">${list.map((x) => itemTile(x, itemStatus(log.get(x.vlId)))).join('')}</div>`).join('')
      : emptyState('Nada por aquí', ui.gymFilter === 'trying' ? 'Cuando apuntes un bloque como «Lo intenté» aparecerá aquí.' : ui.gymFilter === 'sent' ? 'Aún no has conseguido ninguno de los que hay montados.' : 'Prueba a quitar algún filtro.', `<button class="btn ghost" data-action="gym-clear">Ver todos</button>`, 'search')}
    <p class="muted small center src">${updated}${g.offline ? ' · sin conexión' : ''} · Bloques nuevos se actualizan solos cada día
      <button class="link" data-action="gym-refresh">${icon('refresh')} Actualizar</button></p>`;
}

function gymMapCard(sectors) {
  const known = sectors.filter((s) => state.gymSectors[s.id]);
  const missing = sectors.filter((s) => s.id && !(s.id in state.gymSectors));
  if (missing.length) {
    Promise.all(missing.map((s) => S.getSector(s.id).then((t) => { state.gymSectors[s.id] = t; }).catch(() => { state.gymSectors[s.id] = null; })))
      .then(() => { if (route() === 'sala' && state.ui.gymMap) rerender(); });
  }
  const activeId = sectors.find((s) => s.name === state.ui.gymSector)?.id;
  const withTopo = known.map((s) => ({ ...s, topo: state.gymSectors[s.id] })).filter((s) => s.topo);
  return `<div class="card map-card">
    ${withTopo.length ? S.sectorMapHTML(withTopo, activeId) : missing.length ? '<div class="skel tall"></div>' : '<p class="muted small">El plano de la sala aún no está disponible.</p>'}
  </div>`;
}

// ---------------- Progreso ----------------
function viewProgress() {
  const tabs = '';
  if (!state.sessions.length) return `<h1 class="page-title">Progreso</h1>${tabs}${emptyState('Aún no hay datos', 'Apunta tu primera sesión y aquí verás cómo mejoras.', '<a class="btn primary" href="#/nueva">Registrar sesión</a>', 'chart')}`;
  return `<div class="title-row"><h1 class="page-title">Progreso</h1><button class="btn sm share-mini" data-action="share-progress">${icon('camera')} Compartir</button></div>
    <a class="card prof-link obj-link" href="#/objetivos">${icon('trophy')}<span><b>Tus objetivos</b><small>${achievementsNow().reduce((a, x) => a + x.level, 0)} completados · retos del mes</small></span>${icon('chevron', 'muted')}</a>
    ${progSummary()}`;
}

function progSummary() {
  const s = state.sessions;
  const disc = state.ui.progDisc;
  const label = (g) => M.gradeLabel({ discipline: disc, grade: Math.round(g) }, set());
  const color = (g) => M.gradeColor({ discipline: disc, grade: g }, set());
  const climbs = I.allClimbs(s).filter((c) => c.discipline === disc);
  const sent = climbs.filter(M.isSent);
  const flashes = climbs.filter((c) => statusOf(c.result) === 'flash').length;
  const best = sent.length ? sent.reduce((m, c) => (c.grade > m.grade ? c : m)) : null;
  const scale = M.boulderScale(set());
  let next = null;
  if (best) {
    if (disc === 'boulder') { for (let i = best.grade + 1; i < scale.length; i++) if (!scale[i].joker) { next = i; break; } } else if (best.grade + 1 < M.ROUTE_GRADES.length) next = best.grade + 1;
  }
  const month = I.today().slice(0, 7);
  const monthSent = sent.filter((c) => c.date.startsWith(month)).length;
  // Conseguidos/intentados por color o grado
  const n = disc === 'route' ? M.ROUTE_GRADES.length : scale.length;
  const rows = Array.from({ length: n }, (_, i) => ({ i, label: label(i), color: color(i), sent: 0, tried: 0 }));
  climbs.forEach((c) => { if (rows[c.grade]) { if (M.isSent(c)) rows[c.grade].sent++; else rows[c.grade].tried++; } });
  const used = rows.filter((r) => r.sent || r.tried);
  const weeks = I.weeklyProgress(s, disc, 10);
  const g = state.gym;
  const prog = disc === 'boulder' && g ? circuitProgress(g).filter((c) => c.total && !c.joker) : [];
  const trying = tryingNow().filter((x) => (disc === 'route') === (x.kind === 'route'));
  const log = myLog();
  return `${seg('prog-disc', disc, { boulder: 'Bloques', route: 'Vías' })}
    <div class="card level">
      <div><p class="hero-k">Tu ${disc === 'route' ? 'grado' : 'color'} más difícil</p>
        ${best ? `<span class="grade big" style="${C.gradeStyle(color(best.grade))}">${esc(label(best.grade))}</span>` : '<b class="muted">Aún ninguno</b>'}</div>
      ${next != null ? `<div class="level-next"><p class="hero-k">Siguiente reto</p><span class="grade" style="${C.gradeStyle(color(next))}">${esc(label(next))}</span></div>` : ''}
    </div>
    <section class="kpis three">
      ${kpi(sent.length, 'conseguidos')}
      ${kpi(flashes, 'a la primera')}
      ${kpi(monthSent, 'este mes')}
    </section>
    ${prog.length ? `<div class="card"><h3>Lo que hay ahora en la sala</h3><div class="rings">${prog.map((p) => `<div class="cring">${ringColor(p.done, p.total, p.color)}<span>${esc(p.name)}</span><small>${p.done}/${p.total}</small></div>`).join('')}</div></div>` : ''}
    <div class="card"><h3>Tu nivel cada semana</h3>${C.weeklyBars(weeks, label, color, best?.grade ?? 0)}</div>
    ${used.length ? `<div class="card"><h3>Por ${disc === 'route' ? 'grado' : 'color'}</h3>${C.colorBars(used)}</div>` : ''}
    <div class="card"><h3>Días que has escalado</h3><div class="scroll-x">${C.calendarHeatmap(realSessions())}</div></div>
    ${gymsCard()}
    ${topicsCard()}
    ${trying.length ? `<div class="card"><h3>${icon('refresh')} Estás intentando</h3><p class="muted small">Siguen montados en la sala: ¡la próxima vez saldrán!</p><div class="tile-grid">${trying.map((x) => itemTile(x, itemStatus(log.get(x.vlId)))).join('')}</div></div>` : ''}`;
}

// Rocódromos donde has escalado (solo si hay más de uno).
function gymsCard() {
  const counts = {};
  realSessions().forEach((x) => { const g = gymOf(x); const c = (counts[g] ||= { n: 0, last: x.date }); c.n++; if (x.date > c.last) c.last = x.date; });
  const list = Object.entries(counts).sort((a, b) => b[1].n - a[1].n);
  if (list.length < 2) return '';
  return `<div class="card"><h3>${icon('pin')} Rocódromos</h3>${list.map(([g, c]) => `<div class="gym-row"><b>${esc(g)}</b><small class="muted">${plural(c.n, 'sesión', 'sesiones')} · última ${esc(P.niceDate(c.last, false))}</small></div>`).join('')}</div>`;
}

function topicsCard() {
  const counts = {};
  state.sessions.forEach((s) => (s.topics || N.topicsOf(s.notes)).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  const list = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!list.length) return '';
  const max = list[0][1];
  return `<div class="card"><h3>De qué hablan tus notas</h3>${list.map(([k, n]) => `<div class="bar-row wide"><span>${N.TOPICS[k].emoji} ${N.TOPICS[k].label}</span><div class="bar"><i style="width:${Math.round(n / max * 100)}%"></i></div><small>${n}</small></div>`).join('')}</div>`;
}

function ringColor(done, total, color) {
  const size = 64; const r = 26; const c = 2 * Math.PI * r; const p = total ? done / total : 0;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="8"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 32 32)" class="ring-fg" style="--len:${c};filter:drop-shadow(0 0 .5px rgb(0 0 0 / .4))"/>
    <text x="32" y="37" text-anchor="middle" class="ring-pct">${Math.round(p * 100)}%</text></svg>`;
}

function achievementsNow() {
  const g = state.gym;
  const complete = g ? circuitProgress(g).filter((c) => c.total && !c.joker && c.done === c.total).length : 0;
  return I.achievements(state.sessions, state.photos.size, { scale: M.boulderScale(set()), completeCircuits: complete });
}

// Retos del mes: se generan solos cada mes según tu nivel, así siempre hay algo que cumplir.
function monthlyChallenges() {
  const now = new Date();
  const ym = I.today().slice(0, 7);
  const monthName = now.toLocaleDateString('es-ES', { month: 'long' });
  const real = realSessions();
  const monthSessions = real.filter((x) => x.date.startsWith(ym));
  const allMonth = state.sessions.filter((x) => x.date.startsWith(ym));
  const mClimbs = I.allClimbs(allMonth);
  const climbs = I.allClimbs(state.sessions);
  const reg = sharmaRegular();
  const bSentAll = climbs.filter((c) => c.discipline === 'boulder' && M.isSent(c)).map((c) => c.grade);
  const best = bSentAll.length ? Math.max(...bSentAll) : null;
  const cur = best != null ? reg.filter((g) => g.i <= best).pop() : reg.find((g) => g.name === set().usualCircuit) || reg[0];
  const next = best != null ? reg.find((g) => g.i > best) : null;
  const out = [];
  const goalSessions = Math.max(4, (set().weeklyGoal || 1) * 4);
  out.push({ icon: '📅', title: `${goalSessions} sesiones en ${monthName}`, value: monthSessions.length, target: goalSessions });
  if (next) {
    const triedNext = mClimbs.filter((c) => c.discipline === 'boulder' && c.grade === next.i).length;
    const sentNext = mClimbs.filter((c) => c.discipline === 'boulder' && c.grade === next.i && M.isSent(c)).length;
    out.push({ icon: '🎯', title: `Prueba 3 bloques ${colorPlural(next.name)}`, value: triedNext, target: 3, color: next.color });
    out.push({ icon: '🚀', title: `Consigue un ${next.name}`, value: sentNext, target: 1, color: next.color });
  } else if (cur) {
    out.push({ icon: '👑', title: `5 bloques ${colorPlural(cur.name)} este mes`, value: mClimbs.filter((c) => c.discipline === 'boulder' && c.grade === cur.i && M.isSent(c)).length, target: 5, color: cur.color });
  }
  out.push({ icon: '⚡', title: '5 a la primera este mes', value: mClimbs.filter((c) => statusOf(c.result) === 'flash').length, target: 5 });
  out.push({ icon: '🧱', title: '5 bloques concretos de la sala', value: new Set(mClimbs.filter((c) => c.vlId).map((c) => c.vlId)).size, target: 5 });
  return { monthName, list: out.map((c) => ({ ...c, done: c.value >= c.target, progress: Math.min(1, c.value / c.target) })) };
}

function viewObjectives() {
  if (!state.sessions.length) {
    return `<h1 class="page-title">Objetivos</h1>${emptyState('Tus objetivos empiezan aquí', 'Apunta tu primera sesión y empezarás a completar objetivos y a ganar medallas.', '<a class="btn primary" href="#/nueva">Registrar sesión</a>', 'trophy')}`;
  }
  const ach = achievementsNow();
  const got = ach.reduce((a, x) => a + x.level, 0);
  const mc = monthlyChallenges();
  const mDone = mc.list.filter((c) => c.done).length;
  const inProgress = ach.filter((a) => !a.complete).sort((a, b) => b.progress - a.progress);
  const medals = ach.flatMap((a) => a.tiers.slice(0, a.level).map((t, k) => ({ icon: a.icon, title: a.title, text: (a.doneUnit || a.unit)(t), lv: k + 1 }))).reverse();
  const near = inProgress[0];
  return `<section class="obj-hero">
      <div class="obj-medal">🏅<b>${got}</b></div>
      <div><p class="hero-k">Objetivos completados</p><h2>${got === 1 ? '¡Tu primera medalla!' : `${got} medallas`}</h2>
        ${near ? `<small>Lo más cerca: ${esc(near.goal)}</small>` : ''}</div>
    </section>

    <div class="section-head"><h2 class="section-title">Retos de ${esc(mc.monthName)}</h2><span class="muted small">${mDone}/${mc.list.length}</span></div>
    <p class="muted small sub">Se renuevan cada mes según tu nivel.</p>
    <div class="list">${mc.list.map((c) => `<div class="card mch ${c.done ? 'done' : ''}" ${c.color ? `style="--mc:${esc(c.color)}"` : ''}>
      <span class="mch-ic">${c.done ? '✅' : c.icon}</span>
      <div class="mch-main"><b>${esc(c.title)}</b><div class="bar"><i style="width:${Math.round(c.progress * 100)}%"></i></div></div>
      <span class="mch-n">${Math.min(c.value, c.target)}/${c.target}</span></div>`).join('')}</div>

    <h2 class="section-title">Siguientes objetivos</h2>
    <p class="muted small sub">Al completar uno aparece el siguiente nivel.</p>
    <div class="ach-grid">${inProgress.map((a) => `<div class="ach ${a.level ? 'got' : ''}">
      <div class="ach-top"><span class="ach-ic">${a.icon}</span>${a.level ? `<span class="ach-lv">Nivel ${a.level}</span>` : ''}</div>
      <b>${esc(a.title)}</b>
      <small class="ach-next">${esc(a.goal)}</small>
      <div class="bar"><i style="width:${Math.round(a.progress * 100)}%"></i></div>
    </div>`).join('')}</div>

    ${medals.length ? `<div class="section-head"><h2 class="section-title">Completados</h2><span class="muted small">${medals.length}</span></div>
    <div class="medals">${medals.map((m) => `<div class="medal"><span class="medal-ic">${m.icon}</span><b>${esc(m.title)}</b><small>${esc(m.text)}</small></div>`).join('')}</div>` : ''}`;
}

function progAchievements() {
  const ach = achievementsNow();
  const got = ach.reduce((a, x) => a + x.level, 0);
  const near = [...ach].filter((a) => !a.complete).sort((a, b) => b.progress - a.progress)[0];
  return `<div class="card ach-head"><span class="ach-big">🏅</span><div><b>${got} ${got === 1 ? 'logro conseguido' : 'logros conseguidos'}</b><small class="muted">Al completar uno aparece el siguiente: siempre hay un objetivo nuevo.${near ? ` Lo más cerca: <b>${esc(near.goal)}</b>.` : ''}</small></div></div>
    <div class="ach-grid">${ach.map((a) => `<div class="ach ${a.level ? 'got' : ''} ${a.complete ? 'complete' : ''}">
      <div class="ach-top"><span class="ach-ic">${a.icon}</span>${a.level ? `<span class="ach-lv">Nivel ${a.level}</span>` : ''}</div>
      <b>${esc(a.title)}</b>
      ${a.done ? `<small class="ach-done">✓ ${esc(a.done)}</small>` : ''}
      <small class="ach-next">${a.complete ? '🏅 ¡Todo completado!' : `Siguiente: ${esc(a.goal)}`}</small>
      ${a.complete ? '' : `<div class="bar"><i style="width:${Math.round(a.progress * 100)}%"></i></div>`}
    </div>`).join('')}</div>`;
}

// ---------------- Ajustes ----------------
function viewSettings() {
  const st = set();
  const scale = M.boulderScale(st);
  const demoCount = state.sessions.filter((s) => s.demo).length;
  return `<div class="topline"><a href="#/perfil" class="back">${icon('back')} Perfil</a></div>
    <h1 class="page-title">Ajustes</h1>
    <div class="card form">
      <div class="set-avatar"><label class="prof-photo sm" aria-label="Cambiar foto">${avatarHTML('lg')}<span class="prof-cam">${icon('camera')}</span><input type="file" accept="image/*" data-upload="avatar" hidden></label>
        <div><b>Foto de perfil</b><small class="muted">Toca para cambiarla</small>${state.avatarURL ? '<button class="link danger" data-action="avatar-del">Quitar foto</button>' : ''}</div></div>
      <label class="field"><span>Tu nombre</span><input data-setting="name" value="${esc(st.name)}" placeholder="¿Cómo te llamas?"></label>
      <div class="field"><span>Objetivo semanal</span><div class="seg">${[1, 2, 3].map((n) => `<button class="${(st.weeklyGoal || 1) === n ? 'on' : ''}" data-action="set-goal" data-v="${n}">${plural(n, 'sesión', 'sesiones')}</button>`).join('')}</div></div>
      <div class="field"><span>Aspecto</span>${seg('theme', st.theme || 'light', { light: 'Claro', dark: 'Oscuro', auto: 'Como el móvil' })}</div>
    </div>
    <div class="card form">
      <h3>${icon('calendar')} Tus días de escalada</h3>
      ${scheduleFields(st.schedule || { days: [4], time: '19:00' }, (st.extraDates || []).filter((d) => d >= I.today()).sort())}
    </div>
    ${Object.keys(set().otherGyms || {}).length ? `<div class="card"><h3>${icon('pin')} Otros rocódromos</h3>${Object.values(set().otherGyms).map((g) => `<div class="og-row"><b>${esc(g.name)}</b><span class="og-dots">${g.colors.map((c) => `<i style="background:${esc(c.color)}" title="${esc(c.name)}"></i>`).join('')}</span><button class="link" data-action="og-edit" data-v="${esc(g.name)}">Editar</button></div>`).join('')}</div>` : ''}
    <div class="card form">
      <label class="switch"><span><b>Bloques de la sala</b><small class="muted">Muestra los bloques y vías de ${esc(S.GYM.name)} (se actualizan solos cada día)</small></span><input type="checkbox" data-toggle="liveGym" ${st.liveGym !== false ? 'checked' : ''}><i></i></label>
    </div>
    <details class="card">
      <summary><b>Colores de bloque</b> <span class="muted small">avanzado</span></summary>
      <p class="muted small">Los colores de ${esc(S.GYM.name)} de más fácil a más difícil. Puedes añadir el grado aproximado de cada uno (p. ej. «6a–6b»).</p>
      <div class="scale-editor">${scale.map((g, i) => `<div class="scale-row">
        <input type="color" value="${toHex(g.color)}" data-scale="${i}" data-k="color" aria-label="Color">
        <input value="${esc(g.name)}" data-scale="${i}" data-k="name" aria-label="Nombre">
        <input value="${esc(g.approx)}" data-scale="${i}" data-k="approx" placeholder="≈ grado" aria-label="Grado aproximado">
        <button class="icon-btn" data-action="scale-up" data-i="${i}" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-btn" data-action="scale-del" data-i="${i}" aria-label="Eliminar">${icon('close')}</button></div>`).join('')}</div>
      <div class="row-gap wrap"><button class="btn ghost sm" data-action="scale-add">＋ Añadir</button>
        <button class="btn ghost sm" data-action="scale-preset" data-v="sharma">Restablecer</button></div>
    </details>
    <div class="card">
      <h3>Tus datos</h3>
      <p class="muted small">Todo se guarda solo en este móvil. Haz una copia de vez en cuando (incluye las fotos); sirve también para pasar tus datos a otro móvil.</p>
      <div class="stack">
        <button class="btn" data-action="export">${icon('download')} Descargar copia de seguridad</button>
        <label class="btn ghost"><input type="file" accept="application/json,.json" data-upload="import" hidden>${icon('upload')} Restaurar copia</label>
        ${demoCount ? `<button class="btn ghost" data-action="demo-clear">Quitar datos de ejemplo (${demoCount})</button>` : '<button class="btn ghost" data-action="demo">Cargar datos de ejemplo</button>'}
        <button class="btn danger ghost" data-action="wipe">${icon('trash')} Borrar todo y empezar de cero</button>
      </div>
 <p class="muted small">${plural(realSessions().length, 'sesión', 'sesiones')} · ${plural(state.photos.size, 'foto', 'fotos')}${state.persisted ? ' · ✓ guardado de forma permanente en este móvil' : ''}${set().lastBackup ? ` · última copia ${ago(set().lastBackup)}` : ''}</p>
    </div>
    <p class="muted small center about">Mi Escalada · app no oficial, sin relación con Sharma Climbing.<br>Los bloques y vías de la sala proceden del widget público de Vertical-Life.</p>`;
}

function toHex(c) {
  if (c?.startsWith('#')) return c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
  const el = document.createElement('div'); el.style.color = c; document.body.appendChild(el);
  const m = getComputedStyle(el).color.match(/\d+/g) || [0, 0, 0]; el.remove();
  return `#${m.slice(0, 3).map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`;
}

// ---------------- Persistencia ----------------
let draftTimer;
function saveDraftNow() {
  clearTimeout(draftTimer);
  if (state.draft?.isNew) db.put('settings', { key: 'draft', value: state.draft });
}
function saveDraftSoon(delay = 0) {
  clearTimeout(draftTimer);
  if (!delay) return saveDraftNow();
  draftTimer = setTimeout(saveDraftNow, delay);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { saveDraftNow(); return; }
  // Al volver a la app: refresca bloques y eventos si hace rato que no se miran.
  if (set().liveGym !== false && (!state.gym || Date.now() - (state.gym.fetchedAt || 0) > 3 * 3600 * 1000)) loadGym();
  if (!state.events || Date.now() - (state.eventsAt || 0) > 3 * 3600 * 1000) { state.eventsAt = Date.now(); loadEvents(); }
});
async function clearDraft() {
  const wasNew = state.draft?.isNew;
  state.draft = null;
  if (wasNew) await db.del('settings', 'draft');
}
async function saveSettings() { await db.put('settings', state.settings); }

async function saveSession() {
  const d = state.draft;
  if (!d.climbs.length && !d.notes && !d.newPhotos.length) {
    toast('Apunta al menos un bloque (o una nota)'); return;
  }
  const { isNew, newPhotos, removedPhotos, startedAt, ...session } = d;
  if (!session.duration) session.duration = 90;
  if (session.kind === 'free' && session.where === 'other' && !(session.gymName || '').trim()) { toast('Escribe el nombre del rocódromo'); return; }
  if (session.kind !== 'free') session.where = 'sharma';
  session.gym = session.where === 'other' ? session.gymName.trim().replace(/\s+/g, ' ') : S.GYM.name;
  delete session.gymName;
  const discs = new Set(session.climbs.map((c) => (c.discipline === 'invented' ? c.invKind : c.discipline)));
  session.type = discs.size > 1 ? 'mixed' : discs.has('route') ? 'route' : discs.has('boulder') ? 'boulder' : (state.ui.logDisc || 'boulder');
  if (!session.rpe) session.rpe = 6;
  session.topics = N.topicsOf(session.notes);
  if (session.kind !== 'free') { session.with = []; session.solo = false; }
  session.createdAt ||= Date.now();
  session.updatedAt = Date.now();
  const climbIds = new Set(session.climbs.map((c) => c.id));
  const orphan = [...state.photos.values()].filter((p) => p.sessionId === d.id && p.climbId && !climbIds.has(p.climbId)).map((p) => p.id);
  const toRemove = [...removedPhotos, ...orphan];
  const toAdd = newPhotos.filter((p) => !p.climbId || climbIds.has(p.climbId)).map((p) => ({ ...p, sessionId: d.id, date: session.date }));
  const toUpdate = [...state.photos.values()].filter((p) => p.sessionId === d.id && !toRemove.includes(p.id) && p.date !== session.date).map((p) => ({ ...p, date: session.date }));
  await db.put('sessions', session);
  if (toAdd.length || toUpdate.length) await db.putMany('photos', [...toAdd, ...toUpdate]);
  if (toRemove.length) await db.delMany('photos', toRemove);
  [...toAdd, ...toUpdate].forEach((p) => state.photos.set(p.id, p));
  toRemove.forEach((id) => state.photos.delete(id));
  const i = state.sessions.findIndex((s) => s.id === session.id);
  if (i >= 0) state.sessions[i] = session; else state.sessions.push(session);
  await clearDraft();
  state.ui.logOpen = false; state.ui.routeRows = [];
  const fresh = checkNewAchievements();
  protectStorage();
  haptic([10, 40, 10]);
  if (isNew || fresh) celebrate();
  toast(fresh ? `🏅 ¡Nuevo logro! ${fresh.title} · ${fresh.done}` : isNew ? '¡Sesión guardada! 💪' : 'Cambios guardados');
  go(`#/sesion/${session.id}`);
  if (isNew && (session.climbs || []).length) setTimeout(() => { if (route() === 'perfil') shareSessionImage(session.id, { afterSave: true }); }, 900);
}

async function addPhotos(files) {
  const d = state.draft;
  for (const f of files) {
    const blob = await compressImage(f);
    d.newPhotos.push({ id: uid(), blob, climbId: null, createdAt: Date.now() });
  }
  saveDraftSoon();
}

// Guarda un bloque de la sala sin sesión (registro «suelto» del día).
async function logLoose(vlId, status) {
  const x = findItem(vlId); if (!x) return;
  const date = state.looseDate || I.today();
  let rec = state.sessions.find((r) => r.id === looseId(date));
  if (!rec) { rec = { id: looseId(date), loose: true, date, climbs: [], createdAt: Date.now() }; state.sessions.push(rec); }
  let c = rec.climbs.find((y) => y.vlId === vlId);
  if (!c) { c = climbFromGym(x); rec.climbs.push(c); }
  c.result = status; c.attempts = status === 'flash' ? 1 : status === 'send' ? 2 : 3;
  rec.updatedAt = Date.now();
  await db.put('sessions', rec);
  protectStorage();
  haptic(12);
  const fresh = checkNewAchievements();
  if (fresh) celebrate();
  toast(fresh ? `🏅 ¡Nuevo logro! ${fresh.title} · ${fresh.done}` : `${STATUS[status].label} · ${c.vlNumber || ''} ${M.gradeLabel(c, set())} guardado`);
}

async function removeLoose(vlId) {
  const rec = state.sessions.find((r) => r.id === looseId(state.looseDate || I.today()));
  if (!rec) return;
  rec.climbs = rec.climbs.filter((c) => c.vlId !== vlId);
  if (rec.climbs.length) await db.put('sessions', rec);
  else { await db.del('sessions', rec.id); state.sessions = state.sessions.filter((r) => r !== rec); }
}

// Apunta (o actualiza) un bloque de la sala en la sesión abierta.
function logItem(vlId, status) {
  const x = findItem(vlId);
  const d = ensureDraft();
  let c = d.climbs.find((y) => y.vlId === vlId);
  if (!c) { if (!x) return; c = climbFromGym(x); d.climbs.push(c); }
  c.result = status; c.attempts = status === 'flash' ? 1 : status === 'send' ? 2 : 3;
  saveDraftSoon(); haptic(12);
  const where = route() === 'nueva' ? null : { label: 'Ver sesión', href: '#/nueva' };
  toast(`${STATUS[status].label} · ${c.vlNumber || ''} ${M.gradeLabel(c, set())}`, where);
}

// ---------------- Exportar / importar ----------------
async function exportData() {
  toast('Preparando copia…');
  const photos = await Promise.all([...state.photos.values()].map(async ({ blob, ...p }) => ({ ...p, data: await blobToDataURL(blob) })));
  const av = await db.get('settings', 'avatar');
  const data = { app: 'cuaderno-escalada', version: 2, exportedAt: new Date().toISOString(), settings: state.settings, sessions: state.sessions, photos, avatar: av?.blob ? await blobToDataURL(av.blob) : null };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `escalada-${I.today()}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  state.settings.lastBackup = Date.now(); await saveSettings();
  if (route() === 'inicio') rerender();
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'cuaderno-escalada' || !Array.isArray(data.sessions)) throw new Error('formato');
    if (!confirm(`¿Restaurar ${plural(data.sessions.length, 'sesión', 'sesiones')} y ${plural(data.photos?.length || 0, 'foto', 'fotos')}? Se combinarán con los datos actuales.`)) return;
    let { sessions } = data;
    let incoming = data.settings || {};
    if ((data.version || 1) < 2) {
      const m = M.migrate({ ...incoming, dataVersion: 1 }, sessions);
      sessions = m.sessions; incoming = m.settings;
    }
    const photos = await Promise.all((data.photos || []).map(async ({ data: url, ...p }) => ({ ...p, blob: await dataURLToBlob(url) })));
    await db.putMany('sessions', sessions);
    await db.putMany('photos', photos);
    state.settings = { ...state.settings, ...incoming, key: 'settings', dataVersion: DATA_VERSION, onboarded: true };
    await saveSettings();
    sessions.forEach((s) => { const i = state.sessions.findIndex((x) => x.id === s.id); if (i >= 0) state.sessions[i] = s; else state.sessions.push(s); });
    photos.forEach((p) => state.photos.set(p.id, p));
    if (data.avatar) { const blob = await dataURLToBlob(data.avatar); await db.put('settings', { key: 'avatar', blob }); state.avatarURL = URL.createObjectURL(blob); }
    applyTheme();
    toast('Copia restaurada ✅');
    render();
  } catch {
    toast('No se pudo leer el archivo de copia');
  }
}

// ---------------- Acciones ----------------
const actions = {
  async demo() {
    const sessions = makeDemo(set(), state.gym);
    await db.putMany('sessions', sessions);
    state.sessions.push(...sessions);
    state.settings.onboarded = true; state.settings.seenAch = I.unlockedKeys(achievementsNow()); await saveSettings();
    toast('Datos de ejemplo cargados');
    go('#/inicio');
  },
  async 'demo-clear'() {
    const ids = state.sessions.filter((s) => s.demo).map((s) => s.id);
    await db.delMany('sessions', ids);
    state.sessions = state.sessions.filter((s) => !s.demo);
    toast('Datos de ejemplo eliminados');
    rerender();
  },
  async wipe(el) {
    if (!el.classList.contains('confirm')) {
      el.classList.add('confirm'); haptic(20);
      el.innerHTML = `${icon('trash')} ¿Seguro? Toca otra vez para borrarlo todo`;
      clearTimeout(actions.wipe.t);
      actions.wipe.t = setTimeout(() => { if (el.isConnected) { el.classList.remove('confirm'); el.innerHTML = `${icon('trash')} Borrar todo y empezar de cero`; } }, 4000);
      return;
    }
    clearTimeout(actions.wipe.t);
    await Promise.all([db.clear('sessions'), db.clear('photos'), db.clear('settings')]);
    state.urls.forEach((u) => URL.revokeObjectURL(u)); state.urls.clear();
    Object.assign(state, { sessions: [], draft: null, stash: null, settings: { ...DEFAULT_SETTINGS, seenAch: [] } });
    state.photos.clear(); state.ui.onb = 0;
    if (state.avatarURL) URL.revokeObjectURL(state.avatarURL);
    state.avatarURL = null;
    applyTheme();
    toast('Todo borrado. ¡Como recién instalada!');
    go('#/inicio');
    loadGym(true);
  },
  'onb-next'() { state.ui.onb = 1; render({ transition: true }); },
  async 'onb-done'() {
    state.settings.onboarded = true;
    const d = new Date(); d.setDate(d.getDate() - 7); state.settings.planSince = I.toISO(d);
    await saveSettings(); state.ui.onb = 0; render({ transition: true });
  },
  async 'set-goal'(el) { state.settings.weeklyGoal = Number(el.dataset.v); await saveSettings(); rerender(); },
  async 'set-usual'(el) { state.settings.usualCircuit = el.dataset.v; await saveSettings(); rerender(); },
  async install() { const e = state.installEvt; if (!e) return; e.prompt(); await e.userChoice.catch(() => {}); state.installEvt = null; rerender(); },
  async 'install-dismiss'() { state.settings.installDismissed = true; await saveSettings(); rerender(); },
  'plan-start'(el) {
    const date = el.dataset.date; const type = el.dataset.type;
    let d = state.draft?.isNew ? state.draft : null;
    if (d && d.climbs.length && d.date !== date) { toast('Ya tienes una sesión abierta: termínala primero'); go('#/nueva'); return; }
    d = ensureDraft();
    d.date = date; d.type = type; state.ui.logDisc = type; d.kind = P.isPlannedDay(date, set()) ? 'class' : 'free';
    const plan = P.planState(set(), realSessions(), null);
    saveDraftSoon(); haptic();
    go('#/nueva');
  },
  async 'plan-skip'(el) {
    state.settings.skipped = [...new Set([...(set().skipped || []), el.dataset.date])].slice(-60);
    await saveSettings(); toast('Vale, ¡a la próxima! 💪'); rerender();
  },
  'open-plan'() { planSheet(); },
  async 'sch-day'(el) {
    const sch = { days: [4], time: '19:00', ...set().schedule };
    const v = Number(el.dataset.v); const days = (sch.days || []).map(Number);
    sch.days = days.includes(v) ? days.filter((x) => x !== v) : [...days, v];
    state.settings.schedule = sch; await saveSettings(); refreshPlanUI();
  },
  async 'sch-extra-add'(el) { await addExtraDate(el.dataset.v); },
  async 'sch-extra-del'(el) { state.settings.extraDates = (set().extraDates || []).filter((d) => d !== el.dataset.v); await saveSettings(); refreshPlanUI(); },
  ics() {
    const blob = new Blob([P.scheduleICS(set())], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: 'escalada.ics' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Abre el archivo para añadirlo a tu calendario');
  },
  'start-session'() { ensureDraft(); },
  export: exportData,
  'hist-tab'(el) { state.ui.histTab = el.dataset.v || el.dataset.tab; state.ui.profTab = 'diario'; if (route() === 'perfil') rerender(); },
  'prof-tab'(el) { state.ui.profTab = el.dataset.v; rerender(); },
  'prog-tab'(el, e) { if (el.dataset.v === 'logros') { e.preventDefault(); go('#/objetivos'); } },
  'prog-disc'(el) { state.ui.progDisc = el.dataset.v; rerender(); },
  async theme(el) { state.settings.theme = el.dataset.v; applyTheme(); await saveSettings(); rerender(); },
  photo(el) { openPhoto(el.dataset.id); },
  'share-img'(el) { shareSessionImage(el.dataset.id); },
  'share-progress'() { shareProgressImage(); },
  async 'share-file'() {
    try { await navigator.share({ files: [state.shareFile], text: '🧗‍♀️ Mi sesión de escalada' }); } catch { /* cancelado */ }
  },
  async 'item-forget'(el) {
    if (!armed(el, '¿Seguro? Toca otra vez para borrarlo')) return;
    const id = el.dataset.id; const changed = [];
    state.sessions.forEach((s) => { const n = (s.climbs || []).length; s.climbs = (s.climbs || []).filter((c) => c.vlId !== id); if (s.climbs.length !== n) changed.push(s); });
    const empty = changed.filter((x) => x.loose && !x.climbs.length);
    if (empty.length) { await db.delMany('sessions', empty.map((x) => x.id)); state.sessions = state.sessions.filter((x) => !empty.includes(x)); }
    const keep = changed.filter((x) => !empty.includes(x));
    if (keep.length) await db.putMany('sessions', keep);
    if (state.draft) { state.draft.climbs = state.draft.climbs.filter((c) => c.vlId !== id); saveDraftSoon(); }
    closeSheet(); toast('Borrado de tus sesiones'); rerender();
  },
  async share(el) {
    const s = state.sessions.find((x) => x.id === el.dataset.id);
    const text = shareText(s);
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Resumen copiado al portapapeles'); }
    } catch { /* cancelado */ }
  },
  async 'delete-session'(el) {
    if (!armed(el, '¿Seguro? Toca otra vez para eliminarla')) return;
    const id = el.dataset.id;
    const photoIds = sessionPhotos(id).map((p) => p.id);
    await db.del('sessions', id); await db.delMany('photos', photoIds);
    state.sessions = state.sessions.filter((s) => s.id !== id);
    photoIds.forEach((p) => state.photos.delete(p));
    toast('Sesión eliminada');
    go('#/diario');
  },
  async 'cancel-draft'() {
    const d = state.draft;
    if (d?.isNew && (d.climbs.length || d.newPhotos.length || d.notes) && !confirm('¿Descartar esta sesión sin guardar?')) return;
    const back = d && !d.isNew ? `#/sesion/${d.id}` : '#/inicio';
    await clearDraft();
    state.ui.logOpen = false; state.ui.routeRows = [];
    go(back);
  },

  'set-date'(el) { applyDraftDate(el.dataset.v); },
  'cal-nav'(el) {
    const now = new Date();
    const [y, m] = (state.ui.calMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`).split('-').map(Number);
    const d = new Date(y, m - 1 + Number(el.dataset.d), 1);
    state.ui.calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    haptic(); rerender();
  },
  'cal-day'(el) {
    const iso = el.dataset.v;
    const ss = realSessions().filter((x) => x.date === iso);
    if (!ss.length) return;
    if (ss.length === 1) { go(`#/sesion/${ss[0].id}`); return; }
    openSheet(`<div class="sheet">
      <div class="grabber"></div>
      <div class="sheet-head"><span></span><b>${esc(cap(I.parseDate(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })))}</b><button class="link" data-action="close-sheet" type="button">Cerrar</button></div>
      <div class="sheet-body">
        <div class="list">${ss.map(sessionCard).join('')}</div>
      </div></div>`);
  },
  'past-session'() {
    const d = ensureDraft();
    if (d.climbs.length && d.date === I.today()) { toast('Tienes una sesión abierta: cambia su fecha en «¿Cuándo fue?»'); go('#/nueva'); return; }
    applyDraftDate(I.toISO(new Date(Date.now() - 86400000)), false);
    go('#/nueva'); toast('Elige la fecha en «¿Cuándo fue?»');
  },
  'set-kind'(el) { state.draft.kind = el.dataset.v; state.draft.kindManual = true; if (el.dataset.v === 'class') state.draft.where = 'sharma'; saveDraftSoon(); rerender(); },
  'set-where'(el) {
    const d = state.draft; d.where = el.dataset.v;
    if (d.where === 'other' && d.climbs.some((c) => c.vlId)) toast('Los bloques concretos del Sharma se quitan al cambiar de rocódromo');
    if (d.where === 'other') d.climbs = d.climbs.filter((c) => !c.vlId);
    saveDraftSoon(); rerender();
  },
  'og-edit'(el) {
    const cur = gymCircuit(el.dataset.v); if (!cur) return;
    state.circ = { name: cur.name, colors: structuredClone(cur.colors).map((x) => ({ ...x, origName: x.name })) };
    openCircuitSheet(cur.name);
  },
  'circ-open'() {
    const name = (state.draft?.gymName || '').trim(); if (!name) { toast('Escribe primero el nombre del rocódromo'); return; }
    const cur = gymCircuit(name);
    state.circ = { name, colors: cur ? structuredClone(cur.colors).map((x) => ({ ...x, origName: x.name })) : [] };
    openCircuitSheet(name);
  },
  'circ-add'(el) {
    const c = state.circ; let n = el.dataset.name;
    if (n === 'Nuevo') { let k = 1; while (c.colors.some((x) => x.name === `Color ${k}`)) k++; n = `Color ${k}`; }
    c.colors.push({ name: n, color: el.dataset.color, eq: 0 }); autoEq(); haptic(); openCircuitSheet(c.name);
  },
  'circ-move'(el) {
    const c = state.circ; const i = Number(el.dataset.i); const j = i + Number(el.dataset.d);
    if (j < 0 || j >= c.colors.length) return;
    [c.colors[i], c.colors[j]] = [c.colors[j], c.colors[i]]; autoEq(); openCircuitSheet(c.name);
  },
  'circ-del'(el) { state.circ.colors.splice(Number(el.dataset.i), 1); autoEq(); openCircuitSheet(state.circ.name); },
  async 'circ-save'() {
    const c = state.circ;
    const names = c.colors.map((x) => x.name.trim()).filter(Boolean);
    if (new Set(names.map((x) => x.toLowerCase())).size !== names.length) { toast('Hay dos colores con el mismo nombre'); return; }
    const old = gymCircuit(c.name);
    const colors = c.colors.map((x) => ({ name: x.name.trim(), color: x.color, eq: Number(x.eq), eqManual: !!x.eqManual }));
    state.settings.otherGyms = { ...(set().otherGyms || {}), [gymKey(c.name)]: { name: c.name, colors } };
    await saveSettings();
    // Recalcular sesiones antiguas y el borrador de este rocódromo.
    const byName = Object.fromEntries(colors.map((x) => [x.name, x]));
    const renamed = {}; c.colors.forEach((x) => { if (x.origName && x.origName !== x.name.trim()) renamed[x.origName] = x.name.trim(); });
    void old;
    const fix = (cl) => { if (!cl.gymColor) return false; const nm = renamed[cl.gymColor] || cl.gymColor; const col = byName[nm]; if (!col) return false; const ch = cl.grade !== col.eq || cl.gymColor !== nm || cl.gymColorHex !== col.color; cl.gymColor = nm; cl.grade = col.eq; cl.gymColorHex = col.color; return ch; };
    const changed = state.sessions.filter((x) => x.where === 'other' && gymKey(x.gym) === gymKey(c.name) && (x.climbs || []).map(fix).some(Boolean));
    if (changed.length) await db.putMany('sessions', changed);
    if (state.draft) { state.draft.climbs.forEach(fix); saveDraftSoon(); }
    closeSheet(); toast(`Colores de ${c.name} guardados`); rerender();
  },
  'pick-gym'(el) { state.draft.gymName = el.dataset.v; saveDraftSoon(); rerender(); },
  'with-add'(el) { addWith(el.dataset.v); },
  'with-solo'() { const d = state.draft; d.solo = !d.solo; if (d.solo) d.with = []; saveDraftSoon(); rerender(); },
  'with-add-input'() { const inp = $('[data-with]'); addWith(inp?.value); },
  'with-del'(el) { state.draft.with = state.draft.with.filter((f) => f !== el.dataset.v); saveDraftSoon(); rerender(); },
  cnt(el) {
    const d = state.draft; const r = el.dataset.r; const disc = state.ui.logDisc;
    const sent = r === 'send';
    if (el.dataset.g === 'inv') {
      if (Number(el.dataset.d) > 0) d.climbs.push({ id: uid(), discipline: 'invented', invKind: disc, grade: 0, result: r, attempts: sent ? 2 : 3, styles: [], holds: [], moves: [], name: '', zone: '', notes: '' });
      else { const idx = d.climbs.map((c, k) => [c, k]).reverse().find(([c]) => c.discipline === 'invented' && c.invKind === disc && M.isSent(c) === sent)?.[1]; if (idx != null) d.climbs.splice(idx, 1); }
      haptic(6); saveDraftSoon(); rerender();
      $(`.ctr button[data-g="inv"][data-r="${r}"]`)?.parentElement.querySelector('b')?.classList.add('bump');
      return;
    }
    if (el.dataset.gc != null) {
      const circ = gymCircuit(d.gymName); const col = circ?.colors[Number(el.dataset.gc)]; if (!col) return;
      if (Number(el.dataset.d) > 0) d.climbs.push({ id: uid(), discipline: 'boulder', grade: col.eq, gymColor: col.name, gymColorHex: col.color, result: r, attempts: sent ? 2 : 3, styles: [], holds: [], moves: [], name: '', zone: '', notes: '' });
      else { const idx = d.climbs.map((c, k) => [c, k]).reverse().find(([c]) => c.gymColor === col.name && M.isSent(c) === sent)?.[1]; if (idx != null) d.climbs.splice(idx, 1); }
      haptic(6); saveDraftSoon(); rerender();
      $(`.ctr button[data-gc="${el.dataset.gc}"][data-r="${r}"]`)?.parentElement.querySelector('b')?.classList.add('bump');
      return;
    }
    const g = Number(el.dataset.g);
    if (Number(el.dataset.d) > 0) {
      d.climbs.push({ id: uid(), discipline: disc, grade: g, result: r, attempts: sent ? 2 : 3, styles: [], holds: [], moves: [], name: '', zone: '', notes: '' });
      haptic(6);
    } else {
      const idx = d.climbs.map((c, k) => [c, k]).reverse().find(([c]) => c.discipline === disc && c.grade === g && M.isSent(c) === sent && !c.vlId)?.[1];
      if (idx == null) { toast('Ese lo elegiste de la sala: quítalo desde «Elegir bloques concretos»'); return; }
      d.climbs.splice(idx, 1); haptic(4);
    }
    saveDraftSoon(); rerender();
    $(`.ctr button[data-g="${g}"][data-r="${r}"]`)?.parentElement.querySelector('b')?.classList.add('bump');
  },
  'route-row'(el) { state.ui.routeRows = [...new Set([...state.ui.routeRows, Number(el.dataset.v)])]; rerender(); },
  'log-open'(el, e) { e.preventDefault(); state.ui.logOpen = !el.closest('details').open; rerender(); },
  async 'avatar-del'() {
    await db.del('settings', 'avatar');
    if (state.avatarURL) URL.revokeObjectURL(state.avatarURL);
    state.avatarURL = null; rerender();
  },
  'myev-add'() { myEventSheet(); },
  async 'myev-save'() {
    const val = (k) => ($(`[data-myev="${k}"]`)?.value || '').trim();
    const title = val('title'); const date = val('date');
    if (!title || !date) { toast('Pon al menos qué es y la fecha'); return; }
    const url = val('url');
    const ev = { id: uid(), title, date, end: val('end') && val('end') >= date ? val('end') : '', note: val('note'), url: /^https?:\/\//.test(url) ? url : '' };
    state.settings.myEvents = [...(set().myEvents || []), ev];
    await saveSettings(); closeSheet(); toast('Evento apuntado 📅'); rerender();
  },
  async 'myev-del'(el) {
    if (!armed(el, '¿Seguro? Toca otra vez')) return;
    state.settings.myEvents = (set().myEvents || []).filter((e) => e.id !== el.dataset.id);
    await saveSettings(); rerender();
  },
  'news-sector'(el) {
    Object.assign(state.ui, { gymDisc: el.dataset.kind === 'route' ? 'route' : 'boulder', gymSector: el.dataset.sector, gymCircuit: 'all', gymFilter: el.dataset.recent ? 'new' : 'all' });
    go('#/sala');
  },
  'set-mood'(el) { const v = Number(el.dataset.v); state.draft.mood = state.draft.mood === v ? null : v; saveDraftSoon(); rerender(); },
  'set-effort'(el) { state.draft.rpe = Number(el.dataset.v); saveDraftSoon(); rerender(); },
  'set-duration'(el) { state.draft.duration = Number(el.dataset.v); saveDraftSoon(); rerender(); },
  'log-disc'(el) { state.ui.logDisc = el.dataset.v; state.ui.logCircuit = null; state.ui.logSector = 'all'; rerender(); },
  'log-circuit'(el) { state.ui.logCircuit = el.dataset.v; state.ui.logSector = 'all'; rerender(); },
  'log-sector'(el) { state.ui.logSector = el.dataset.v; rerender(); },
  item(el) { openItemSheet(el.dataset.id); },
  async 'item-log'(el) {
    if (route() === 'nueva' && state.draft) logItem(el.dataset.id, el.dataset.v);
    else await logLoose(el.dataset.id, el.dataset.v);
    closeSheet(); rerender();
  },
  async 'item-remove'(el) {
    if (route() === 'nueva' && state.draft) {
      const d = state.draft; d.climbs = d.climbs.filter((c) => c.vlId !== el.dataset.id);
      saveDraftSoon();
    } else await removeLoose(el.dataset.id);
    closeSheet(); rerender();
  },
  'add-generic'(el) {
    ensureDraft();
    openGenericSheet({ id: uid(), discipline: el.dataset.disc, grade: Number(el.dataset.v), result: 'send', attempts: 2, styles: [], holds: [], moves: [], name: '', zone: '', notes: '' });
  },
  'edit-generic'(el) { const c = state.draft.climbs.find((x) => x.id === el.dataset.id); if (c) openGenericSheet({ ...c }); },
  'generic-grade'(el) { state.generic.grade = Number(el.dataset.v); haptic(); openGenericSheet(state.generic); },
  'generic-log'(el) {
    const d = ensureDraft(); const c = state.generic;
    c.result = el.dataset.v; c.attempts = c.result === 'flash' ? 1 : c.result === 'send' ? 2 : 3;
    const i = d.climbs.findIndex((x) => x.id === c.id);
    if (i >= 0) d.climbs[i] = c; else d.climbs.push(c);
    saveDraftSoon(); haptic(12); closeSheet(); rerender();
    toast(`${STATUS[c.result].label} · ${M.gradeLabel(c, set())}`);
  },
  'generic-remove'(el) {
    const d = state.draft; d.climbs = d.climbs.filter((c) => c.id !== el.dataset.id);
    saveDraftSoon(); closeSheet(); rerender();
  },
  async 'remove-photo'(el) {
    const id = el.dataset.id; const d = state.draft;
    const i = d.newPhotos.findIndex((p) => p.id === id);
    if (i >= 0) d.newPhotos.splice(i, 1); else d.removedPhotos.push(id);
    saveDraftSoon(); rerender();
  },
  'save-session': saveSession,
  'close-sheet'(el, e) { e.preventDefault(); closeSheet(); },
  // Sala
  'gym-disc'(el) { state.ui.gymDisc = el.dataset.v; state.ui.gymCircuit = 'all'; state.ui.gymSector = 'all'; rerender(); },
  'gym-filter'(el) { state.ui.gymFilter = state.ui.gymFilter === el.dataset.v ? 'all' : el.dataset.v; rerender(); },
  'gym-filter-new'() { state.ui.gymFilter = 'new'; },
  'gym-filter-trying'() { state.ui.gymFilter = 'trying'; },
  'gym-circuit'(el) { state.ui.gymCircuit = state.ui.gymCircuit === el.dataset.v ? 'all' : el.dataset.v; rerender(); },
  'gym-sector'(el) {
    let v = el.dataset.v;
    if (el.tagName.toLowerCase() === 'polygon') {
      const items = state.ui.gymDisc === 'route' ? state.gym.routes : state.gym.boulders;
      v = items.find((x) => x.sectorId === v)?.sector || 'all';
    }
    state.ui.gymSector = state.ui.gymSector === v ? 'all' : v; haptic(); rerender();
  },
  'gym-map'() { state.ui.gymMap = !state.ui.gymMap; rerender(); },
  'gym-clear'() { Object.assign(state.ui, { gymSector: 'all', gymCircuit: 'all', gymFilter: 'all' }); rerender(); },
  'gym-refresh'() { loadGym(true); toast('Actualizando la sala…'); },
  async 'scale-add'() {
    const sc = [...M.boulderScale(set())];
    sc.push({ name: `Nivel ${sc.length + 1}`, color: '#64748b', approx: '' });
    state.settings.boulderScale = sc; await saveSettings(); rerender();
  },
  async 'scale-del'(el) {
    const sc = [...M.boulderScale(set())];
    if (sc.length <= 2) return toast('Necesitas al menos dos niveles');
    if (!confirm(`¿Eliminar el color «${sc[el.dataset.i].name}»?`)) return;
    sc.splice(Number(el.dataset.i), 1);
    state.settings.boulderScale = sc; await saveSettings(); rerender();
  },
  async 'scale-up'(el) {
    const i = Number(el.dataset.i); const sc = [...M.boulderScale(set())];
    [sc[i - 1], sc[i]] = [sc[i], sc[i - 1]];
    state.settings.boulderScale = sc; await saveSettings(); rerender();
  },
  async 'scale-preset'() {
    if (!confirm('¿Restablecer los colores de la sala?')) return;
    state.settings.boulderScale = M.DEFAULT_BOULDER_SCALE; state.settings.scalePreset = 'sharma';
    await saveSettings(); rerender();
  },
};

function addWith(name) {
  const n = (name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!n) return;
  const d = state.draft; d.with = [...new Set([...(d.with || []), n])]; d.solo = false;
  saveDraftSoon(); rerender();
}

// Cambia la fecha del borrador y ajusta Clase/Libre según tus días (si no lo elegiste tú).
function applyDraftDate(iso, redraw = true) {
  const d = state.draft; if (!d || !iso) return;
  d.date = iso;
  if (!d.kindManual) { d.kind = P.isPlannedDay(iso, set()) ? 'class' : 'free'; if (d.kind === 'class') d.where = 'sharma'; }
  saveDraftSoon(); haptic();
  if (redraw) rerender();
}

async function addExtraDate(iso) {
  if (!iso) return;
  state.settings.extraDates = [...new Set([...(set().extraDates || []), iso])].filter((d) => d >= I.today()).sort();
  state.settings.skipped = (set().skipped || []).filter((d) => d !== iso);
  await saveSettings(); haptic(); toast(`Apuntado: ${P.niceDate(iso)}`); refreshPlanUI();
}

function refreshPlanUI() {
  if ($('#sheet').open && $('#sheet .weekdays')) planSheet();
  rerender();
}

function onClick(e) {
  if (e.target.closest('#sheet a.session-card')) closeSheet();
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  const tag = el.tagName.toLowerCase();
  if (tag === 'button' || tag === 'polygon' || tag === 'img') e.preventDefault();
  if (tag === 'button' && (el.classList.contains('chip') || el.classList.contains('tile-b'))) haptic(5);
  fn(el, e);
}

let settingsTimer;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('[data-with]')) { e.preventDefault(); addWith(e.target.value); }
});

function onInput(e) {
  const el = e.target;
  if (el.dataset.field && state.draft && el.type !== 'date') {
    state.draft[el.dataset.field] = el.value;
    if (el.dataset.field === 'notes') {
      const box = $('.notes-card .note-topics'); const t = N.topicsOf(el.value);
      if (box) box.innerHTML = t.length ? `<small class="muted">Lo apunto como:</small> ${N.topicChips(t)}` : '';
    }
    saveDraftSoon(400);
  } else if (el.dataset.circName != null && state.circ) {
    state.circ.colors[Number(el.dataset.circName)].name = el.value;
  } else if (el.dataset.circColor != null && state.circ) {
    state.circ.colors[Number(el.dataset.circColor)].color = el.value;
  } else if (el.hasAttribute('data-gymname') && state.draft) {
    state.draft.gymName = el.value; saveDraftSoon(400);
  } else if (el.dataset.setting) {
    state.settings[el.dataset.setting] = el.value;
    clearTimeout(settingsTimer); settingsTimer = setTimeout(saveSettings, 400);
  } else if (el.dataset.scale != null) {
    const sc = M.boulderScale(set()).map((g) => ({ ...g }));
    sc[el.dataset.scale][el.dataset.k] = el.value;
    state.settings.boulderScale = sc;
    clearTimeout(settingsTimer); settingsTimer = setTimeout(saveSettings, 400);
  }
}

async function onChange(e) {
  const el = e.target;
  if (el.dataset.field === 'date' && state.draft) {
    if (el.value && el.value <= I.today()) applyDraftDate(el.value);
    return;
  }
  if (el.dataset.circEq != null && state.circ) {
    const g = state.circ.colors[Number(el.dataset.circEq)]; g.eq = Number(el.value); g.eqManual = true; haptic(); return;
  }
  if (el.hasAttribute('data-loose-date')) {
    if (el.value && el.value <= I.today()) { state.looseDate = el.value; openItemSheet(state.sheetItem, true); }
    return;
  }
  if (el.hasAttribute('data-sch-time')) {
    state.settings.schedule = { days: [4], ...set().schedule, time: el.value || '19:00' }; await saveSettings(); return;
  }
  if (el.hasAttribute('data-sch-extra')) { await addExtraDate(el.value); return; }
  if (el.dataset.gymSelect) { state.ui[el.dataset.gymSelect] = el.value; rerender(); return; }
  if (el.hasAttribute('data-gymname')) { rerender(); return; }
  if (el.dataset.toggle) {
    state.settings[el.dataset.toggle] = el.checked; await saveSettings();
    if (el.dataset.toggle === 'liveGym' && el.checked) loadGym();
    return;
  }
  if (!el.dataset.upload || !el.files?.length) return;
  const files = [...el.files];
  el.value = '';
  if (el.dataset.upload === 'import') return importData(files[0]);
  if (el.dataset.upload === 'avatar') {
    const blob = await compressImage(files[0], 512, 0.86);
    await db.put('settings', { key: 'avatar', blob });
    if (state.avatarURL) URL.revokeObjectURL(state.avatarURL);
    state.avatarURL = URL.createObjectURL(blob);
    toast('¡Foto de perfil actualizada!'); rerender(); return;
  }
  toast('Procesando foto…');
  await addPhotos(files);
  rerender();
}

// ---------------- Gestos de la hoja inferior ----------------
function setupSheetGestures() {
  const dlg = $('#sheet');
  let startY = null; let dy = 0;
  dlg.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.grabber, .sheet-head')) return;
    startY = e.clientY; dy = 0; dlg.style.transition = 'none';
  });
  window.addEventListener('pointermove', (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.clientY - startY);
    dlg.style.transform = `translateY(${dy}px)`;
  });
  window.addEventListener('pointerup', () => {
    if (startY == null) return;
    dlg.style.transition = '';
    if (dy > 110) closeSheet(); else dlg.style.transform = '';
    startY = null;
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeSheet(); });
}

// ---------------- Utilidades UI ----------------

function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<a href="${action.href}">${esc(action.label)}</a>` : ''}`;
  t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), action ? 3200 : 2200);
}

function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div'); box.className = 'confetti';
  const colors = M.boulderScale(set()).map((g) => g.color);
  box.innerHTML = Array.from({ length: 36 }, (_, i) => `<i style="--x:${Math.random() * 100}vw;--d:${0.6 + Math.random() * 0.9}s;--r:${Math.random() * 720}deg;background:${colors[i % colors.length]}"></i>`).join('');
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 1800);
}

function openPhoto(id) {
  const p = state.photos.get(id); if (!p) return;
  const s = state.sessions.find((x) => x.id === p.sessionId);
  const dlg = $('#lightbox');
  dlg.innerHTML = `<form method="dialog"><button class="lb-close" aria-label="Cerrar">${icon('close')}</button></form>
    <img src="${photoURL(id)}" alt="">
    <div class="lb-cap">${s ? `<a href="#/sesion/${s.id}" onclick="this.closest('dialog').close()">${I.fmtDate(s.date, { day: 'numeric', month: 'long', year: 'numeric' })} →</a>` : ''}</div>`;
  dlg.showModal();
}

function shareText(s) {
  const climbs = s.climbs || [];
  const sent = climbs.filter(M.isSent);
  const flashes = climbs.filter((c) => statusOf(c.result) === 'flash').length;
  const best = [...sent].sort((a, b) => M.intensity(b, set()) - M.intensity(a, set()))[0];
  return [
    `🧗‍♀️ Sesión de ${(TYPE_LABEL[s.type] || 'escalada').toLowerCase()} en ${set().gym || 'el rocódromo'} · ${I.fmtDate(s.date, { day: 'numeric', month: 'long' })}`,
    climbs.length ? `✅ ${plural(sent.length, 'conseguido', 'conseguidos')}${flashes ? ` · ⚡ ${flashes} a la primera` : ''}` : '',
    best ? `🏆 Lo más difícil: ${M.gradeLabel(best, set())}` : '',
  ].filter(Boolean).join('\n');
}

init();
