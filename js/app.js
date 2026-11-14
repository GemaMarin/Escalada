import { db, uid, compressImage, blobToDataURL, dataURLToBlob } from './db.js';
import * as M from './model.js';
import * as I from './insights.js';
import * as C from './charts.js';
import * as S from './sharma.js';
import { icon } from './icons.js';
import { makeDemo } from './demo.js';

const DEFAULT_SETTINGS = {
  key: 'settings', name: '', gym: S.GYM.name, weeklyGoal: 3,
  boulderScale: M.DEFAULT_BOULDER_SCALE, scalePreset: 'sharma', dataVersion: 2, liveGym: true,
};

const state = {
  sessions: [], settings: { ...DEFAULT_SETTINGS }, photos: new Map(), urls: new Map(),
  draft: null, stash: null, climb: null, gym: null, gymLoading: false, gymSectors: {}, installEvt: null,
  ui: {
    histTab: 'sessions', histFilter: 'all', progTab: 'grados', progDisc: 'boulder', bodyRange: '28',
    gymDisc: 'boulder', gymSector: 'all', gymCircuit: 'all', gymFilter: 'all', gymQuery: '', gymMap: false, onb: 0,
  },
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const set = () => state.settings;
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* sin soporte */ } };
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

// ---------------- Arranque ----------------
async function init() {
  const [settings, sessions, photos, draft] = await Promise.all([
    db.get('settings', 'settings'), db.all('sessions'), db.all('photos'), db.get('settings', 'draft'),
  ]);
  state.sessions = sessions;
  // Datos de la versión 1: ajustes sin «dataVersion» o sesiones sin ajustes guardados.
  const legacy = settings ? !settings.dataVersion : sessions.length > 0 || !!draft?.value;
  const stored = settings || {};
  const mig = M.migrate({ ...stored, dataVersion: legacy ? 1 : 2 }, state.sessions);
  state.settings = { ...DEFAULT_SETTINGS, ...stored, ...(mig.changed ? mig.settings : {}), dataVersion: 2 };
  if (mig.changed) {
    state.sessions = mig.sessions;
    await db.put('settings', state.settings);
    if (state.sessions.length) await db.putMany('sessions', state.sessions);
    if (draft?.value) draft.value = M.migrate({ dataVersion: 1, boulderScale: settings?.boulderScale }, [draft.value]).sessions[0];
  }
  photos.forEach((p) => state.photos.set(p.id, p));
  if (draft?.value) state.draft = { newPhotos: [], removedPhotos: [], activities: [], ...draft.value };
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
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

async function loadGym(force = false) {
  if (state.gymLoading) return;
  state.gymLoading = true;
  if (route() === 'sala') rerender();
  try { state.gym = await S.getGym({ force }); } finally { state.gymLoading = false; }
  if (['sala', 'inicio'].includes(route()) && !document.querySelector('dialog[open]')) rerender();
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

// ---------------- Componentes ----------------
function gradeChip(c, size = '') {
  const g = M.boulderScale(set())[c.grade];
  return `<span class="grade ${size}${c.discipline !== 'route' && g?.joker ? ' joker' : ''}" style="${C.gradeStyle(M.gradeColor(c, set()))}">${esc(M.gradeLabel(c, set()))}</span>`;
}

function holdDot(color, number = '', size = '') {
  if (!color) return '';
  return `<span class="hold ${size}" style="--h:${esc(color)};--ht:${C.textOn(color.length === 4 || color.length === 7 ? color : '#888')}">${esc(number)}</span>`;
}

function photoURL(id) {
  const p = state.photos.get(id) || state.draft?.newPhotos?.find((x) => x.id === id);
  if (!p) return '';
  if (!state.urls.has(id)) state.urls.set(id, URL.createObjectURL(p.blob));
  return state.urls.get(id);
}

const sessionPhotos = (sid) => [...state.photos.values()].filter((p) => p.sessionId === sid).sort((a, b) => a.createdAt - b.createdAt);

const TYPE_LABEL = { boulder: 'Bloque', route: 'Vías', mixed: 'Mixta', training: 'Entreno' };

function sessionCard(s) {
  const climbs = s.climbs || [];
  const sent = climbs.filter(M.isSent).length;
  const photos = sessionPhotos(s.id);
  const top = [...climbs].sort((a, b) => M.intensity(b, set()) - M.intensity(a, set())).slice(0, 10);
  return `<a class="card session-card" href="#/sesion/${s.id}">
    <div class="sc-date"><b>${I.parseDate(s.date).getDate()}</b><span>${I.fmtDate(s.date, { month: 'short' }).replace('.', '')}</span></div>
    <div class="sc-main">
      <div class="sc-title">${TYPE_LABEL[s.type] || 'Sesión'}${s.mood != null ? ` <span class="mood-i">${M.MOODS[s.mood]}</span>` : ''}</div>
      <div class="sc-meta">${climbs.length ? `${sent}/${climbs.length} encadenados` : 'Sin escaladas'}${s.duration ? ` · ${fmtMin(s.duration)}` : ''}</div>
      ${top.length ? `<div class="sc-grades">${top.map((c) => `<span class="dot${M.isSent(c) ? '' : ' open'}" style="--g:${M.gradeColor(c, set())}"></span>`).join('')}</div>` : ''}
    </div>
    ${photos[0] ? `<img class="sc-thumb" src="${photoURL(photos[0].id)}" alt="">` : `<span class="sc-go">${icon('chevron')}</span>`}
  </a>`;
}

const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`);
const ago = (ts) => {
  const d = Math.floor((Date.now() - ts) / 86400000);
  return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : d < 7 ? `hace ${d} días` : d < 30 ? `hace ${Math.floor(d / 7)} sem` : `hace ${Math.floor(d / 30)} mes${d >= 60 ? 'es' : ''}`;
};

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

// ---------------- Inicio ----------------
function viewHome() {
  const s = state.sessions;
  if (!s.length && !set().onboarded) return viewOnboarding();
  const name = set().name?.trim();
  const now = new Date();
  const wk = I.weekStart(now).getTime();
  const weekSessions = s.filter((x) => I.parseDate(x.date) >= wk).length;
  const goal = set().weeklyGoal || 3;
  const streak = I.weekStreak(s);
  const pending = state.draft?.isNew ? state.draft : state.stash;
  const st = I.summary(s, set());
  const insights = I.buildInsights(s, set());
  const recent = I.sortSessions(s).slice(0, 3);
  const photos = [...state.photos.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
  const ach = I.achievements(s, state.photos.size);
  const doneAch = ach.filter((a) => a.done);
  const hello = now.getHours() < 13 ? 'Buenos días' : now.getHours() < 21 ? 'Buenas tardes' : 'Buenas noches';
  const live = pending ? `<a class="live-card" href="#/nueva">
      <span class="pulse"></span>
      <div><b>Sesión en curso</b><small>${plural(pending.climbs.length, 'escalada', 'escaladas')}${pending.startedAt ? ' · <span data-timer></span>' : ''}</small></div>
      <span class="btn sm light">Continuar</span></a>` : '';
  return `<header class="home-head">
      <div><p class="eyebrow">${esc(now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
      <h1>${hello}${name ? `, ${esc(name)}` : ''}</h1></div>
      <a href="#/ajustes" class="avatar" aria-label="Ajustes">${esc((name || '🧗').slice(0, 1).toUpperCase())}</a>
    </header>
    ${live}
    <section class="hero">
      <div class="hero-ring">${ring(weekSessions, goal)}<div class="hero-ring-v"><b>${weekSessions}</b><small>de ${goal}</small></div></div>
      <div class="hero-txt">
        <p class="hero-k">Esta semana</p>
        <h2>${weekSessions >= goal ? '¡Objetivo cumplido! 🎉' : weekSessions ? `Te ${goal - weekSessions === 1 ? 'queda 1 sesión' : `quedan ${goal - weekSessions} sesiones`}` : 'Aún sin escalar'}</h2>
        <div class="hero-chips">${streak ? `<span>${icon('fire')} ${plural(streak, 'semana', 'semanas')}</span>` : ''}<span>${icon('check')} ${st.sent} encadenados</span></div>
      </div>
    </section>
    ${!pending ? `<a class="btn primary block big" href="#/nueva" data-action="start-session">${icon('play')} Empezar sesión</a>` : ''}
    ${s.length ? `<section class="kpis three">
      ${kpi(st.bestBoulder ? gradeChip(st.bestBoulder) : '—', 'mejor bloque', true)}
      ${kpi(st.bestRoute ? gradeChip(st.bestRoute) : '—', 'mejor vía', true)}
      ${kpi(st.monthSessions, 'sesiones este mes')}
    </section>` : ''}
    ${gymTeaser()}
    ${installCard()}
    ${insights.length ? `<section><h2 class="section-title">Para ti</h2><div class="carousel">${insights.slice(0, 6).map(insightCard).join('')}</div></section>` : ''}
    ${recent.length ? `<section><div class="section-head"><h2 class="section-title">Últimas sesiones</h2><a href="#/diario">Ver todas</a></div>
      <div class="list">${recent.map(sessionCard).join('')}</div></section>` : ''}
    ${photos.length ? `<section><div class="section-head"><h2 class="section-title">Fotos</h2><a href="#/diario" data-action="hist-tab" data-tab="photos">Galería</a></div>
      <div class="strip">${photos.map((p) => `<button class="thumb" data-action="photo" data-id="${p.id}"><img src="${photoURL(p.id)}" alt=""></button>`).join('')}</div></section>` : ''}
    ${s.length ? `<section><div class="section-head"><h2 class="section-title">Logros <span class="muted">${doneAch.length}/${ach.length}</span></h2><a href="#/progreso" data-action="prog-tab" data-v="logros">Ver todos</a></div>
      <div class="badges row">${(doneAch.length ? doneAch.slice(-4).reverse() : ach.slice(0, 4)).map(badge).join('')}</div></section>` : ''}
    ${!s.length ? `<div class="card soft center"><p>Registra tu primera sesión o explora la app con datos de ejemplo.</p><button class="btn ghost" data-action="demo">Ver con datos de ejemplo</button></div>` : ''}`;
}

function gymTeaser() {
  const g = state.gym;
  if (!g || (!g.boulders.length && !g.routes.length)) return '';
  const all = [...g.boulders, ...g.routes];
  const fresh = all.filter((x) => Date.now() - x.date < 7 * 86400000);
  const prog = circuitProgress(g).filter((c) => c.total).sort((a, b) => b.done / b.total - a.done / a.total || b.total - a.total).slice(0, 3);
  return `<a class="card gym-teaser" href="#/sala" data-action="gym-filter-new">
    <div class="gt-head"><span class="gt-icon">${icon('wall')}</span><div><b>${fresh.length ? `${plural(fresh.length, 'bloque o vía nueva', 'bloques y vías nuevos')} esta semana` : 'Bloques y vías de la sala'}</b>
    <small>${g.boulders.length} bloques · ${g.routes.length} vías ahora mismo en ${esc(S.GYM.name.replace('Sharma Climbing ', 'Sharma '))}</small></div>${icon('chevron', 'muted')}</div>
    ${prog.some((p) => p.done) ? `<div class="gt-prog">${prog.map((p) => `<div><span class="grade xs" style="${C.gradeStyle(p.color)}">${esc(p.name)}</span><div class="bar"><i style="width:${Math.round(p.done / p.total * 100)}%;background:${p.color}"></i></div><small>${p.done}/${p.total}</small></div>`).join('')}</div>` : ''}
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
  const step = state.ui.onb;
  if (step === 0) {
    return `<div class="onb">
      <div class="onb-art">${icon('wall')}</div>
      <p class="eyebrow">Tu cuaderno de escalada</p>
      <h1>Escala, apunta,<br><span class="accent">progresa.</span></h1>
      <ul class="onb-list">
        <li>${icon('wall')}<div><b>Los bloques y vías reales de tu sala</b><small>Regístralos con un toque desde la pestaña Sala.</small></div></li>
        <li>${icon('chart')}<div><b>Tu progreso de verdad</b><small>Pirámide de grados, circuitos completados y evolución.</small></div></li>
        <li>${icon('body')}<div><b>Cuida tu cuerpo</b><small>Qué zonas cargas más y avisos de sobrecarga.</small></div></li>
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
    <div class="field"><span>¿Cuántas sesiones por semana quieres hacer?</span>
      <div class="chips">${[1, 2, 3, 4, 5].map((n) => `<button class="chip ${set().weeklyGoal === n ? 'on' : ''}" data-action="set-goal" data-v="${n}">${n}</button>`).join('')}</div></div>
    <div class="field"><span>¿Qué circuito de bloque sueles escalar?</span>
      <div class="grade-grid">${scale.map((g) => `<button class="grade-pick ${set().usualCircuit === g.name ? 'on' : ''}" style="${C.gradeStyle(g.color)}" data-action="set-usual" data-v="${esc(g.name)}">${esc(g.name)}</button>`).join('')}</div></div>
    <button class="btn primary block big" data-action="onb-done">¡Vamos!</button>
  </div>`;
}

// ---------------- Diario ----------------
function viewHistory() {
  const { histTab, histFilter } = state.ui;
  const tabs = seg('hist-tab', histTab, { sessions: 'Sesiones', photos: 'Fotos' });
  if (histTab === 'photos') {
    const photos = [...state.photos.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
    return `<h1 class="page-title">Diario</h1>${tabs}
      ${photos.length ? `<div class="gallery">${photos.map((p) => `<button class="thumb" data-action="photo" data-id="${p.id}"><img src="${photoURL(p.id)}" alt="" loading="lazy"></button>`).join('')}</div>`
        : emptyState('Sin fotos todavía', 'Añade fotos de tus bloques, vías o de la sesión al registrarla.', '', 'camera')}`;
  }
  let list = I.sortSessions(state.sessions);
  if (histFilter !== 'all') list = list.filter((s) => s.type === histFilter || (s.climbs || []).some((c) => c.discipline === histFilter));
  const groups = {};
  list.forEach((s) => { const k = s.date.slice(0, 7); (groups[k] ||= []).push(s); });
  return `<h1 class="page-title">Diario</h1>${tabs}
    <div class="chips scroll">${Object.entries({ all: 'Todas', boulder: 'Bloque', route: 'Vías', training: 'Entreno' })
      .map(([k, v]) => `<button class="chip ${histFilter === k ? 'on' : ''}" data-action="hist-filter" data-v="${k}">${v}</button>`).join('')}</div>
    ${list.length ? Object.entries(groups).map(([k, ss]) => {
      const [y, m] = k.split('-').map(Number);
      const label = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      const n = ss.reduce((a, s) => a + (s.climbs || []).length, 0);
      return `<h2 class="month">${label} <span class="muted">${plural(ss.length, 'sesión', 'sesiones')} · ${plural(n, 'escalada', 'escaladas')}</span></h2><div class="list">${ss.map(sessionCard).join('')}</div>`;
    }).join('') : emptyState('Nada por aquí', 'Todavía no hay sesiones con este filtro.', '<a class="btn primary" href="#/nueva">Nueva sesión</a>', 'book')}`;
}

// ---------------- Detalle de sesión ----------------
function viewDetail(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return emptyState('Sesión no encontrada', '', '<a class="btn" href="#/diario">Volver</a>');
  const climbs = s.climbs || [];
  const photos = sessionPhotos(s.id);
  const bl = I.bodyLoad([s], set());
  const topParts = Object.entries(bl.total).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0).slice(0, 4);
  const sent = climbs.filter(M.isSent);
  const best = [...sent].sort((a, b) => M.intensity(b, set()) - M.intensity(a, set()))[0];
  const date = I.parseDate(s.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `<div class="topline"><a href="#/diario" class="back">${icon('back')} Diario</a>
      <div class="row-gap"><button class="icon-btn" data-action="share" data-id="${s.id}" aria-label="Compartir">${icon('share')}</button><a class="icon-btn" href="#/editar/${s.id}" aria-label="Editar">${icon('edit')}</a></div></div>
    <p class="eyebrow">${esc(date)}</p>
    <h1 class="page-title">${TYPE_LABEL[s.type] || 'Sesión'}${s.mood != null ? ` ${M.MOODS[s.mood]}` : ''}</h1>
    <section class="kpis">
      ${kpi(`${sent.length}/${climbs.length}`, 'encadenados')}
      ${kpi(s.duration ? fmtMin(s.duration) : '—', 'duración')}
      ${kpi(s.rpe ? `${s.rpe}/10` : '—', 'esfuerzo (RPE)')}
      ${kpi(best ? gradeChip(best) : '—', 'lo más duro', true)}
    </section>
    ${(s.activities || []).length ? `<div class="chips">${s.activities.map((a) => `<span class="chip static">${esc(M.TRAINING[a] || a)}</span>`).join('')}</div>` : ''}
    ${s.notes ? `<div class="card notes">${esc(s.notes).replace(/\n/g, '<br>')}</div>` : ''}
    ${topParts.length ? `<div class="card body-mini">${C.bodyMap(bl.total, bl.max)}<div><h3>Hoy has trabajado</h3>${topParts.map(([p, v]) => `<div class="bar-row"><span>${M.BODY_PARTS[p]}</span><div class="bar heat"><i style="width:${Math.round(v / bl.max * 100)}%"></i></div></div>`).join('')}</div></div>` : ''}
    ${climbs.length ? `<h2 class="section-title">Escaladas</h2><div class="list">${climbs.map((c) => climbRow(c, false)).join('')}</div>` : ''}
    ${photos.length ? `<h2 class="section-title">Fotos</h2><div class="gallery">${photos.map((p) => `<button class="thumb" data-action="photo" data-id="${p.id}"><img src="${photoURL(p.id)}" alt=""></button>`).join('')}</div>` : ''}
    <button class="btn danger ghost block" data-action="delete-session" data-id="${s.id}">${icon('trash')} Eliminar sesión</button>`;
}

function climbRow(c, editable) {
  const r = M.RESULTS[c.result] || M.RESULTS.send;
  const tags = M.climbTags(c);
  const pool = editable ? [...state.draft.newPhotos, ...state.photos.values()] : [...state.photos.values()];
  const photo = pool.find((p) => p.climbId === c.id && !(editable && state.draft.removedPhotos.includes(p.id)));
  const title = c.name ? esc(c.name) : (c.discipline === 'route' ? 'Vía' : 'Bloque');
  return `<div class="card climb ${M.isSent(c) ? '' : 'is-project'}" ${editable ? `data-action="edit-climb" data-id="${c.id}" role="button" tabindex="0"` : ''}>
    ${gradeChip(c)}
    <div class="climb-main">
      <div class="climb-title">${c.holdColor ? holdDot(c.holdColor, '', 'xs') : ''}${title}${c.zone ? ` <span class="muted">· ${esc(c.zone)}</span>` : ''}</div>
      <div class="climb-meta"><span class="res res-${c.result}">${r.short} ${r.label}</span>${c.attempts > 1 ? ` · ${c.attempts} intentos` : ''}${c.discipline === 'route' && c.ropeMode ? ` · ${M.ROPE_MODES[c.ropeMode]}` : ''}</div>
      ${tags.length ? `<div class="mini-tags">${tags.map((t) => `<span>${esc(M.tagLabel(t))}</span>`).join('')}</div>` : ''}
      ${c.notes ? `<p class="climb-notes">${esc(c.notes)}</p>` : ''}
    </div>
    ${photo ? `<img class="climb-thumb" src="${photoURL(photo.id)}" alt="" ${editable ? '' : `data-action="photo" data-id="${photo.id}"`}>` : (editable ? `<span class="sc-go">${icon('edit')}</span>` : '')}
  </div>`;
}

// ---------------- Editor de sesión ----------------
function newDraft() {
  return { id: uid(), isNew: true, date: I.today(), type: 'boulder', duration: 90, rpe: 6, mood: null, notes: '', climbs: [], activities: [], newPhotos: [], removedPhotos: [], startedAt: null };
}

function ensureDraft() {
  if (state.draft?.isNew) return state.draft;
  if (state.draft && !state.draft.isNew) return null;
  state.draft = state.stash || newDraft();
  state.stash = null;
  saveDraftSoon();
  return state.draft;
}

function viewEditor(editId) {
  if (editId && state.draft?.id !== editId) {
    const s = state.sessions.find((x) => x.id === editId);
    if (!s) return emptyState('Sesión no encontrada', '');
    if (state.draft?.isNew) state.stash = state.draft;
    state.draft = { activities: [], ...structuredClone(s), isNew: false, newPhotos: [], removedPhotos: [] };
  }
  if (!editId && !state.draft?.isNew) { state.draft = state.stash || newDraft(); state.stash = null; saveDraftSoon(); }
  const d = state.draft;
  const photos = [...sessionPhotos(d.id).filter((p) => !d.removedPhotos.includes(p.id) && !p.climbId), ...d.newPhotos.filter((p) => !p.climbId)];
  const sent = d.climbs.filter(M.isSent).length;
  return `<div class="topline"><button class="back" data-action="cancel-draft">${icon('back')} ${d.isNew ? 'Descartar' : 'Cancelar'}</button><span class="muted small">${d.isNew ? 'Borrador guardado' : 'Editando'}</span></div>
    <h1 class="page-title">${d.isNew ? 'Sesión de hoy' : 'Editar sesión'}</h1>
    ${d.isNew ? `<div class="card timer-card ${d.startedAt ? 'running' : ''}">
      ${icon('timer')}<div><b>${d.startedAt ? '<span data-timer></span>' : 'Cronómetro'}</b><small>${d.startedAt ? 'La duración se calcula sola al guardar' : 'Mide cuánto dura tu sesión'}</small></div>
      <button class="btn sm ${d.startedAt ? 'ghost' : 'primary'}" data-action="timer">${d.startedAt ? `${icon('stop')} Parar` : `${icon('play')} Iniciar`}</button></div>` : ''}

    <div class="add-row">
      <button class="btn tile" data-action="add-climb" data-v="boulder">${icon('boulder')}<span>Bloque</span></button>
      <button class="btn tile" data-action="add-climb" data-v="route">${icon('rope')}<span>Vía</span></button>
      <a class="btn tile accent" href="#/sala">${icon('wall')}<span>De la sala</span></a>
    </div>
    ${quickAdd(d)}
    ${d.climbs.length ? `<div class="section-head"><h2 class="section-title">Escaladas <span class="muted">${sent}/${d.climbs.length}</span></h2></div>
    <div class="list">${d.climbs.slice().reverse().map((c) => climbRow(c, true)).join('')}</div>` : '<p class="muted small center pad">Añade bloques o vías a medida que escalas. Se guarda solo.</p>'}

    <h2 class="section-title">Detalles</h2>
    <div class="card form">
      <label class="field"><span>Fecha</span><input type="date" data-field="date" value="${d.date}" max="${I.today()}"></label>
      <div class="field"><span>Tipo de sesión</span><div class="chips">${Object.entries(TYPE_LABEL).map(([k, v]) => `<button class="chip ${d.type === k ? 'on' : ''}" data-action="set-type" data-v="${k}">${v}</button>`).join('')}</div></div>
      ${d.startedAt ? '' : `<div class="field"><span>Duración <b data-out="duration">${fmtMin(d.duration || 0)}</b></span>
        <input type="range" min="15" max="240" step="15" data-field="duration" value="${d.duration || 90}"></div>`}
      <div class="field"><span>Esfuerzo percibido <b data-out="rpe">${d.rpe}/10 · ${rpeLabel(d.rpe)}</b></span>
        <input type="range" min="1" max="10" step="1" data-field="rpe" value="${d.rpe}" class="rpe"></div>
      <div class="field"><span>¿Cómo te has sentido?</span><div class="moods">${M.MOODS.map((m, i) => `<button class="mood ${d.mood === i ? 'on' : ''}" data-action="set-mood" data-v="${i}">${m}</button>`).join('')}</div></div>
      <div class="field"><span>Entreno complementario</span><div class="chips">${Object.entries(M.TRAINING).map(([k, v]) => `<button class="chip ${(d.activities || []).includes(k) ? 'on' : ''}" data-action="set-activity" data-v="${k}">${v}</button>`).join('')}</div></div>
    </div>

    <h2 class="section-title">Fotos y notas</h2>
    <div class="gallery">
      ${photos.map((p) => `<div class="thumb"><img src="${photoURL(p.id)}" alt=""><button class="x" data-action="remove-photo" data-id="${p.id}" aria-label="Quitar foto">${icon('close')}</button></div>`).join('')}
      <label class="thumb add-photo"><input type="file" accept="image/*" multiple data-upload="session" hidden>${icon('camera')}<span>Añadir</span></label>
    </div>
    <label class="field"><span>Notas</span><textarea data-field="notes" rows="3" placeholder="Cómo fue, qué aprendiste, ejercicios de entreno…">${esc(d.notes)}</textarea></label>
    <div class="save-bar"><button class="btn primary block big" data-action="save-session">${icon('check')} ${d.isNew ? 'Terminar y guardar' : 'Guardar cambios'}</button></div>`;
}

function quickAdd(d) {
  const disc = state.ui.quickDisc || (d.type === 'route' ? 'route' : 'boulder');
  const grades = disc === 'route' ? M.ROUTE_GRADES.map((g, i) => ({ i, label: g, color: M.routeColor(i) })).slice(0, 22)
    : M.boulderScale(set()).map((g, i) => ({ i, label: g.name, color: g.color, joker: g.joker }));
  const qr = state.ui.quickResult || 'send';
  return `<details class="card quick" ${state.ui.quickOpen ? 'open' : ''}><summary>${icon('bolt')} Registro rápido <span class="muted small">toca un ${disc === 'route' ? 'grado' : 'color'}</span></summary>
    <div class="quick-top">${seg('quick-disc', disc, { boulder: 'Bloque', route: 'Vía' })}</div>
    <div class="chips">${['flash', 'send', 'project'].map((r) => `<button class="chip ${qr === r ? 'on' : ''}" data-action="quick-result" data-v="${r}">${M.RESULTS[r].short} ${M.RESULTS[r].label}</button>`).join('')}</div>
    <div class="grade-grid">${grades.map((g) => `<button class="grade-pick${g.joker ? ' joker' : ''}" style="${C.gradeStyle(g.color)}" data-action="quick-add" data-disc="${disc}" data-v="${g.i}">${esc(g.label)}</button>`).join('')}</div>
  </details>`;
}

const rpeLabel = (r) => (r <= 2 ? 'muy suave' : r <= 4 ? 'suave' : r <= 6 ? 'moderado' : r <= 8 ? 'duro' : 'al límite');

// ---------------- Hoja de escalada (bloque/vía) ----------------
function openSheet(html, cls = '') {
  const dlg = $('#sheet');
  dlg.className = `sheet-dialog ${cls}`;
  dlg.innerHTML = html;
  if (!dlg.open) { dlg.showModal(); haptic(); }
}

function openClimbSheet(climb) {
  state.climb = climb;
  renderSheet();
}

function renderSheet() {
  const c = state.climb; const d = state.draft;
  const body = $('#sheet .sheet-body');
  const scroll = body?.scrollTop || 0;
  const isRoute = c.discipline === 'route';
  const grades = isRoute ? M.ROUTE_GRADES.map((g, i) => ({ i, label: g, color: M.routeColor(i) }))
    : M.boulderScale(set()).map((g, i) => ({ i, label: g.name, color: g.color, approx: g.approx, joker: g.joker }));
  const photo = d.newPhotos.find((p) => p.climbId === c.id) || [...state.photos.values()].find((p) => p.climbId === c.id && !d.removedPhotos.includes(p.id));
  const knownNames = [...new Set(state.sessions.flatMap((s) => (s.climbs || []).map((x) => x.name)).filter(Boolean))];
  const gymSectors = state.gym ? [...new Set([...state.gym.boulders, ...state.gym.routes].map((x) => x.sector))] : [];
  const zones = [...new Set([...gymSectors, ...state.sessions.flatMap((s) => (s.climbs || []).map((x) => x.zone)).filter(Boolean)])];
  const results = isRoute ? ['onsight', 'flash', 'send', 'project'] : ['flash', 'send', 'project'];
  openSheet(`<form method="dialog" class="sheet">
    <div class="grabber"></div>
    <div class="sheet-head"><button class="link" value="cancel" data-action="close-sheet">Cancelar</button><b>${c.isNew ? 'Añadir' : 'Editar'} ${isRoute ? 'vía' : 'bloque'}</b>
      ${c.isNew ? '<span></span>' : `<button class="link danger" data-action="delete-climb" type="button">Borrar</button>`}</div>
    <div class="sheet-body">
      ${c.vlId ? `<div class="from-gym">${holdDot(c.holdColor, c.vlNumber)}<div><b>De la sala</b><small>${esc(c.zone)} · presa ${esc(S.holdName(c.holdName))}</small></div></div>`
        : `<div class="seg">${['boulder', 'route'].map((k) => `<button type="button" class="${c.discipline === k ? 'on' : ''}" data-action="cd-disc" data-v="${k}">${k === 'route' ? 'Vía' : 'Bloque'}</button>`).join('')}</div>`}
      <div class="field"><span>${isRoute ? 'Grado' : 'Circuito'} ${!isRoute && grades[c.grade]?.approx ? `<b class="muted">${esc(grades[c.grade].approx)}</b>` : ''}</span>
        <div class="grade-grid">${grades.map((g) => `<button type="button" class="grade-pick ${c.grade === g.i ? 'on' : ''}${g.joker ? ' joker' : ''}" style="${C.gradeStyle(g.color)}" data-action="cd-grade" data-v="${g.i}">${esc(g.label)}</button>`).join('')}</div></div>
      <div class="field"><span>Resultado</span><div class="chips">${results.map((r) => `<button type="button" class="chip ${c.result === r ? 'on' : ''}" data-action="cd-result" data-v="${r}" title="${M.RESULTS[r].desc}">${M.RESULTS[r].short} ${M.RESULTS[r].label}</button>`).join('')}</div></div>
      <div class="field inline"><span>Intentos</span><div class="stepper"><button type="button" data-action="cd-att" data-v="-1" aria-label="Menos">−</button><b>${c.attempts}</b><button type="button" data-action="cd-att" data-v="1" aria-label="Más">＋</button></div></div>
      ${isRoute ? `<div class="field"><span>Modalidad</span><div class="chips">${Object.entries(M.ROPE_MODES).map(([k, v]) => `<button type="button" class="chip ${c.ropeMode === k ? 'on' : ''}" data-action="cd-rope" data-v="${k}">${v}</button>`).join('')}</div></div>` : ''}
      ${Object.entries(M.TAGS).map(([group, g]) => `<div class="field"><span>${g.label}</span><div class="chips">${Object.entries(g.items).map(([k, v]) =>
        `<button type="button" class="chip ${(c[group] || []).includes(k) ? 'on' : ''}" data-action="cd-tag" data-group="${group}" data-v="${k}">${v}</button>`).join('')}</div></div>`).join('')}
      <label class="field"><span>Nombre <small class="muted">para seguir proyectos</small></span><input data-cfield="name" list="names" value="${esc(c.name)}" placeholder="p. ej. «El rosa del desplome»"><datalist id="names">${knownNames.map((n) => `<option value="${esc(n)}">`).join('')}</datalist></label>
      <label class="field"><span>Sector</span><input data-cfield="zone" list="zones" value="${esc(c.zone)}" placeholder="p. ej. Cueva y Slab, Tótem…"><datalist id="zones">${zones.map((n) => `<option value="${esc(n)}">`).join('')}</datalist></label>
      <label class="field"><span>Notas / beta</span><textarea data-cfield="notes" rows="2" placeholder="Truco del paso clave, pies, sensaciones…">${esc(c.notes)}</textarea></label>
      <div class="field"><span>Foto</span>
        ${photo ? `<div class="thumb wide"><img src="${photoURL(photo.id)}" alt=""><button type="button" class="x" data-action="remove-photo" data-id="${photo.id}" aria-label="Quitar">${icon('close')}</button></div>`
          : `<label class="btn ghost"><input type="file" accept="image/*" data-upload="climb" hidden>${icon('camera')} Añadir foto</label>`}
      </div>
    </div>
    <div class="sheet-foot">
      ${c.isNew && !c.vlId ? '<button type="button" class="btn ghost" data-action="save-climb" data-again="1">Guardar y otro</button>' : ''}
      <button type="button" class="btn primary" data-action="save-climb">${c.isNew ? 'Añadir' : 'Guardar'}</button>
    </div></form>`);
  const nb = $('#sheet .sheet-body'); if (nb) nb.scrollTop = scroll;
}

function newClimb(discipline, from) {
  const scaleLen = discipline === 'route' ? M.ROUTE_GRADES.length : M.boulderScale(set()).length;
  const lastSame = [...(state.draft?.climbs || [])].reverse().find((c) => c.discipline === discipline);
  const usual = M.boulderIndexByName(set(), set().usualCircuit);
  return {
    id: uid(), isNew: true, discipline,
    grade: from?.grade ?? lastSame?.grade ?? (discipline === 'route' ? 11 : (usual >= 0 ? usual : Math.min(2, scaleLen - 1))),
    result: 'send', attempts: 1, ropeMode: discipline === 'route' ? (lastSame?.ropeMode || 'toprope') : undefined,
    styles: [], holds: [], moves: [], name: '', zone: from?.zone ?? lastSame?.zone ?? '', notes: '',
  };
}

// ---------------- Sala ----------------
function climbFromGym(item) {
  const isRoute = item.kind === 'route';
  let grade = isRoute ? M.ROUTE_GRADES.indexOf(item.grade) : M.boulderIndexByName(set(), item.grade);
  if (grade < 0) grade = isRoute ? 11 : 2;
  return {
    ...newClimb(isRoute ? 'route' : 'boulder', { grade, zone: item.sector }),
    grade, zone: item.sector, vlId: item.vlId, vlNumber: item.number, holdColor: item.holdColor, holdName: item.hold,
    name: `${item.sector} ${item.number}`,
  };
}

function myLog() {
  const map = new Map();
  const rank = { flash: 3, onsight: 4, send: 2, project: 1 };
  const add = (c, date) => {
    if (!c.vlId) return;
    const cur = map.get(c.vlId) || { best: null, tries: 0, sessions: 0, last: null };
    cur.tries += c.attempts || 1; cur.sessions++;
    if (!cur.best || rank[c.result] > rank[cur.best]) cur.best = c.result;
    if (!cur.last || date > cur.last) cur.last = date;
    map.set(c.vlId, cur);
  };
  for (const s of state.sessions) for (const c of s.climbs || []) add(c, s.date);
  if (state.draft?.isNew) for (const c of state.draft.climbs) add(c, state.draft.date);
  return map;
}

function circuitProgress(g) {
  const log = myLog();
  return M.boulderScale(set()).map((c) => {
    const items = g.boulders.filter((b) => b.grade === c.name);
    return { name: c.name, color: c.color, total: items.length, done: items.filter((b) => M.RESULTS[log.get(b.vlId)?.best]?.sent).length };
  });
}

const ROUTE_BANDS = { all: 'Todas', 'b4': '4–5', 'b6a': '6a–6b+', 'b6c': '6c–7a+', 'b7b': '7b y más' };
const bandOf = (g) => { const i = M.ROUTE_GRADES.indexOf(g); return i < 9 ? 'b4' : i < 13 ? 'b6a' : i < 17 ? 'b6c' : 'b7b'; };

function viewGym() {
  const g = state.gym; const ui = state.ui;
  const head = `<div class="gym-hero">
      <p class="eyebrow">Tu rocódromo</p>
      <h1>${esc(S.GYM.name)}</h1>
      <p class="gym-addr">${icon('pin')} ${esc(S.GYM.address)}</p>
      <p class="gym-addr">${icon('metro')} ${esc(S.GYM.transport[0].text)}</p>
      <div class="gym-links">
        <a class="pill" href="${S.GYM.links.maps}" target="_blank" rel="noopener">${icon('map')} Cómo llegar</a>
        <a class="pill" href="${S.GYM.links.hours}" target="_blank" rel="noopener">${icon('clock')} Horarios</a>
        <a class="pill" href="${S.GYM.links.web}" target="_blank" rel="noopener">${icon('external')} Web</a>
      </div>
    </div>`;
  if (!g && state.gymLoading) return `${head}<div class="skeleton-list">${'<div class="skel"></div>'.repeat(6)}</div>`;
  if (!g || (!g.boulders.length && !g.routes.length)) {
    return `${head}${emptyState('No se pudo cargar la sala', set().liveGym === false ? 'Has desactivado los datos de la sala en Ajustes.' : 'Comprueba tu conexión e inténtalo de nuevo.', `<button class="btn primary" data-action="gym-refresh">${icon('refresh')} Reintentar</button>`)}`;
  }
  const disc = ui.gymDisc;
  const items = disc === 'route' ? g.routes : g.boulders;
  const log = myLog();
  const sectors = [...new Set(items.map((x) => x.sector))];
  if (ui.gymSector !== 'all' && !sectors.includes(ui.gymSector)) ui.gymSector = 'all';
  const q = ui.gymQuery.trim().toLowerCase();
  const filtered = items.filter((x) => {
    if (ui.gymSector !== 'all' && x.sector !== ui.gymSector) return false;
    if (disc === 'boulder' && ui.gymCircuit !== 'all' && x.grade !== ui.gymCircuit) return false;
    if (disc === 'route' && ui.gymCircuit !== 'all' && bandOf(x.grade) !== ui.gymCircuit) return false;
    const st = log.get(x.vlId);
    if (ui.gymFilter === 'new' && Date.now() - x.date > 7 * 86400000) return false;
    if (ui.gymFilter === 'todo' && M.RESULTS[st?.best]?.sent) return false;
    if (ui.gymFilter === 'done' && !M.RESULTS[st?.best]?.sent) return false;
    if (q && !`${x.number} ${x.sector} ${x.grade} ${x.hold} ${S.holdName(x.hold)} ${x.setter}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const groups = {};
  filtered.sort((a, b) => a.sector.localeCompare(b.sector) || a.number.localeCompare(b.number, undefined, { numeric: true }))
    .forEach((x) => (groups[x.sector] ||= []).push(x));
  const scale = M.boulderScale(set());
  const counts = {}; items.forEach((x) => { counts[x.grade] = (counts[x.grade] || 0) + 1; });
  const prog = disc === 'boulder' ? circuitProgress(g).filter((c) => c.total) : [];
  const fresh = items.filter((x) => Date.now() - x.date < 7 * 86400000).length;
  const sentHere = items.filter((x) => M.RESULTS[log.get(x.vlId)?.best]?.sent).length;
  const updated = g.fetchedAt ? `Actualizado ${ago(g.fetchedAt) === 'hoy' ? new Date(g.fetchedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : ago(g.fetchedAt)}` : '';
  const sectorMeta = Object.fromEntries(items.map((x) => [x.sector, x.sectorId]));
  return `${head}
    ${seg('gym-disc', disc, { boulder: `Bloques <small>${g.boulders.length}</small>`, route: `Vías <small>${g.routes.length}</small>` })}
    <section class="kpis three">
      ${kpi(items.length, disc === 'route' ? 'vías montadas' : 'bloques montados')}
      ${kpi(fresh, 'nuevos esta semana')}
      ${kpi(`${sentHere}`, 'ya encadenados')}
    </section>
    ${prog.length ? `<div class="card"><h3>${icon('trophy')} Tus circuitos actuales</h3><div class="circuits">${prog.map((p) => `<button class="circ ${ui.gymCircuit === p.name ? 'on' : ''}" data-action="gym-circuit" data-v="${esc(p.name)}">
        <span class="grade sm${scale.find((s) => s.name === p.name)?.joker ? ' joker' : ''}" style="${C.gradeStyle(p.color)}">${esc(p.name)}</span>
        <div class="bar"><i style="width:${Math.round(p.done / p.total * 100)}%;background:${p.color}"></i></div><small>${p.done}/${p.total}</small></button>`).join('')}</div></div>` : ''}
    <div class="search">${icon('search')}<input type="search" data-gym-query value="${esc(ui.gymQuery)}" placeholder="Buscar número, sector, color…" aria-label="Buscar"></div>
    <div class="chips scroll">${Object.entries({ all: 'Todos', new: 'Nuevos', todo: 'Pendientes', done: 'Hechos' }).map(([k, v]) => `<button class="chip ${ui.gymFilter === k ? 'on' : ''}" data-action="gym-filter" data-v="${k}">${v}</button>`).join('')}</div>
    <div class="chips scroll">${disc === 'boulder'
      ? `<button class="chip ${ui.gymCircuit === 'all' ? 'on' : ''}" data-action="gym-circuit" data-v="all">Todos los circuitos</button>${scale.filter((s) => counts[s.name]).map((s) => `<button class="chip dotchip ${ui.gymCircuit === s.name ? 'on' : ''}" data-action="gym-circuit" data-v="${esc(s.name)}"><i style="background:${s.color}"></i>${esc(s.name)}</button>`).join('')}`
      : Object.entries(ROUTE_BANDS).map(([k, v]) => `<button class="chip ${ui.gymCircuit === k ? 'on' : ''}" data-action="gym-circuit" data-v="${k}">${v}</button>`).join('')}</div>
    <div class="chips scroll">
      <button class="chip ${ui.gymMap ? 'on' : ''}" data-action="gym-map">${icon('map')} Mapa</button>
      <button class="chip ${ui.gymSector === 'all' ? 'on' : ''}" data-action="gym-sector" data-v="all">Todos los sectores</button>${sectors.map((s) => `<button class="chip ${ui.gymSector === s ? 'on' : ''}" data-action="gym-sector" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    ${ui.gymMap ? gymMapCard(sectors.map((name) => ({ name, id: sectorMeta[name] }))) : ''}
    ${Object.keys(groups).length ? Object.entries(groups).map(([sector, list]) => `<h2 class="month">${esc(sector)} <span class="muted">${list.length}</span></h2>
      <div class="gym-grid">${list.map((x) => gymItem(x, log.get(x.vlId))).join('')}</div>`).join('')
      : emptyState('Nada con estos filtros', 'Prueba a quitar algún filtro.', `<button class="btn ghost" data-action="gym-clear">Quitar filtros</button>`, 'search')}
    <p class="muted small center src">${updated}${g.offline ? ' · sin conexión' : ''} · Datos publicados por la sala en Vertical-Life
      <button class="link" data-action="gym-refresh">${icon('refresh')} Actualizar</button></p>`;
}

function gymItem(x, st) {
  const isNew = Date.now() - x.date < 7 * 86400000;
  const res = st?.best ? M.RESULTS[st.best] : null;
  const fake = { discipline: x.kind === 'route' ? 'route' : 'boulder', grade: x.kind === 'route' ? M.ROUTE_GRADES.indexOf(x.grade) : M.boulderIndexByName(set(), x.grade) };
  const color = fake.grade >= 0 ? M.gradeColor(fake, set()) : '#999';
  return `<button class="gym-item ${res?.sent ? 'done' : st ? 'tried' : ''}" data-action="gym-open" data-id="${esc(x.vlId)}">
    ${holdDot(x.holdColor, x.number)}
    <div class="gi-main"><span class="grade xs" style="${C.gradeStyle(color)}">${esc(x.grade)}</span>
      <small>${isNew ? '<em class="new">NUEVO</em> ' : ''}${esc(S.holdName(x.hold))} · ${ago(x.date)}</small></div>
    ${res ? `<span class="gi-st res-${st.best}" title="${res.label}">${res.sent ? icon(st.best === 'flash' || st.best === 'onsight' ? 'bolt' : 'check') : '…'}</span>` : ''}
  </button>`;
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
    ${withTopo.length ? S.sectorMapHTML(withTopo, activeId) : '<div class="skel tall"></div>'}
    <p class="muted small">Toca un sector del plano para filtrarlo.</p></div>`;
}

async function openGymItem(vlId) {
  const g = state.gym; if (!g) return;
  const x = [...g.boulders, ...g.routes].find((i) => i.vlId === vlId); if (!x) return;
  const st = myLog().get(vlId);
  const isRoute = x.kind === 'route';
  const fake = climbFromGym(x);
  const draw = (detail) => `<div class="sheet">
    <div class="grabber"></div>
    <div class="sheet-head"><span></span><b>${isRoute ? 'Vía' : 'Bloque'} ${esc(x.number)}</b><button class="link" data-action="close-sheet" type="button">Cerrar</button></div>
    <div class="sheet-body">
      <div class="gd-head">${holdDot(x.holdColor, x.number, 'lg')}
        <div><div class="gd-title">${gradeChip(fake)} <span>${esc(x.sector)}</span></div>
        <small class="muted">Presa ${esc(S.holdName(x.hold)).toLowerCase()} · abierto ${ago(x.date)}${detail?.expires ? ` · se desmonta ~${esc(detail.expires)}` : ''}</small>
        ${detail?.stars ? `<div class="stars">${icon('star').repeat(detail.stars)}</div>` : ''}</div></div>
      ${detail === undefined ? '<div class="skel tall"></div>' : detail?.wall ? S.topoHTML(detail.wall, x.holdColor, { label: 'Zona del bloque en el muro' }) : ''}
      ${detail?.map ? S.topoHTML(detail.map, '#ff6b35', { cls: 'small', label: `Sector ${x.sector} en la sala` }) : ''}
      ${st ? `<div class="card soft"><b>Tu historial</b><p class="muted small">${M.RESULTS[st.best].short} ${M.RESULTS[st.best].label} · ${plural(st.tries, 'intento', 'intentos')} en ${plural(st.sessions, 'sesión', 'sesiones')}${st.last ? ` · último ${I.fmtDate(st.last)}` : ''}</p></div>` : ''}
      ${x.setter ? `<p class="muted small">Equipado por ${esc(x.setter)}</p>` : ''}
    </div>
    <div class="sheet-foot col">
      <div class="log-btns">
        <button type="button" class="btn log flash" data-action="gym-log" data-id="${esc(x.vlId)}" data-v="${isRoute ? 'onsight' : 'flash'}">${icon(isRoute ? 'eye' : 'bolt')}<span>${isRoute ? 'A vista' : 'Flash'}</span></button>
        <button type="button" class="btn log send" data-action="gym-log" data-id="${esc(x.vlId)}" data-v="send">${icon('check')}<span>Encadenado</span></button>
        <button type="button" class="btn log proj" data-action="gym-log" data-id="${esc(x.vlId)}" data-v="project">${icon('flag')}<span>Proyecto</span></button>
      </div>
      <button type="button" class="btn ghost block" data-action="gym-log-more" data-id="${esc(x.vlId)}">Registrar con más detalles</button>
    </div></div>`;
  openSheet(draw(undefined), 'gym-sheet');
  let detail = null;
  try { detail = await S.getDetail(x); } catch { detail = null; }
  if ($('#sheet').open && $('#sheet').classList.contains('gym-sheet') && $('#sheet [data-action=gym-log]')?.dataset.id === vlId) {
    const scroll = $('#sheet .sheet-body')?.scrollTop || 0;
    $('#sheet').innerHTML = draw(detail);
    $('#sheet .sheet-body').scrollTop = scroll;
  }
}

// ---------------- Progreso ----------------
function viewProgress() {
  const tab = state.ui.progTab;
  const tabs = seg('prog-tab', tab, { grados: 'Grados', cuerpo: 'Cuerpo', logros: 'Logros' });
  const s = state.sessions;
  if (!s.length) return `<h1 class="page-title">Progreso</h1>${tabs}${emptyState('Aún no hay datos', 'Registra sesiones y aquí verás tu evolución, tu pirámide, tu carga corporal y tus logros.', '<a class="btn primary" href="#/nueva">Empezar sesión</a>', 'chart')}`;
  const body = tab === 'cuerpo' ? progBody() : tab === 'logros' ? progAchievements() : progGrades();
  return `<h1 class="page-title">Progreso</h1>${tabs}${body}`;
}

function progGrades() {
  const s = state.sessions;
  const disc = state.ui.progDisc;
  const label = (g) => M.gradeLabel({ discipline: disc, grade: Math.round(g) }, set());
  const color = (g) => M.gradeColor({ discipline: disc, grade: g }, set());
  const st = I.summary(s, set());
  const climbs = I.allClimbs(s).filter((c) => c.discipline === disc);
  const sentN = climbs.filter(M.isSent).length;
  const best = disc === 'route' ? st.bestRoute : st.bestBoulder;
  const bestF = disc === 'route' ? st.bestFlashRoute : st.bestFlashBoulder;
  const projects = I.openProjects(s, set());
  const done = I.sentProjects(s);
  const tags = I.tagStats(s.map((x) => ({ ...x, climbs: (x.climbs || []).filter((c) => c.discipline === disc) })));
  return `${seg('prog-disc', disc, { boulder: 'Bloque', route: 'Vías' })}
    <section class="kpis">
      ${kpi(best ? gradeChip(best) : '—', 'máximo encadenado', true)}
      ${kpi(bestF ? gradeChip(bestF) : '—', disc === 'route' ? 'máx. flash / a vista' : 'máximo flash', true)}
      ${kpi(sentN, 'encadenados')}
      ${kpi(climbs.length ? `${Math.round(sentN / climbs.length * 100)}%` : '—', 'tasa de éxito')}
    </section>
    <div class="card"><h3>Evolución <small class="muted">últimas 12 semanas</small></h3>${C.progressChart(I.weeklyProgress(s, disc), label)}</div>
    <div class="card"><h3>Pirámide</h3>${C.pyramidChart(I.pyramid(s, disc, set()), label, color)}</div>
    <div class="card"><h3>Volumen semanal</h3>${C.volumeChart(I.weeklyVolume(s))}</div>
    <div class="card"><h3>Calendario</h3><div class="scroll-x">${C.calendarHeatmap(s)}</div></div>
    <div class="card"><h3>Estilos: pruebas vs. encadenas</h3>
      ${tags.length ? tags.slice(0, 10).map((t) => `<div class="bar-row wide"><span>${esc(t.label)}</span><div class="bar"><i style="width:${Math.round(t.rate * 100)}%"></i></div><small>${t.sent}/${t.total}</small></div>`).join('')
        : '<p class="muted small">Etiqueta tus escaladas (desplome, regletas, dinámico…) para descubrir tus puntos fuertes y débiles.</p>'}
    </div>
    <div class="card"><h3>${icon('flag')} Proyectos abiertos</h3>
      ${projects.length ? projects.map((p) => `<div class="proj">${gradeChip(p)}<div><b>${esc(p.name)}</b><small class="muted">${plural(p.sessions, 'sesión', 'sesiones')} · ${p.attemptsTotal} intentos · último ${I.fmtDate(p.lastTried)}</small></div></div>`).join('')
        : '<p class="muted small">Marca algo como «Proyecto» (o regístralo desde la Sala) para seguirlo entre sesiones.</p>'}
      ${done.length ? `<h4>${icon('check')} Proyectos encadenados</h4>${done.slice(0, 5).map((p) => `<div class="proj">${gradeChip(p)}<div><b>${esc(p.name)}</b><small class="muted">${I.fmtDate(p.date)} · tras ${p.sessionsTried} sesiones</small></div></div>`).join('')}` : ''}
    </div>`;
}

const BODY_TIPS = {
  dedos: 'Calienta de menos a más en presas grandes antes de apretar regletas y deja ~48 h entre sesiones intensas de dedos. Si notas dolor en la base del dedo, para.',
  antebrazos: 'Estira flexores y compensa con extensores (goma elástica, 2–3 series de 15). Sacude y respira en los reposos.',
  biceps: 'Trabaja también la extensión (fondos, flexiones) para equilibrar tracción y empuje.',
  hombros: 'Fortalece el manguito rotador y las escápulas: rotaciones externas con goma, Y-T-W, face pulls.',
  espalda: 'Compensa la tracción con empuje (flexiones, press) y movilidad torácica.',
  core: 'Mantén la tensión en desplome: hollow body, elevaciones de piernas colgada, plancha.',
  cadera: 'Movilidad de cadera (rana, 90/90, mariposa) para meter la cadera a la pared y talonar mejor.',
  piernas: 'Buena señal: escalar con pies ahorra brazos. Trabaja precisión de pies y movilidad de tobillo.',
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
      <div class="card"><h3>Reparto del esfuerzo</h3>${parts.map(([p, v]) => `<div class="bar-row wide"><span>${M.BODY_PARTS[p]}</span><div class="bar heat"><i style="width:${Math.round(v / bl.max * 100)}%"></i></div><small>${Math.round(v / bl.sum * 100)}%</small></div>`).join('')}</div>
      <h2 class="section-title">Consejos para tus zonas más cargadas</h2>
      <div class="insights">${parts.slice(0, 3).map(([p]) => `<div class="insight info"><div class="ins-icon">${BODY_EMOJI[p]}</div><div><b>${M.BODY_PARTS[p]}</b><p>${BODY_TIPS[p]}</p></div></div>`).join('')}</div>
      <p class="muted small note">${icon('info', 'inline')} Estimación orientativa a partir del grado, los intentos y las etiquetas de cada escalada (inclinación, presas, movimientos). Cuanto más etiquetes, más fiel será. No sustituye la opinión de un fisio.</p>`
      : emptyState('Sin datos en este periodo', 'Registra escaladas y etiqueta su estilo (desplome, regletas, talonamientos…) para ver qué partes del cuerpo trabajas más.', '<a class="btn primary" href="#/nueva">Empezar sesión</a>', 'body')}`;
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
      <div class="field"><span>Objetivo semanal</span><div class="chips">${[1, 2, 3, 4, 5, 6].map((n) => `<button class="chip ${st.weeklyGoal === n ? 'on' : ''}" data-action="set-goal" data-v="${n}">${plural(n, 'sesión', 'sesiones')}</button>`).join('')}</div></div>
      <div class="field"><span>Tema</span>${seg('theme', st.theme || 'auto', { auto: 'Automático', light: 'Claro', dark: 'Oscuro' })}</div>
      <label class="switch"><span><b>Datos de la sala en directo</b><small class="muted">Bloques y vías actuales de ${esc(S.GYM.name)} (Vertical-Life)</small></span><input type="checkbox" data-toggle="liveGym" ${st.liveGym !== false ? 'checked' : ''}><i></i></label>
    </div>
    <div class="card">
      <h3>Circuitos de bloque</h3>
      <p class="muted small">Por defecto, los circuitos de ${esc(S.GYM.name)} de más fácil a más difícil. Puedes añadir el grado aproximado de cada uno (p. ej. «6a–6b») o adaptarlos a otra sala.</p>
      <div class="scale-editor">${scale.map((g, i) => `<div class="scale-row">
        <input type="color" value="${toHex(g.color)}" data-scale="${i}" data-k="color" aria-label="Color">
        <input value="${esc(g.name)}" data-scale="${i}" data-k="name" aria-label="Nombre">
        <input value="${esc(g.approx)}" data-scale="${i}" data-k="approx" placeholder="≈ grado" aria-label="Grado aproximado">
        <button class="icon-btn" data-action="scale-up" data-i="${i}" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-btn" data-action="scale-del" data-i="${i}" aria-label="Eliminar">${icon('close')}</button></div>`).join('')}</div>
      <div class="row-gap wrap"><button class="btn ghost sm" data-action="scale-add">＋ Añadir</button>
        <button class="btn ghost sm" data-action="scale-preset" data-v="sharma">Circuitos Sharma</button>
        <button class="btn ghost sm" data-action="scale-preset" data-v="font">Grados Font</button></div>
      <p class="muted small">Cambiar el número u orden de circuitos afecta a cómo se muestran las escaladas ya registradas.</p>
    </div>
    <div class="card">
      <h3>Tus datos</h3>
      <p class="muted small">Todo se guarda solo en este dispositivo. Haz copias de vez en cuando (incluyen las fotos); sirven también para pasar tus datos a otro móvil.</p>
      <div class="stack">
        <button class="btn" data-action="export">${icon('download')} Descargar copia de seguridad</button>
        <label class="btn ghost"><input type="file" accept="application/json,.json" data-upload="import" hidden>${icon('upload')} Restaurar copia</label>
        ${demoCount ? `<button class="btn ghost" data-action="demo-clear">Quitar datos de ejemplo (${demoCount})</button>` : '<button class="btn ghost" data-action="demo">Cargar datos de ejemplo</button>'}
        <button class="btn danger ghost" data-action="wipe">${icon('trash')} Borrar todos los datos</button>
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
  if (d.isNew && !d.climbs.length && !d.notes && !d.newPhotos.length && !(d.activities || []).length) {
    toast('Añade al menos una escalada, una nota o una foto'); return;
  }
  const { isNew, newPhotos, removedPhotos, startedAt, ...session } = d;
  if (startedAt) session.duration = Math.max(5, Math.round((Date.now() - startedAt) / 60000 / 5) * 5);
  session.createdAt ||= Date.now();
  session.updatedAt = Date.now();
  session.climbs = session.climbs.map(({ isNew: _, ...c }) => c);
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
  haptic([10, 40, 10]);
  if (isNew) celebrate();
  toast(isNew ? '¡Sesión guardada! 💪' : 'Cambios guardados');
  go(`#/sesion/${session.id}`);
}

async function addPhotos(files, climbId) {
  const d = state.draft;
  for (const f of files) {
    const blob = await compressImage(f);
    d.newPhotos.push({ id: uid(), blob, climbId: climbId || null, createdAt: Date.now() });
  }
  saveDraftSoon();
}

function addClimbToDraft(c, message) {
  const d = ensureDraft();
  if (!d) { toast('Termina primero de editar la sesión abierta'); return false; }
  const { isNew, ...clean } = c;
  d.climbs.push(clean);
  saveDraftSoon();
  haptic(12);
  toast(message || `${M.gradeLabel(c, set())} · ${M.RESULTS[c.result].label} añadido`, { label: 'Ver sesión', href: '#/nueva' });
  return true;
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
    state.settings = { ...state.settings, ...incoming, key: 'settings', dataVersion: 2, onboarded: true };
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

// ---------------- Eventos ----------------
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
  async wipe() {
    if (!confirm('¿Seguro? Se borrarán todas las sesiones y fotos de este dispositivo. Esto no se puede deshacer.')) return;
    await Promise.all([db.clear('sessions'), db.clear('photos')]);
    state.draft = null; state.stash = null;
    await db.del('settings', 'draft');
    state.sessions = []; state.photos.clear();
    toast('Datos borrados');
    go('#/inicio');
  },
  'onb-next'() { state.ui.onb = 1; render({ transition: true }); },
  async 'onb-done'() { state.settings.onboarded = true; await saveSettings(); state.ui.onb = 0; render({ transition: true }); },
  async 'set-goal'(el) { state.settings.weeklyGoal = Number(el.dataset.v); await saveSettings(); rerender(); },
  async 'set-usual'(el) { state.settings.usualCircuit = el.dataset.v; await saveSettings(); rerender(); },
  async install() { const e = state.installEvt; if (!e) return; e.prompt(); await e.userChoice.catch(() => {}); state.installEvt = null; rerender(); },
  async 'install-dismiss'() { state.settings.installDismissed = true; await saveSettings(); rerender(); },
  'start-session'() { const d = ensureDraft(); if (d && !d.startedAt && !d.climbs.length) { d.startedAt = Date.now(); saveDraftSoon(); } },
  export: exportData,
  'hist-tab'(el) { state.ui.histTab = el.dataset.v || el.dataset.tab; if (location.hash === '#/diario') rerender(); },
  'hist-filter'(el) { state.ui.histFilter = el.dataset.v; rerender(); },
  'prog-tab'(el) { state.ui.progTab = el.dataset.v; if (location.hash === '#/progreso') rerender(); },
  'prog-disc'(el) { state.ui.progDisc = el.dataset.v; rerender(); },
  'body-range'(el) { state.ui.bodyRange = el.dataset.v; rerender(); },
  async theme(el) { state.settings.theme = el.dataset.v === 'auto' ? undefined : el.dataset.v; applyTheme(); await saveSettings(); rerender(); },
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
    go(back);
  },
  timer() {
    const d = state.draft;
    if (d.startedAt) { d.duration = Math.max(5, Math.round((Date.now() - d.startedAt) / 60000 / 5) * 5); d.startedAt = null; toast(`Cronómetro parado: ${fmtMin(d.duration)}`); }
    else { d.startedAt = Date.now(); toast('¡A escalar! ⏱'); }
    saveDraftSoon(); rerender();
  },
  'set-type'(el) { state.draft.type = el.dataset.v; saveDraftSoon(); rerender(); },
  'set-mood'(el) { const v = Number(el.dataset.v); state.draft.mood = state.draft.mood === v ? null : v; saveDraftSoon(); rerender(); },
  'set-activity'(el) {
    const a = state.draft.activities ||= []; const i = a.indexOf(el.dataset.v);
    if (i >= 0) a.splice(i, 1); else a.push(el.dataset.v);
    saveDraftSoon(); rerender();
  },
  'add-climb'(el) { openClimbSheet(newClimb(el.dataset.v)); },
  'edit-climb'(el) { const c = state.draft.climbs.find((x) => x.id === el.dataset.id); if (c) openClimbSheet({ ...structuredClone(c), isNew: false }); },
  'quick-result'(el) { state.ui.quickResult = el.dataset.v; state.ui.quickOpen = true; rerender(); },
  'quick-disc'(el) { state.ui.quickDisc = el.dataset.v; state.ui.quickOpen = true; rerender(); },
  'quick-add'(el) {
    const c = newClimb(el.dataset.disc, { grade: Number(el.dataset.v) });
    c.result = state.ui.quickResult || 'send';
    if (c.result === 'project') c.attempts = 3;
    else if (c.result === 'send') c.attempts = 2;
    state.ui.quickOpen = true;
    addClimbToDraft(c);
    rerender();
  },
  async 'remove-photo'(el) {
    const id = el.dataset.id; const d = state.draft;
    const i = d.newPhotos.findIndex((p) => p.id === id);
    if (i >= 0) d.newPhotos.splice(i, 1); else d.removedPhotos.push(id);
    saveDraftSoon();
    if ($('#sheet').open) renderSheet(); else rerender();
  },
  'save-session': saveSession,
  'close-sheet'(el, e) {
    e.preventDefault();
    if (state.climb?.isNew && state.draft) state.draft.newPhotos = state.draft.newPhotos.filter((p) => p.climbId !== state.climb.id);
    closeSheet();
  },
  'cd-disc'(el) {
    const c = state.climb; if (c.discipline === el.dataset.v) return;
    const fresh = newClimb(el.dataset.v);
    Object.assign(c, { discipline: el.dataset.v, grade: fresh.grade, ropeMode: fresh.ropeMode, result: c.result === 'onsight' ? 'flash' : c.result });
    renderSheet();
  },
  'cd-grade'(el) { state.climb.grade = Number(el.dataset.v); haptic(); renderSheet(); },
  'cd-result'(el) {
    const c = state.climb; c.result = el.dataset.v;
    if (c.result === 'flash' || c.result === 'onsight') c.attempts = 1;
    else if (c.attempts === 1 && c.result === 'send') c.attempts = 2;
    haptic(); renderSheet();
  },
  'cd-att'(el) {
    const c = state.climb; c.attempts = Math.max(1, Math.min(99, c.attempts + Number(el.dataset.v)));
    if (c.attempts > 1 && (c.result === 'flash' || c.result === 'onsight')) c.result = 'send';
    haptic(); renderSheet();
  },
  'cd-rope'(el) { state.climb.ropeMode = el.dataset.v; renderSheet(); },
  'cd-tag'(el) {
    const arr = state.climb[el.dataset.group] ||= [];
    const i = arr.indexOf(el.dataset.v);
    if (i >= 0) arr.splice(i, 1); else arr.push(el.dataset.v);
    haptic(); renderSheet();
  },
  'save-climb'(el) {
    const c = state.climb;
    const d = ensureDraft() || state.draft;
    const { isNew, ...clean } = c;
    const i = d.climbs.findIndex((x) => x.id === c.id);
    if (i >= 0) d.climbs[i] = clean; else d.climbs.push(clean);
    saveDraftSoon(); haptic(12);
    if (el.dataset.again) {
      toast(`${M.gradeLabel(c, set())} añadido`);
      openClimbSheet(newClimb(c.discipline, { grade: c.grade, zone: c.zone }));
    } else {
      closeSheet();
      if (c.vlId && isNew) toast('Añadido a tu sesión de hoy', { label: 'Ver', href: '#/nueva' });
    }
    rerender();
  },
  'delete-climb'() {
    const d = state.draft; const c = state.climb;
    d.climbs = d.climbs.filter((x) => x.id !== c.id);
    d.newPhotos = d.newPhotos.filter((p) => p.climbId !== c.id);
    saveDraftSoon();
    closeSheet(); rerender();
  },
  // Sala
  'gym-disc'(el) { state.ui.gymDisc = el.dataset.v; state.ui.gymCircuit = 'all'; state.ui.gymSector = 'all'; rerender(); },
  'gym-filter'(el) { state.ui.gymFilter = el.dataset.v; rerender(); },
  'gym-filter-new'() { state.ui.gymFilter = 'new'; },
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
  'gym-clear'() { Object.assign(state.ui, { gymSector: 'all', gymCircuit: 'all', gymFilter: 'all', gymQuery: '' }); rerender(); },
  'gym-refresh'() { loadGym(true); toast('Actualizando la sala…'); },
  'gym-open'(el) { openGymItem(el.dataset.id); },
  'gym-log'(el) {
    const x = [...state.gym.boulders, ...state.gym.routes].find((i) => i.vlId === el.dataset.id); if (!x) return;
    const c = climbFromGym(x);
    c.result = el.dataset.v;
    c.attempts = c.result === 'project' ? 3 : c.result === 'send' ? 2 : 1;
    if (addClimbToDraft(c, `${x.number} · ${M.RESULTS[c.result].label} ✓`)) { closeSheet(); rerender(); }
  },
  'gym-log-more'(el) {
    const x = [...state.gym.boulders, ...state.gym.routes].find((i) => i.vlId === el.dataset.id); if (!x) return;
    if (!ensureDraft()) { toast('Termina primero de editar la sesión abierta'); return; }
    openClimbSheet(climbFromGym(x));
  },
  async 'scale-add'() {
    const sc = [...M.boulderScale(set())];
    sc.push({ name: `Nivel ${sc.length + 1}`, color: '#64748b', approx: '' });
    state.settings.boulderScale = sc; await saveSettings(); rerender();
  },
  async 'scale-del'(el) {
    const sc = [...M.boulderScale(set())];
    if (sc.length <= 2) return toast('Necesitas al menos dos niveles');
    if (!confirm(`¿Eliminar el nivel «${sc[el.dataset.i].name}»?`)) return;
    sc.splice(Number(el.dataset.i), 1);
    state.settings.boulderScale = sc; await saveSettings(); rerender();
  },
  async 'scale-up'(el) {
    const i = Number(el.dataset.i); const sc = [...M.boulderScale(set())];
    [sc[i - 1], sc[i]] = [sc[i], sc[i - 1]];
    state.settings.boulderScale = sc; await saveSettings(); rerender();
  },
  async 'scale-preset'(el) {
    if (!confirm('¿Reemplazar la escala de bloque actual?')) return;
    state.settings.boulderScale = el.dataset.v === 'font' ? M.FONT_SCALE.map((g) => ({ ...g, color: toHex(g.color) })) : M.DEFAULT_BOULDER_SCALE;
    state.settings.scalePreset = el.dataset.v;
    await saveSettings(); rerender();
  },
};

function closeSheet() {
  const dlg = $('#sheet');
  if (!dlg.open) return;
  dlg.classList.add('closing');
  setTimeout(() => { dlg.close(); dlg.classList.remove('closing'); dlg.style.transform = ''; }, 180);
}

function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  const tag = el.tagName.toLowerCase();
  if (tag === 'button' || tag === 'polygon' || tag === 'img' || el.dataset.action === 'edit-climb') e.preventDefault();
  if (tag === 'button' && el.classList.contains('chip')) haptic(5);
  fn(el, e);
}

let settingsTimer; let queryTimer;
function onInput(e) {
  const el = e.target;
  if (el.dataset.field && state.draft) {
    const k = el.dataset.field;
    state.draft[k] = el.type === 'range' ? Number(el.value) : el.value;
    const out = $(`[data-out="${k}"]`);
    if (out) out.textContent = k === 'duration' ? fmtMin(state.draft.duration) : `${state.draft.rpe}/10 · ${rpeLabel(state.draft.rpe)}`;
    saveDraftSoon(400);
  } else if (el.dataset.cfield && state.climb) {
    state.climb[el.dataset.cfield] = el.value;
  } else if (el.dataset.setting) {
    state.settings[el.dataset.setting] = el.value;
    clearTimeout(settingsTimer); settingsTimer = setTimeout(saveSettings, 400);
  } else if (el.dataset.scale != null) {
    const sc = M.boulderScale(set()).map((g) => ({ ...g }));
    sc[el.dataset.scale][el.dataset.k] = el.value;
    state.settings.boulderScale = sc;
    clearTimeout(settingsTimer); settingsTimer = setTimeout(saveSettings, 400);
  } else if (el.hasAttribute('data-gym-query')) {
    state.ui.gymQuery = el.value;
    clearTimeout(queryTimer);
    queryTimer = setTimeout(() => {
      const pos = el.selectionStart; rerender();
      const inp = $('[data-gym-query]'); if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch { /* */ } }
    }, 250);
  }
}

async function onChange(e) {
  const el = e.target;
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
  if (el.dataset.upload === 'climb') {
    if (!ensureDraft() && !state.draft) return;
    await addPhotos(files.slice(0, 1), state.climb.id);
    renderSheet();
  } else {
    await addPhotos(files);
    rerender();
  }
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
    if (dy > 110) {
      if (state.climb?.isNew && state.draft) state.draft.newPhotos = state.draft.newPhotos.filter((p) => p.climbId !== state.climb.id);
      closeSheet();
    } else dlg.style.transform = '';
    startY = null;
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeSheet(); }); // toque fuera
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
  const c = s?.climbs?.find((x) => x.id === p.climbId);
  const dlg = $('#lightbox');
  dlg.innerHTML = `<form method="dialog"><button class="lb-close" aria-label="Cerrar">${icon('close')}</button></form>
    <img src="${photoURL(id)}" alt="">
    <div class="lb-cap">${c ? `${gradeChip(c, 'sm')} ${esc(c.name || '')}` : ''} ${s ? `<a href="#/sesion/${s.id}" onclick="this.closest('dialog').close()">${I.fmtDate(s.date, { day: 'numeric', month: 'long', year: 'numeric' })} →</a>` : ''}</div>`;
  dlg.showModal();
}

function shareText(s) {
  const climbs = s.climbs || [];
  const sent = climbs.filter(M.isSent);
  const flashes = climbs.filter((c) => c.result === 'flash' || c.result === 'onsight').length;
  const best = [...sent].sort((a, b) => M.intensity(b, set()) - M.intensity(a, set()))[0];
  return [
    `🧗‍♀️ Sesión de ${(TYPE_LABEL[s.type] || 'escalada').toLowerCase()} en ${set().gym || 'el rocódromo'} · ${I.fmtDate(s.date, { day: 'numeric', month: 'long' })}`,
    climbs.length ? `✅ ${sent.length}/${climbs.length} encadenados${flashes ? ` · ⚡ ${flashes} flash` : ''}` : '',
    best ? `🏆 Lo más duro: ${M.gradeLabel(best, set())}${best.name ? ` («${best.name}»)` : ''}` : '',
    s.duration ? `⏱ ${fmtMin(s.duration)} · RPE ${s.rpe}/10` : '',
  ].filter(Boolean).join('\n');
}

init();
