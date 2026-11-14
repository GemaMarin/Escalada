import { db, uid, compressImage, blobToDataURL, dataURLToBlob } from './db.js';
import * as M from './model.js';
import * as I from './insights.js';
import * as C from './charts.js';
import * as S from './sharma.js';
import { icon } from './icons.js';
import { makeDemo } from './demo.js';
import * as P from './schedule.js';
import * as N from './notes.js';
import { tipOfDay } from './tips.js';

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
    histTab: 'sessions', progTab: 'resumen', progDisc: 'boulder', bodyRange: '28',
    gymDisc: 'boulder', gymSector: 'all', gymCircuit: 'all', gymFilter: 'all', gymMap: false, onb: 0,
    logDisc: 'boulder', logCircuit: null, logSector: 'all', logOpen: false, routeRows: [], tip: 0,
  },
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const set = () => state.settings;
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
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
  if (settings) await db.put('settings', state.settings);
  photos.forEach((p) => state.photos.set(p.id, p));
  if (draft?.value) state.draft = { newPhotos: [], removedPhotos: [], ...draft.value };
  if (mig.changed && state.draft) await db.put('settings', { key: 'draft', value: state.draft });
  applyTheme();
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
  window.addEventListener('hashchange', () => render({ transition: true }));
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installEvt = e; if (route() === 'inicio') rerender(); });
  setInterval(tickTimers, 1000);
  setupSheetGestures();
  render();
  document.body.classList.add('ready');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (set().liveGym !== false) loadGym();
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
  if (['sala', 'inicio', 'nueva', 'progreso'].includes(route()) && !document.querySelector('dialog[open]')) rerender();
}

// ---------------- Router ----------------
const routes = [
  [/^#?\/?(inicio)?$/, viewHome, 'inicio'],
  [/^#\/diario$/, viewHistory, 'diario'],
  [/^#\/historial$/, viewHistory, 'diario'],
  [/^#\/sesion\/([\w-]+)$/, viewDetail, 'diario'],
  [/^#\/nueva$/, viewEditor, 'nueva'],
  [/^#\/editar\/([\w-]+)$/, viewEditor, 'nueva'],
  [/^#\/sala$/, viewGym, 'sala'],
  [/^#\/progreso$/, viewProgress, 'progreso'],
  [/^#\/cuerpo$/, () => { state.ui.progTab = 'cuerpo'; return viewProgress(); }, 'progreso'],
  [/^#\/ajustes$/, viewSettings, 'ajustes'],
];
const route = () => document.body.dataset.route;

function render({ transition = false } = {}) {
  const hash = location.hash || '#/inicio';
  for (const [re, fn, tab] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    const swap = () => {
      $('#view').innerHTML = fn(m[1]);
      document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
      document.body.dataset.route = tab;
      if (!render.keepScroll) window.scrollTo(0, 0);
      render.keepScroll = false;
      tickTimers();
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
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`);
const ago = (ts) => {
  const d = Math.floor((Date.now() - ts) / 86400000);
  return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : d < 7 ? `hace ${d} días` : d < 30 ? `hace ${Math.floor(d / 7)} sem` : `hace ${Math.floor(d / 30)} mes${d >= 60 ? 'es' : ''}`;
};

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
      <div class="sc-meta">${climbs.length ? `${plural(sent, 'conseguido', 'conseguidos')}${tried ? ` · ${tried} intentado${tried > 1 ? 's' : ''}` : ''}` : 'Sin bloques apuntados'}${(s.with || []).length ? ` · con ${esc(s.with.join(', '))}` : ''}</div>
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
const badge = (a) => `<div class="badge ${a.done ? 'done' : ''}" title="${esc(a.desc)}"><span>${a.icon}</span><b>${esc(a.title)}</b><small>${esc(a.desc)}</small></div>`;

function ring(value, goal, size = 92) {
  const r = (size - 10) / 2; const c = 2 * Math.PI * r; const p = Math.min(1, goal ? value / goal : 0);
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
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
  const s = state.sessions;
  if (!s.length && !set().onboarded) return viewOnboarding();
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
      <div><b>Sesión en curso</b><small>${plural(pending.climbs.length, 'bloque apuntado', 'bloques apuntados')}${pending.startedAt ? ' · <span data-timer></span>' : ''}</small></div>
      <span class="btn sm light">Continuar</span></a>` : '';
  return `<header class="home-head">
      <div><p class="eyebrow">${esc(now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
      <h1>${hello}${name ? `, ${esc(name)}` : ''}</h1></div>
      <a href="#/ajustes" class="avatar" aria-label="Ajustes">${esc((name || '🧗').slice(0, 1).toUpperCase())}</a>
    </header>
    ${live}${plan ? planCardHTML(plan) : ''}
    <section class="hero">
      <div class="hero-ring">${ring(weekSessions, goal)}<div class="hero-ring-v"><b>${weekSessions}</b><small>de ${goal}</small></div></div>
      <div class="hero-txt">
        <p class="hero-k">Esta semana</p>
        <h2>${weekSessions >= goal ? '¡Objetivo cumplido!' : goal - weekSessions === 1 ? (goal === 1 ? 'Te falta tu sesión' : 'Te queda 1 sesión') : `Te quedan ${goal - weekSessions} sesiones`}</h2>
        ${streak ? `<div class="hero-chips"><span>${icon('fire')} ${plural(streak, 'semana seguida', 'semanas seguidas')}</span></div>` : ''}
      </div>
    </section>
    ${!pending && !(plan?.today || plan?.pending) ? `<a class="btn primary block big" href="#/nueva" data-action="start-session">${icon('plus')} Registrar sesión</a>` : ''}
    ${nextChallenge()}
    ${trying.length ? `<section><div class="section-head"><h2 class="section-title">Bloques que estás intentando</h2><a href="#/sala" data-action="gym-filter-trying">Ver todos</a></div>
      <p class="muted small sub">Bloques que has intentado y siguen montados. ¡A por ellos!</p>
      <div class="tiles-row">${trying.map((x) => itemTile(x, itemStatus(log.get(x.vlId)))).join('')}</div></section>` : ''}
    ${last ? `<section><div class="section-head"><h2 class="section-title">Tu última sesión</h2><a href="#/diario">Diario</a></div>${sessionCard(last)}</section>` : ''}
    ${tipCard()}
    ${insights.length ? `<section><h2 class="section-title">Para ti</h2><div class="insights">${[...noteInsights(), ...insights].slice(0, 2).map(insightCard).join('')}</div></section>` : ''}
    ${gymTeaser()}
    ${installCard()}
    ${!s.length ? `<div class="card soft center"><p>¿Quieres ver cómo queda con datos? Puedes cargar datos de ejemplo y borrarlos después en Ajustes.</p><button class="btn ghost" data-action="demo">Ver con datos de ejemplo</button></div>` : ''}`;
}

// Siguiente color/grado a por el que ir, según lo conseguido.
function nextChallenge() {
  const climbs = I.allClimbs(state.sessions);
  const scale = M.boulderScale(set());
  const out = [];
  const bSent = climbs.filter((c) => c.discipline === 'boulder' && M.isSent(c)).map((c) => c.grade);
  if (bSent.length || set().usualCircuit) {
    const best = bSent.length ? Math.max(...bSent) : null;
    let next = null;
    if (best == null) next = M.boulderIndexByName(set(), set().usualCircuit);
    else for (let i = best + 1; i < scale.length; i++) if (!scale[i].joker) { next = i; break; }
    if (next != null && next >= 0) {
      out.push(`<div class="nc"><span class="nc-k">Bloque</span>${gradeChip({ discipline: 'boulder', grade: next })}<small>${best != null ? `Ya tienes el ${esc(scale[best].name)}` : 'Tu color para empezar'}</small></div>`);
    } else if (best != null) out.push(`<div class="nc"><span class="nc-k">Bloque</span>${gradeChip({ discipline: 'boulder', grade: best })}<small>¡Ya estás en el más difícil!</small></div>`);
  }
  const rSent = climbs.filter((c) => c.discipline === 'route' && M.isSent(c)).map((c) => c.grade);
  if (rSent.length) {
    const best = Math.max(...rSent);
    const next = Math.min(best + 1, M.ROUTE_GRADES.length - 1);
    out.push(`<div class="nc"><span class="nc-k">Vía</span>${gradeChip({ discipline: 'route', grade: next })}<small>Tu mejor: ${esc(M.ROUTE_GRADES[best])}</small></div>`);
  }
  if (!out.length) return '';
  return `<section class="card next-card"><div class="nc-head">${icon('trophy')}<b>Tu próximo reto</b></div><div class="nc-row">${out.join('')}</div></section>`;
}

function tipCard() {
  const t = tipOfDay(state.ui.tip);
  return `<section class="card tip"><div class="tip-head"><span class="tip-cat">💡 ${esc(t.cat)}</span><button class="link" data-action="next-tip">Otro consejo ${icon('refresh')}</button></div><p>${esc(t.text)}</p></section>`;
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

function gymTeaser() {
  const g = state.gym;
  if (!g || (!g.boulders.length && !g.routes.length)) return '';
  const fresh = gymItems().filter((x) => Date.now() - x.date < WEEK);
  return `<a class="card gym-teaser" href="#/sala" ${fresh.length ? 'data-action="gym-filter-new"' : ''}>
    <div class="gt-head"><span class="gt-icon">${icon('wall')}</span><div><b>${fresh.length ? `${plural(fresh.length, 'bloque o vía nueva', 'bloques y vías nuevos')} esta semana` : 'Bloques y vías de la sala'}</b>
    <small>${g.boulders.length} bloques · ${g.routes.length} vías montados ahora</small></div>${icon('chevron', 'muted')}</div>
  </a>`;
}

function installCard() {
  if (isStandalone() || set().installDismissed) return '';
  if (state.installEvt) {
    return `<div class="card install">${icon('install')}<div><b>Instala la app</b><small>Acceso directo, pantalla completa y funciona sin cobertura.</small></div>
      <button class="btn sm primary" data-action="install">Instalar</button><button class="x-btn" data-action="install-dismiss" aria-label="Cerrar">${icon('close')}</button></div>`;
  }
  if (isIOS()) {
    return `<div class="card install">${icon('install')}<div><b>Añádela a tu pantalla de inicio</b><small>En Safari pulsa ${icon('share', 'inline')} Compartir → «Añadir a pantalla de inicio».</small></div>
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
function viewHistory() {
  const { histTab } = state.ui;
  const tabs = seg('hist-tab', histTab, { sessions: 'Sesiones', photos: 'Fotos' });
  if (histTab === 'photos') {
    const photos = [...state.photos.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
    return `<h1 class="page-title">Diario</h1>${tabs}
      ${photos.length ? `<div class="gallery">${photos.map((p) => `<button class="thumb" data-action="photo" data-id="${p.id}"><img src="${photoURL(p.id)}" alt="" loading="lazy"></button>`).join('')}</div>`
        : emptyState('Sin fotos todavía', 'Puedes añadir fotos al apuntar una sesión.', '', 'camera')}`;
  }
  const list = I.sortSessions(state.sessions);
  const groups = {};
  list.forEach((s) => { const k = s.date.slice(0, 7); (groups[k] ||= []).push(s); });
  return `<h1 class="page-title">Diario</h1>${tabs}
    ${list.length ? Object.entries(groups).map(([k, ss]) => {
      const [y, m] = k.split('-').map(Number);
      const label = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
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
  climbs.forEach((c) => { const k = `${c.discipline}|${c.grade}`; const r = (byGrade[k] ||= { c, sent: 0, tried: 0 }); if (M.isSent(c)) r.sent++; else r.tried++; });
  const rows = Object.values(byGrade).sort((a, b) => a.c.discipline.localeCompare(b.c.discipline) || b.c.grade - a.c.grade);
  return `<div class="topline"><a href="#/diario" class="back">${icon('back')} Diario</a>
      <div class="row-gap"><button class="icon-btn" data-action="share" data-id="${s.id}" aria-label="Compartir">${icon('share')}</button><a class="icon-btn" href="#/editar/${s.id}" aria-label="Editar">${icon('edit')}</a></div></div>
    <p class="eyebrow">${esc(date)}</p>
    <h1 class="page-title">${esc(titleOf(s))}${s.mood != null ? ` ${M.MOODS[s.mood]}` : ''}</h1>
    ${(s.with || []).length ? `<p class="with-line">👯 Con ${esc(s.with.join(', '))}</p>` : ''}
    <section class="kpis three">
      ${kpi(sent.length, 'conseguidos')}
      ${kpi(flashes, 'a la primera')}
      ${kpi(climbs.length - sent.length, 'intentados')}
    </section>
    ${rows.length ? `<div class="card"><h3>Por ${rows.some((r) => r.c.discipline === 'route') && !rows.some((r) => r.c.discipline === 'boulder') ? 'grado' : 'color'}</h3>
      ${rows.map((r) => `<div class="drow">${gradeChip(r.c, 'sm')}<span class="st-text-send">${r.sent ? `${icon('check', 'inline')} ${r.sent}` : ''}</span><span class="st-text-proj">${r.tried ? `${icon('refresh', 'inline')} ${r.tried}` : ''}</span></div>`).join('')}</div>` : ''}
    ${s.notes ? `<div class="card notes">${esc(s.notes).replace(/\n/g, '<br>')}${topics.length ? `<div class="note-topics">${N.topicChips(topics)}</div>` : ''}</div>` : ''}
    ${specific.length ? `<h2 class="section-title">Bloques de la sala</h2><div class="list">${specific.map(climbRow).join('')}</div>` : ''}
    ${photos.length ? `<h2 class="section-title">Fotos</h2><div class="gallery">${photos.map((p) => `<button class="thumb" data-action="photo" data-id="${p.id}"><img src="${photoURL(p.id)}" alt=""></button>`).join('')}</div>` : ''}
    <button class="btn danger ghost block" data-action="delete-session" data-id="${s.id}">${icon('trash')} Eliminar sesión</button>`;
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
  return { id: uid(), isNew: true, date: t, kind: P.isPlannedDay(t, set()) ? 'class' : 'free', with: [], type: 'boulder', duration: 90, rpe: null, mood: null, notes: '', climbs: [], newPhotos: [], removedPhotos: [], startedAt: null };
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
    state.draft = { with: [], ...structuredClone(s), isNew: false, newPhotos: [], removedPhotos: [] };
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
      ${d.startedAt ? `<button class="timer-pill" data-action="timer">${icon('timer')} <span data-timer></span></button>` : (d.isNew ? `<button class="timer-pill off" data-action="timer">${icon('timer')} Cronómetro</button>` : '')}</div>
    <h1 class="page-title">${d.isNew ? `Sesión ${esc(P.sessionOf(d.date))}` : 'Editar sesión'}</h1>
    <label class="date-line">${icon('calendar')} <span>${esc(dateLabel)}</span> <b>Cambiar</b><input type="date" data-field="date" value="${d.date}" max="${I.today()}" class="hidden-date"></label>

    <div class="kind-pick">
      <button class="kind ${d.kind !== 'free' ? 'on' : ''}" data-action="set-kind" data-v="class"><span>🎓</span><b>Clase</b></button>
      <button class="kind ${d.kind === 'free' ? 'on' : ''}" data-action="set-kind" data-v="free"><span>🧗‍♀️</span><b>Libre</b></button>
    </div>
    ${d.kind === 'free' ? `<div class="card with-card"><b>¿Con quién has ido?</b>
      <div class="chips">${d.with.map((f) => `<button class="chip on" data-action="with-del" data-v="${esc(f)}">${esc(f)} ${icon('close')}</button>`).join('')}
        ${friends.map((f) => `<button class="chip" data-action="with-add" data-v="${esc(f)}">＋ ${esc(f)}</button>`).join('')}</div>
      <div class="with-input"><input data-with placeholder="Escribe un nombre" enterkeyhint="done"><button class="btn sm" data-action="with-add-input">Añadir</button></div></div>` : ''}

    ${seg('log-disc', disc, { boulder: `${icon('boulder')} Bloques`, route: `${icon('rope')} Vías` })}
    ${countsCard(disc)}

    <details class="card picker-box" ${state.ui.logOpen || specific ? 'open' : ''}>
      <summary data-action="log-open">${icon('wall')}<span><b>Elegir ${disc === 'route' ? 'vías concretas' : 'bloques concretos'}</b><small>${specific ? `${plural(specific, 'elegido', 'elegidos')} de la sala` : 'Opcional · si te acuerdas de cuál era'}</small></span>${icon('chevron', 'chev')}</summary>
      ${state.ui.logOpen || specific ? logPicker(disc) : ''}
    </details>

    <div class="card form">
      <div class="field"><span>¿Cómo te has sentido?</span><div class="moods">${M.MOODS.map((m, i) => `<button class="mood ${d.mood === i ? 'on' : ''}" data-action="set-mood" data-v="${i}">${m}</button>`).join('')}</div></div>
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
    ${mine.length ? `<p class="counts-sum">${hardest != null ? `Lo más difícil conseguido: <b>${esc(label(hardest))}</b>` : ''}${hardestTry != null && (hardest == null || hardestTry > hardest) ? `${hardest != null ? ' · ' : ''}Has llegado a intentar <b>${esc(label(hardestTry))}</b>` : ''}</p>` : ''}
  </div>`;
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
async function openItemSheet(vlId) {
  const x = findItem(vlId);
  const inDraft = state.draft?.climbs.find((c) => c.vlId === vlId);
  if (!x && !inDraft) return;
  const item = x || { vlId, kind: inDraft.discipline, number: inDraft.vlNumber, hold: inDraft.holdName, holdColor: inDraft.holdColor, grade: M.gradeLabel(inDraft, set()), sector: inDraft.zone, sectorId: null, date: 0 };
  const isRoute = item.kind === 'route';
  const before = (() => { // historial sin contar la sesión abierta
    let best = null; let n = 0; let sentOn = null;
    for (const s of state.sessions) for (const c of s.climbs || []) if (c.vlId === vlId && s.id !== state.draft?.id) { n++; if (M.RESULTS[c.result]?.sent) { best = 'sent'; if (!sentOn || s.date < sentOn) sentOn = s.date; } else if (!best) best = 'trying'; }
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
      <div class="ask"><b>¿Cómo te ha ido ${esc(whenText(state.draft))}?</b></div>
      ${statusButtons('item-log', vlId, inDraft?.result)}
      ${inDraft ? `<button type="button" class="link muted-link" data-action="item-remove" data-id="${esc(vlId)}">Quitar de la sesión</button>` : ''}
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
    ${withTopo.length ? '<p class="muted small">Toca un sector del plano para ver solo sus bloques.</p>' : ''}</div>`;
}

// ---------------- Progreso ----------------
function viewProgress() {
  const tab = state.ui.progTab;
  const tabs = seg('prog-tab', tab, { resumen: 'Resumen', cuerpo: 'Cuerpo', logros: 'Logros' });
  if (!state.sessions.length) return `<h1 class="page-title">Progreso</h1>${tabs}${emptyState('Aún no hay datos', 'Apunta tu primera sesión y aquí verás cómo mejoras.', '<a class="btn primary" href="#/nueva">Registrar sesión</a>', 'chart')}`;
  const body = tab === 'cuerpo' ? progBody() : tab === 'logros' ? progAchievements() : progSummary();
  return `<h1 class="page-title">Progreso</h1>${tabs}${body}`;
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
    <div class="card"><h3>Días que has escalado</h3><div class="scroll-x">${C.calendarHeatmap(s)}</div></div>
    ${topicsCard()}
    ${trying.length ? `<div class="card"><h3>${icon('refresh')} Estás intentando</h3><p class="muted small">Siguen montados en la sala: ¡la próxima vez saldrán!</p><div class="tile-grid">${trying.map((x) => itemTile(x, itemStatus(log.get(x.vlId)))).join('')}</div></div>` : ''}`;
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
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 32 32)" style="filter:drop-shadow(0 0 .5px rgb(0 0 0 / .4))"/>
    <text x="32" y="37" text-anchor="middle" class="ring-pct">${Math.round(p * 100)}%</text></svg>`;
}

const BODY_TIPS = {
  dedos: 'Calienta de menos a más en presas grandes antes de apretar presas pequeñas y descansa ~48 h entre sesiones duras. Si notas dolor en la base del dedo, para.',
  antebrazos: 'Estira los antebrazos y sacude los brazos en los descansos. Unos ejercicios con goma elástica ayudan a compensar.',
  biceps: 'Haz también ejercicios de empuje (flexiones, fondos) para equilibrar.',
  hombros: 'Calienta bien los hombros (círculos con los brazos, goma elástica) antes de los bloques desplomados.',
  espalda: 'Compensa con flexiones y estiramientos de pecho y espalda.',
  core: 'Planchas y elevaciones de piernas te ayudan a no despegar los pies en los desplomes.',
  cadera: 'La movilidad de cadera (postura de la rana, mariposa) te acerca a la pared y ahorra fuerza.',
  piernas: '¡Buena señal! Escalar con los pies ahorra brazos. Fíjate en poner bien los pies.',
};
const BODY_EMOJI = { dedos: '🤞', antebrazos: '💪', biceps: '💪', hombros: '🏋️', espalda: '🔙', core: '🎯', cadera: '🧘', piernas: '🦵' };

function progBody() {
  const range = state.ui.bodyRange;
  const now = I.today();
  const ss = range === 'all' ? state.sessions : state.sessions.filter((s) => I.daysBetween(s.date, now) < Number(range));
  const bl = I.bodyLoad(ss, set());
  const parts = Object.entries(bl.total).sort((a, b) => b[1] - a[1]);
  return `${seg('body-range', range, { 28: '4 semanas', 90: '3 meses', all: 'Todo' })}
    ${bl.sum ? `<div class="card body-card">${C.bodyMap(bl.total, bl.max)}
      <div class="heat-legend"><span>Menos</span><i></i><span>Más</span></div></div>
      <h2 class="section-title">Consejos</h2>
      <div class="insights">${parts.slice(0, 3).map(([p]) => `<div class="insight info"><div class="ins-icon">${BODY_EMOJI[p]}</div><div><b>${M.BODY_PARTS[p]}</b><p>${BODY_TIPS[p]}</p></div></div>`).join('')}</div>
      <p class="muted small note">${icon('info', 'inline')} Es una estimación orientativa según lo que escalas (color y tipo de bloque). No sustituye la opinión de un fisio.</p>`
      : emptyState('Sin datos en este periodo', 'Apunta sesiones para ver qué partes del cuerpo trabajas más.', '<a class="btn primary" href="#/nueva">Registrar sesión</a>', 'body')}`;
}

function progAchievements() {
  const ach = I.achievements(state.sessions, state.photos.size);
  const done = ach.filter((a) => a.done).length;
  return `<div class="card ach-head">${ring(done, ach.length, 76)}<div><b>${done} de ${ach.length} logros</b><small class="muted">Sigue escalando para desbloquear el resto.</small></div></div>
    <div class="badges">${ach.map(badge).join('')}</div>`;
}

// ---------------- Ajustes ----------------
function viewSettings() {
  const st = set();
  const scale = M.boulderScale(st);
  const demoCount = state.sessions.filter((s) => s.demo).length;
  return `<div class="topline"><a href="#/inicio" class="back">${icon('back')} Inicio</a></div>
    <h1 class="page-title">Ajustes</h1>
    <div class="card form">
      <label class="field"><span>Tu nombre</span><input data-setting="name" value="${esc(st.name)}" placeholder="¿Cómo te llamas?"></label>
      <div class="field"><span>Objetivo semanal</span><div class="seg">${[1, 2, 3].map((n) => `<button class="${(st.weeklyGoal || 1) === n ? 'on' : ''}" data-action="set-goal" data-v="${n}">${plural(n, 'sesión', 'sesiones')}</button>`).join('')}</div></div>
      <div class="field"><span>Aspecto</span>${seg('theme', st.theme || 'light', { light: 'Claro', dark: 'Oscuro', auto: 'Como el móvil' })}</div>
    </div>
    <div class="card form">
      <h3>${icon('calendar')} Tus días de escalada</h3>
      ${scheduleFields(st.schedule || { days: [4], time: '19:00' }, (st.extraDates || []).filter((d) => d >= I.today()).sort())}
    </div>
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
      <p class="muted small">${plural(state.sessions.length, 'sesión', 'sesiones')} · ${plural(state.photos.size, 'foto', 'fotos')}</p>
    </div>
    <p class="muted small center about">Cuaderno de Escalada · app no oficial, sin relación con Sharma Climbing.<br>Los bloques y vías de la sala proceden del widget público de Vertical-Life.</p>`;
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
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveDraftNow(); });
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
  if (startedAt) session.duration = Math.max(5, Math.round((Date.now() - startedAt) / 60000 / 5) * 5);
  const discs = new Set(session.climbs.map((c) => c.discipline));
  session.type = discs.size > 1 ? 'mixed' : discs.has('route') ? 'route' : discs.has('boulder') ? 'boulder' : (state.ui.logDisc || 'boulder');
  if (!session.rpe) session.rpe = 6;
  session.topics = N.topicsOf(session.notes);
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
  haptic([10, 40, 10]);
  if (isNew) celebrate();
  toast(isNew ? '¡Sesión guardada! 💪' : 'Cambios guardados');
  go(`#/sesion/${session.id}`);
}

async function addPhotos(files) {
  const d = state.draft;
  for (const f of files) {
    const blob = await compressImage(f);
    d.newPhotos.push({ id: uid(), blob, climbId: null, createdAt: Date.now() });
  }
  saveDraftSoon();
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
  const data = { app: 'cuaderno-escalada', version: 2, exportedAt: new Date().toISOString(), settings: state.settings, sessions: state.sessions, photos };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `escalada-${I.today()}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
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
    state.settings.onboarded = true; await saveSettings();
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
    Object.assign(state, { sessions: [], draft: null, stash: null, settings: { ...DEFAULT_SETTINGS } });
    state.photos.clear(); state.ui.onb = 0;
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
    const plan = P.planState(set(), state.sessions, null);
    if (date === I.today() && !(plan.today?.after) && !d.startedAt) d.startedAt = Date.now();
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
  'start-session'() { const d = ensureDraft(); if (d && !d.startedAt && !d.climbs.length && d.date === I.today()) { d.startedAt = Date.now(); saveDraftSoon(); } },
  export: exportData,
  'hist-tab'(el) { state.ui.histTab = el.dataset.v || el.dataset.tab; if (location.hash === '#/diario') rerender(); },
  'prog-tab'(el) { state.ui.progTab = el.dataset.v; if (location.hash === '#/progreso') rerender(); },
  'prog-disc'(el) { state.ui.progDisc = el.dataset.v; rerender(); },
  'body-range'(el) { state.ui.bodyRange = el.dataset.v; rerender(); },
  async theme(el) { state.settings.theme = el.dataset.v; applyTheme(); await saveSettings(); rerender(); },
  photo(el) { openPhoto(el.dataset.id); },
  async share(el) {
    const s = state.sessions.find((x) => x.id === el.dataset.id);
    const text = shareText(s);
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Resumen copiado al portapapeles'); }
    } catch { /* cancelado */ }
  },
  async 'delete-session'(el) {
    if (!confirm('¿Eliminar esta sesión y sus fotos?')) return;
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
  timer() {
    const d = state.draft;
    if (d.startedAt) { d.duration = Math.max(5, Math.round((Date.now() - d.startedAt) / 60000 / 5) * 5); d.startedAt = null; toast(`Cronómetro parado: ${fmtMin(d.duration)}`); }
    else { d.startedAt = Date.now(); toast('¡A escalar! ⏱'); }
    saveDraftSoon(); rerender();
  },
  'set-kind'(el) { state.draft.kind = el.dataset.v; saveDraftSoon(); rerender(); },
  'with-add'(el) { addWith(el.dataset.v); },
  'with-add-input'() { const inp = $('[data-with]'); addWith(inp?.value); },
  'with-del'(el) { state.draft.with = state.draft.with.filter((f) => f !== el.dataset.v); saveDraftSoon(); rerender(); },
  cnt(el) {
    const d = state.draft; const g = Number(el.dataset.g); const r = el.dataset.r; const disc = state.ui.logDisc;
    const sent = r === 'send';
    if (Number(el.dataset.d) > 0) {
      d.climbs.push({ id: uid(), discipline: disc, grade: g, result: r, attempts: sent ? 2 : 3, styles: [], holds: [], moves: [], name: '', zone: '', notes: '' });
      haptic(6);
    } else {
      const idx = d.climbs.map((c, k) => [c, k]).reverse().find(([c]) => c.discipline === disc && c.grade === g && M.isSent(c) === sent && !c.vlId)?.[1];
      if (idx == null) { toast('Ese lo elegiste de la sala: quítalo desde «Elegir bloques concretos»'); return; }
      d.climbs.splice(idx, 1); haptic(4);
    }
    saveDraftSoon(); rerender();
  },
  'route-row'(el) { state.ui.routeRows = [...new Set([...state.ui.routeRows, Number(el.dataset.v)])]; rerender(); },
  'log-open'(el, e) { e.preventDefault(); state.ui.logOpen = !el.closest('details').open; rerender(); },
  'next-tip'() { state.ui.tip++; rerender(); },
  'set-mood'(el) { const v = Number(el.dataset.v); state.draft.mood = state.draft.mood === v ? null : v; saveDraftSoon(); rerender(); },
  'set-effort'(el) { state.draft.rpe = Number(el.dataset.v); saveDraftSoon(); rerender(); },
  'set-duration'(el) { state.draft.duration = Number(el.dataset.v); saveDraftSoon(); rerender(); },
  'log-disc'(el) { state.ui.logDisc = el.dataset.v; state.ui.logCircuit = null; state.ui.logSector = 'all'; rerender(); },
  'log-circuit'(el) { state.ui.logCircuit = el.dataset.v; state.ui.logSector = 'all'; rerender(); },
  'log-sector'(el) { state.ui.logSector = el.dataset.v; rerender(); },
  item(el) { openItemSheet(el.dataset.id); },
  'item-log'(el) { logItem(el.dataset.id, el.dataset.v); closeSheet(); rerender(); },
  'item-remove'(el) {
    const d = state.draft; d.climbs = d.climbs.filter((c) => c.vlId !== el.dataset.id);
    saveDraftSoon(); closeSheet(); rerender();
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
  const d = state.draft; d.with = [...new Set([...(d.with || []), n])];
  saveDraftSoon(); rerender();
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
    if (el.value) { state.draft.date = el.value; if (el.value !== I.today()) state.draft.startedAt = null; saveDraftSoon(); rerender(); }
    return;
  }
  if (el.hasAttribute('data-sch-time')) {
    state.settings.schedule = { days: [4], ...set().schedule, time: el.value || '19:00' }; await saveSettings(); return;
  }
  if (el.hasAttribute('data-sch-extra')) { await addExtraDate(el.value); return; }
  if (el.dataset.gymSelect) { state.ui[el.dataset.gymSelect] = el.value; rerender(); return; }
  if (el.dataset.toggle) {
    state.settings[el.dataset.toggle] = el.checked; await saveSettings();
    if (el.dataset.toggle === 'liveGym' && el.checked) loadGym();
    return;
  }
  if (!el.dataset.upload || !el.files?.length) return;
  const files = [...el.files];
  el.value = '';
  if (el.dataset.upload === 'import') return importData(files[0]);
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
function tickTimers() {
  const d = state.draft?.isNew ? state.draft : state.stash;
  if (!d?.startedAt) return;
  const s = Math.floor((Date.now() - d.startedAt) / 1000);
  const txt = `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  document.querySelectorAll('[data-timer]').forEach((el) => { el.textContent = txt; });
}

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
