import { db, uid, compressImage, blobToDataURL, dataURLToBlob } from './db.js';
import * as M from './model.js';
import * as I from './insights.js';
import * as C from './charts.js';
import { makeDemo } from './demo.js';

const DEFAULT_SETTINGS = {
  key: 'settings', name: '', gym: 'Sharma Climbing Madrid',
  boulderScale: M.DEFAULT_BOULDER_SCALE, scalePreset: 'colores',
};

const state = {
  sessions: [], settings: { ...DEFAULT_SETTINGS }, photos: new Map(), urls: new Map(),
  draft: null, climb: null,
  ui: { histTab: 'sessions', histFilter: 'all', progDisc: 'boulder', bodyRange: '28' },
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const set = () => state.settings;
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

// ---------------- Arranque ----------------
async function init() {
  const [settings, sessions, photos, draft] = await Promise.all([
    db.get('settings', 'settings'), db.all('sessions'), db.all('photos'), db.get('settings', 'draft'),
  ]);
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  state.sessions = sessions;
  photos.forEach((p) => state.photos.set(p.id, p));
  if (draft?.value) state.draft = draft.value;
  applyTheme();
  window.addEventListener('hashchange', render);
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ---------------- Router ----------------
const routes = [
  [/^#?\/?(inicio)?$/, viewHome, 'inicio'],
  [/^#\/historial$/, viewHistory, 'historial'],
  [/^#\/sesion\/([\w-]+)$/, viewDetail, 'historial'],
  [/^#\/nueva$/, viewEditor, 'nueva'],
  [/^#\/editar\/([\w-]+)$/, viewEditor, 'nueva'],
  [/^#\/progreso$/, viewProgress, 'progreso'],
  [/^#\/cuerpo$/, viewBody, 'cuerpo'],
  [/^#\/ajustes$/, viewSettings, 'ajustes'],
];

function render() {
  const hash = location.hash || '#/inicio';
  for (const [re, fn, tab] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    const html = fn(m[1]);
    $('#view').innerHTML = html;
    document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    document.body.dataset.route = tab;
    if (!render.keepScroll) window.scrollTo(0, 0);
    render.keepScroll = false;
    return;
  }
  location.hash = '#/inicio';
}
const rerender = () => { render.keepScroll = true; render(); };
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

// ---------------- Componentes ----------------
function gradeChip(c, size = '') {
  return `<span class="grade ${size}" style="${C.gradeStyle(M.gradeColor(c, set()))}">${esc(M.gradeLabel(c, set()))}</span>`;
}

function photoURL(id) {
  const p = state.photos.get(id) || state.draft?.newPhotos?.find((x) => x.id === id);
  if (!p) return '';
  if (!state.urls.has(id)) state.urls.set(id, URL.createObjectURL(p.blob));
  return state.urls.get(id);
}

const sessionPhotos = (sid) => [...state.photos.values()].filter((p) => p.sessionId === sid).sort((a, b) => a.createdAt - b.createdAt);

const TYPE_LABEL = { boulder: 'Bloque', route: 'Vías', mixed: 'Mixta', training: 'Entreno' };
const TYPE_ICON = { boulder: '🪨', route: '🧗', mixed: '🔀', training: '🏋️' };

function sessionCard(s) {
  const climbs = s.climbs || [];
  const sent = climbs.filter(M.isSent).length;
  const photos = sessionPhotos(s.id);
  const top = [...climbs].sort((a, b) => M.intensity(b, set()) - M.intensity(a, set())).slice(0, 8);
  return `<a class="card session-card" href="#/sesion/${s.id}">
    <div class="sc-date"><b>${I.parseDate(s.date).getDate()}</b><span>${I.fmtDate(s.date, { month: 'short' }).replace('.', '')}</span></div>
    <div class="sc-main">
      <div class="sc-title">${TYPE_ICON[s.type] || '🧗'} ${TYPE_LABEL[s.type] || 'Sesión'}${s.mood != null ? ` <span>${M.MOODS[s.mood]}</span>` : ''}</div>
      <div class="sc-meta">${climbs.length ? `${sent}/${climbs.length} encadenados` : 'Sin escaladas'}${s.duration ? ` · ${fmtMin(s.duration)}` : ''}${s.rpe ? ` · RPE ${s.rpe}` : ''}</div>
      ${top.length ? `<div class="sc-grades">${top.map((c) => `<span class="dot${M.isSent(c) ? '' : ' open'}" style="--g:${M.gradeColor(c, set())}" title="${esc(M.gradeLabel(c, set()))}"></span>`).join('')}</div>` : ''}
    </div>
    ${photos[0] ? `<img class="sc-thumb" src="${photoURL(photos[0].id)}" alt="">` : ''}
  </a>`;
}

const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`);

function insightCard(i) {
  return `<div class="insight ${i.tone}"><div class="ins-icon">${i.icon}</div><div><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div></div>`;
}

function emptyState(title, text, actions = '') {
  return `<div class="empty"><div class="empty-art">🧗‍♀️</div><h2>${title}</h2><p>${text}</p>${actions}</div>`;
}

// ---------------- Inicio ----------------
function viewHome() {
  const s = state.sessions;
  const name = set().name?.trim();
  const hello = `<header class="hero"><p class="eyebrow">${esc(set().gym || 'Tu rocódromo')}</p><h1>${name ? `¡Hola, ${esc(name)}!` : '¡Hola, escaladora!'}</h1></header>`;
  const pending = state.draft?.isNew ? state.draft : state.stash;
  const draftBanner = pending ? `<a class="card draft-banner" href="#/nueva">✏️ Tienes una sesión a medias (${plural(pending.climbs.length, 'escalada', 'escaladas')}). <b>Continuar →</b></a>` : '';
  if (!s.length) {
    return hello + draftBanner + emptyState('Tu cuaderno de escalada',
      'Registra cada sesión en el rocódromo: bloques y vías por color o grado, intentos, estilo, fotos… y la app te devolverá tu progreso, tu pirámide de grados y qué partes del cuerpo estás trabajando más.',
      `<div class="stack"><a class="btn primary" href="#/nueva">Registrar mi primera sesión</a><button class="btn ghost" data-action="demo">Probar con datos de ejemplo</button></div>`);
  }
  const st = I.summary(s, set());
  const streak = I.weekStreak(s);
  const insights = I.buildInsights(s, set());
  const recent = I.sortSessions(s).slice(0, 3);
  const photos = [...state.photos.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  const ach = I.achievements(s, state.photos.size);
  const doneAch = ach.filter((a) => a.done);
  return `${hello}${draftBanner}
    <section class="kpis">
      ${kpi(st.monthSessions, 'sesiones este mes')}
      ${kpi(streak ? `${streak} 🔥` : '0', 'semanas seguidas')}
      ${kpi(st.bestBoulder ? gradeChip(st.bestBoulder) : '—', 'mejor bloque', true)}
      ${kpi(st.bestRoute ? gradeChip(st.bestRoute) : '—', 'mejor vía', true)}
    </section>
    <a class="btn primary block" href="#/nueva">＋ Nueva sesión</a>
    ${insights.length ? `<section><h2 class="section-title">Para ti</h2><div class="insights">${insights.slice(0, 5).map(insightCard).join('')}</div></section>` : ''}
    <section><div class="section-head"><h2 class="section-title">Últimas sesiones</h2><a href="#/historial">Ver todas</a></div>
      <div class="list">${recent.map(sessionCard).join('')}</div></section>
    ${photos.length ? `<section><div class="section-head"><h2 class="section-title">Fotos</h2><a href="#/historial" data-action="hist-tab" data-tab="photos">Galería</a></div>
      <div class="strip">${photos.map((p) => `<button class="thumb" data-action="photo" data-id="${p.id}"><img src="${photoURL(p.id)}" alt=""></button>`).join('')}</div></section>` : ''}
    <section><div class="section-head"><h2 class="section-title">Logros <span class="muted">${doneAch.length}/${ach.length}</span></h2><a href="#/progreso">Ver todos</a></div>
      <div class="badges">${(doneAch.length ? doneAch.slice(-6).reverse() : ach.slice(0, 3)).map(badge).join('')}</div></section>`;
}

const kpi = (v, l, raw = false) => `<div class="kpi"><div class="kpi-v">${raw ? v : esc(v)}</div><div class="kpi-l">${l}</div></div>`;
const badge = (a) => `<div class="badge ${a.done ? 'done' : ''}" title="${esc(a.desc)}"><span>${a.icon}</span><b>${esc(a.title)}</b><small>${esc(a.desc)}</small></div>`;

// ---------------- Historial ----------------
function viewHistory() {
  const { histTab, histFilter } = state.ui;
  const tabs = seg('hist-tab', histTab, { sessions: 'Sesiones', photos: 'Fotos' });
  if (histTab === 'photos') {
    const photos = [...state.photos.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
    return `<h1 class="page-title">Historial</h1>${tabs}
      ${photos.length ? `<div class="gallery">${photos.map((p) => `<button class="thumb" data-action="photo" data-id="${p.id}"><img src="${photoURL(p.id)}" alt="" loading="lazy"></button>`).join('')}</div>`
        : emptyState('Sin fotos todavía', 'Añade fotos de tus bloques, vías o de la sesión al registrarla.')}`;
  }
  let list = I.sortSessions(state.sessions);
  if (histFilter !== 'all') list = list.filter((s) => s.type === histFilter || (s.climbs || []).some((c) => c.discipline === histFilter));
  const groups = {};
  list.forEach((s) => { const k = s.date.slice(0, 7); (groups[k] ||= []).push(s); });
  return `<h1 class="page-title">Historial</h1>${tabs}
    <div class="chips filter">${Object.entries({ all: 'Todas', boulder: 'Bloque', route: 'Vías', training: 'Entreno' })
      .map(([k, v]) => `<button class="chip ${histFilter === k ? 'on' : ''}" data-action="hist-filter" data-v="${k}">${v}</button>`).join('')}</div>
    ${list.length ? Object.entries(groups).map(([k, ss]) => {
      const [y, m] = k.split('-').map(Number);
      const label = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      const n = ss.reduce((a, s) => a + (s.climbs || []).length, 0);
      return `<h2 class="month">${label} <span class="muted">${plural(ss.length, 'sesión', 'sesiones')} · ${plural(n, 'escalada', 'escaladas')}</span></h2><div class="list">${ss.map(sessionCard).join('')}</div>`;
    }).join('') : emptyState('Nada por aquí', 'Todavía no hay sesiones con este filtro.', '<a class="btn primary" href="#/nueva">Nueva sesión</a>')}`;
}

function seg(action, current, options) {
  return `<div class="seg">${Object.entries(options).map(([k, v]) => `<button class="${current === k ? 'on' : ''}" data-action="${action}" data-v="${k}">${v}</button>`).join('')}</div>`;
}

// ---------------- Detalle de sesión ----------------
function viewDetail(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return emptyState('Sesión no encontrada', '', '<a class="btn" href="#/historial">Volver</a>');
  const climbs = s.climbs || [];
  const photos = sessionPhotos(s.id);
  const bl = I.bodyLoad([s], set());
  const topParts = Object.entries(bl.total).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0).slice(0, 3);
  const sent = climbs.filter(M.isSent);
  const best = (d) => sent.filter((c) => c.discipline === d).sort((a, b) => b.grade - a.grade)[0];
  const date = I.parseDate(s.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `<div class="topline"><a href="#/historial" class="back">‹ Historial</a>
      <div class="row-gap"><button class="icon-btn" data-action="share" data-id="${s.id}" aria-label="Compartir">⤴</button><a class="icon-btn" href="#/editar/${s.id}" aria-label="Editar">✎</a></div></div>
    <p class="eyebrow">${esc(date)}</p>
    <h1 class="page-title">${TYPE_ICON[s.type] || ''} ${TYPE_LABEL[s.type] || 'Sesión'}${s.mood != null ? ` ${M.MOODS[s.mood]}` : ''}</h1>
    <section class="kpis">
      ${kpi(`${sent.length}/${climbs.length}`, 'encadenados')}
      ${kpi(s.duration ? fmtMin(s.duration) : '—', 'duración')}
      ${kpi(s.rpe ? `${s.rpe}/10` : '—', 'esfuerzo (RPE)')}
      ${kpi(best('boulder') ? gradeChip(best('boulder')) : (best('route') ? gradeChip(best('route')) : '—'), 'mejor encadenado', true)}
    </section>
    ${s.notes ? `<div class="card notes">${esc(s.notes).replace(/\n/g, '<br>')}</div>` : ''}
    ${topParts.length ? `<div class="card body-mini">${C.bodyMap(bl.total, bl.max)}<div><h3>Hoy has trabajado</h3>${topParts.map(([p, v]) => `<div class="bar-row"><span>${M.BODY_PARTS[p]}</span><div class="bar"><i style="width:${Math.round(v / bl.max * 100)}%"></i></div></div>`).join('')}</div></div>` : ''}
    ${climbs.length ? `<h2 class="section-title">Escaladas</h2><div class="list">${climbs.map((c) => climbRow(c, false)).join('')}</div>` : ''}
    ${photos.length ? `<h2 class="section-title">Fotos</h2><div class="gallery">${photos.map((p) => `<button class="thumb" data-action="photo" data-id="${p.id}"><img src="${photoURL(p.id)}" alt=""></button>`).join('')}</div>` : ''}
    <button class="btn danger ghost block" data-action="delete-session" data-id="${s.id}">Eliminar sesión</button>`;
}

function climbRow(c, editable) {
  const r = M.RESULTS[c.result] || M.RESULTS.send;
  const tags = M.climbTags(c);
  const photo = (editable ? state.draft.newPhotos.concat([...state.photos.values()]) : [...state.photos.values()]).find((p) => p.climbId === c.id && !(state.draft?.removedPhotos || []).includes(p.id));
  return `<div class="card climb ${M.isSent(c) ? '' : 'is-project'}" ${editable ? `data-action="edit-climb" data-id="${c.id}" role="button" tabindex="0"` : ''}>
    ${gradeChip(c)}
    <div class="climb-main">
      <div class="climb-title">${c.name ? esc(c.name) : (c.discipline === 'route' ? 'Vía' : 'Bloque')}${c.zone ? ` <span class="muted">· ${esc(c.zone)}</span>` : ''}</div>
      <div class="climb-meta"><span class="res res-${c.result}">${r.short} ${r.label}</span>${c.attempts > 1 ? ` · ${c.attempts} intentos` : ''}${c.discipline === 'route' && c.ropeMode ? ` · ${M.ROPE_MODES[c.ropeMode]}` : ''}</div>
      ${tags.length ? `<div class="mini-tags">${tags.map((t) => `<span>${esc(M.tagLabel(t))}</span>`).join('')}</div>` : ''}
      ${c.notes ? `<p class="climb-notes">${esc(c.notes)}</p>` : ''}
    </div>
    ${photo ? `<img class="climb-thumb" src="${photoURL(photo.id)}" alt="" ${editable ? '' : `data-action="photo" data-id="${photo.id}"`}>` : ''}
  </div>`;
}

// ---------------- Editor de sesión ----------------
function newDraft() {
  return { id: uid(), isNew: true, date: I.today(), type: 'boulder', duration: 90, rpe: 6, mood: null, notes: '', climbs: [], newPhotos: [], removedPhotos: [] };
}

function viewEditor(editId) {
  if (editId && state.draft?.id !== editId) {
    const s = state.sessions.find((x) => x.id === editId);
    if (!s) return emptyState('Sesión no encontrada', '');
    if (state.draft?.isNew) state.stash = state.draft;
    state.draft = { ...structuredClone(s), isNew: false, newPhotos: [], removedPhotos: [] };
  }
  if (!editId && !state.draft?.isNew) { state.draft = state.stash || newDraft(); state.stash = null; }
  const d = state.draft;
  const photos = [...sessionPhotos(d.id).filter((p) => !d.removedPhotos.includes(p.id) && !p.climbId), ...d.newPhotos.filter((p) => !p.climbId)];
  const sent = d.climbs.filter(M.isSent).length;
  return `<div class="topline"><button class="back" data-action="cancel-draft">‹ Cancelar</button><span class="muted small">${d.isNew ? 'Se guarda el borrador automáticamente' : 'Editando'}</span></div>
    <h1 class="page-title">${d.isNew ? 'Nueva sesión' : 'Editar sesión'}</h1>
    <div class="form">
      <label class="field"><span>Fecha</span><input type="date" data-field="date" value="${d.date}" max="${I.today()}"></label>
      <div class="field"><span>Tipo de sesión</span><div class="chips">${Object.entries(TYPE_LABEL).map(([k, v]) => `<button class="chip ${d.type === k ? 'on' : ''}" data-action="set-type" data-v="${k}">${TYPE_ICON[k]} ${v}</button>`).join('')}</div></div>
      <div class="field"><span>Duración <b data-out="duration">${fmtMin(d.duration || 0)}</b></span>
        <input type="range" min="15" max="240" step="15" data-field="duration" value="${d.duration || 90}"></div>
      <div class="field"><span>Esfuerzo percibido (RPE) <b data-out="rpe">${d.rpe}/10 · ${rpeLabel(d.rpe)}</b></span>
        <input type="range" min="1" max="10" step="1" data-field="rpe" value="${d.rpe}" class="rpe"></div>
      <div class="field"><span>¿Cómo te has sentido?</span><div class="moods">${M.MOODS.map((m, i) => `<button class="mood ${d.mood === i ? 'on' : ''}" data-action="set-mood" data-v="${i}">${m}</button>`).join('')}</div></div>
    </div>

    <div class="section-head"><h2 class="section-title">Escaladas <span class="muted">${d.climbs.length ? `${sent}/${d.climbs.length}` : ''}</span></h2></div>
    ${d.type === 'training' ? '<p class="muted small">Sesión de entreno (fuerza, suspensiones, campus…). Puedes añadir escaladas igualmente o describirlo en las notas.</p>' : ''}
    <div class="add-row">
      <button class="btn primary" data-action="add-climb" data-v="boulder">＋ Bloque</button>
      <button class="btn primary alt" data-action="add-climb" data-v="route">＋ Vía</button>
    </div>
    ${quickAdd(d)}
    <div class="list">${d.climbs.slice().reverse().map((c) => climbRow(c, true)).join('')}</div>

    <h2 class="section-title">Fotos y notas</h2>
    <div class="gallery">
      ${photos.map((p) => `<div class="thumb"><img src="${photoURL(p.id)}" alt=""><button class="x" data-action="remove-photo" data-id="${p.id}" aria-label="Quitar foto">×</button></div>`).join('')}
      <label class="thumb add-photo"><input type="file" accept="image/*" multiple data-upload="session" hidden><span>📷<br>Añadir</span></label>
    </div>
    <label class="field"><span>Notas</span><textarea data-field="notes" rows="3" placeholder="Cómo fue, qué aprendiste, ejercicios de entreno…">${esc(d.notes)}</textarea></label>
    <div class="save-bar"><button class="btn primary block" data-action="save-session">Guardar sesión</button></div>`;
}

function quickAdd(d) {
  const disc = d.type === 'route' ? 'route' : 'boulder';
  const grades = disc === 'route' ? M.ROUTE_GRADES.map((g, i) => ({ i, label: g, color: M.routeColor(i) })).slice(4, 20)
    : M.boulderScale(set()).map((g, i) => ({ i, label: g.name, color: g.color }));
  return `<details class="card quick"><summary>⚡ Registro rápido de ${disc === 'route' ? 'vías' : 'bloques'}</summary>
    <p class="muted small">Elige el resultado y toca un grado: se añade al momento. Luego puedes tocarlo en la lista para añadir detalles.</p>
    <div class="chips">${['flash', 'send', 'project'].map((r) => `<button class="chip ${state.ui.quickResult === r || (!state.ui.quickResult && r === 'send') ? 'on' : ''}" data-action="quick-result" data-v="${r}">${M.RESULTS[r].short} ${M.RESULTS[r].label}</button>`).join('')}</div>
    <div class="grade-grid">${grades.map((g) => `<button class="grade-pick" style="${C.gradeStyle(g.color)}" data-action="quick-add" data-disc="${disc}" data-v="${g.i}">${esc(g.label)}</button>`).join('')}</div>
  </details>`;
}

const rpeLabel = (r) => (r <= 2 ? 'muy suave' : r <= 4 ? 'suave' : r <= 6 ? 'moderado' : r <= 8 ? 'duro' : 'al límite');

// ---------------- Hoja de escalada (bloque/vía) ----------------
function openClimbSheet(climb) {
  state.climb = climb;
  const dlg = $('#sheet');
  renderSheet();
  if (!dlg.open) dlg.showModal();
}

function renderSheet() {
  const c = state.climb; const d = state.draft;
  const body = $('#sheet .sheet-body');
  const scroll = body?.scrollTop || 0;
  const isRoute = c.discipline === 'route';
  const grades = isRoute ? M.ROUTE_GRADES.map((g, i) => ({ i, label: g, color: M.routeColor(i) }))
    : M.boulderScale(set()).map((g, i) => ({ i, label: g.name, color: g.color, approx: g.approx }));
  const photo = d.newPhotos.find((p) => p.climbId === c.id) || [...state.photos.values()].find((p) => p.climbId === c.id && !d.removedPhotos.includes(p.id));
  const knownNames = [...new Set(state.sessions.flatMap((s) => (s.climbs || []).map((x) => x.name)).filter(Boolean))];
  const zones = [...new Set(state.sessions.flatMap((s) => (s.climbs || []).map((x) => x.zone)).filter(Boolean))];
  const results = isRoute ? ['onsight', 'flash', 'send', 'project'] : ['flash', 'send', 'project'];
  $('#sheet').innerHTML = `<form method="dialog" class="sheet">
    <div class="sheet-head"><button class="link" value="cancel" data-action="close-sheet">Cancelar</button><b>${c.isNew ? 'Añadir' : 'Editar'} ${isRoute ? 'vía' : 'bloque'}</b>
      ${c.isNew ? '<span></span>' : `<button class="link danger" data-action="delete-climb" type="button">Borrar</button>`}</div>
    <div class="sheet-body">
      <div class="seg">${['boulder', 'route'].map((k) => `<button type="button" class="${c.discipline === k ? 'on' : ''}" data-action="cd-disc" data-v="${k}">${k === 'route' ? '🧗 Vía' : '🪨 Bloque'}</button>`).join('')}</div>
      <div class="field"><span>${isRoute ? 'Grado' : 'Color / nivel'} ${!isRoute && grades[c.grade]?.approx ? `<b class="muted">≈ ${esc(grades[c.grade].approx)}</b>` : ''}</span>
        <div class="grade-grid">${grades.map((g) => `<button type="button" class="grade-pick ${c.grade === g.i ? 'on' : ''}" style="${C.gradeStyle(g.color)}" data-action="cd-grade" data-v="${g.i}">${esc(g.label)}</button>`).join('')}</div></div>
      <div class="field"><span>Resultado</span><div class="chips">${results.map((r) => `<button type="button" class="chip ${c.result === r ? 'on' : ''}" data-action="cd-result" data-v="${r}" title="${M.RESULTS[r].desc}">${M.RESULTS[r].short} ${M.RESULTS[r].label}</button>`).join('')}</div></div>
      <div class="field inline"><span>Intentos</span><div class="stepper"><button type="button" data-action="cd-att" data-v="-1">−</button><b>${c.attempts}</b><button type="button" data-action="cd-att" data-v="1">＋</button></div></div>
      ${isRoute ? `<div class="field"><span>Modalidad</span><div class="chips">${Object.entries(M.ROPE_MODES).map(([k, v]) => `<button type="button" class="chip ${c.ropeMode === k ? 'on' : ''}" data-action="cd-rope" data-v="${k}">${v}</button>`).join('')}</div></div>` : ''}
      ${Object.entries(M.TAGS).map(([group, g]) => `<div class="field"><span>${g.label}</span><div class="chips">${Object.entries(g.items).map(([k, v]) =>
        `<button type="button" class="chip ${(c[group] || []).includes(k) ? 'on' : ''}" data-action="cd-tag" data-group="${group}" data-v="${k}">${v}</button>`).join('')}</div></div>`).join('')}
      <label class="field"><span>Nombre o descripción <small class="muted">(para seguir proyectos)</small></span><input data-cfield="name" list="names" value="${esc(c.name)}" placeholder="p. ej. «El rosa del desplome»"><datalist id="names">${knownNames.map((n) => `<option value="${esc(n)}">`).join('')}</datalist></label>
      <label class="field"><span>Zona / sector</span><input data-cfield="zone" list="zones" value="${esc(c.zone)}" placeholder="p. ej. Cueva, Muro de competición…"><datalist id="zones">${zones.map((n) => `<option value="${esc(n)}">`).join('')}</datalist></label>
      <label class="field"><span>Notas / beta</span><textarea data-cfield="notes" rows="2" placeholder="Truco del paso clave, pies, sensaciones…">${esc(c.notes)}</textarea></label>
      <div class="field"><span>Foto</span>
        ${photo ? `<div class="thumb wide"><img src="${photoURL(photo.id)}" alt=""><button type="button" class="x" data-action="remove-photo" data-id="${photo.id}">×</button></div>`
          : '<label class="btn ghost"><input type="file" accept="image/*" data-upload="climb" hidden>📷 Añadir foto del bloque/vía</label>'}
      </div>
    </div>
    <div class="sheet-foot">
      ${c.isNew ? '<button type="button" class="btn ghost" data-action="save-climb" data-again="1">Guardar y otro</button>' : ''}
      <button type="button" class="btn primary" data-action="save-climb">${c.isNew ? 'Añadir' : 'Guardar'}</button>
    </div></form>`;
  $('#sheet .sheet-body').scrollTop = scroll;
}

function newClimb(discipline, from) {
  const scaleLen = discipline === 'route' ? M.ROUTE_GRADES.length : M.boulderScale(set()).length;
  const lastSame = [...(state.draft?.climbs || [])].reverse().find((c) => c.discipline === discipline);
  return {
    id: uid(), isNew: true, discipline,
    grade: from?.grade ?? lastSame?.grade ?? (discipline === 'route' ? 8 : Math.min(2, scaleLen - 1)),
    result: 'send', attempts: 1, ropeMode: discipline === 'route' ? (lastSame?.ropeMode || 'toprope') : undefined,
    styles: [], holds: [], moves: [], name: '', zone: from?.zone ?? lastSame?.zone ?? '', notes: '',
  };
}

// ---------------- Progreso ----------------
function viewProgress() {
  const s = state.sessions;
  if (!s.length) return `<h1 class="page-title">Progreso</h1>${emptyState('Aún no hay datos', 'Registra sesiones y aquí verás tu evolución, tu pirámide y tus proyectos.', '<a class="btn primary" href="#/nueva">Nueva sesión</a>')}`;
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
  const ach = I.achievements(s, state.photos.size);
  return `<h1 class="page-title">Progreso</h1>
    ${seg('prog-disc', disc, { boulder: '🪨 Bloque', route: '🧗 Vías' })}
    <section class="kpis">
      ${kpi(best ? gradeChip(best) : '—', 'máximo encadenado', true)}
      ${kpi(bestF ? gradeChip(bestF) : '—', disc === 'route' ? 'máximo flash / a vista' : 'máximo flash', true)}
      ${kpi(sentN, 'encadenados')}
      ${kpi(climbs.length ? `${Math.round(sentN / climbs.length * 100)}%` : '—', 'tasa de éxito')}
    </section>
    <div class="card"><h3>Evolución de grado <small class="muted">últimas 12 semanas</small></h3>${C.progressChart(I.weeklyProgress(s, disc), label)}</div>
    <div class="card"><h3>Pirámide de grados</h3>${C.pyramidChart(I.pyramid(s, disc, set()), label, color)}</div>
    <div class="card"><h3>Volumen semanal</h3>${C.volumeChart(I.weeklyVolume(s))}</div>
    <div class="card"><h3>Calendario</h3><div class="scroll-x">${C.calendarHeatmap(s)}</div></div>
    <div class="card"><h3>Estilos: lo que pruebas y lo que encadenas</h3>
      ${tags.length ? tags.slice(0, 10).map((t) => `<div class="bar-row wide"><span>${esc(t.label)}</span><div class="bar"><i style="width:${Math.round(t.rate * 100)}%"></i></div><small>${t.sent}/${t.total}</small></div>`).join('')
        : '<p class="muted small">Etiqueta tus escaladas (desplome, regletas, dinámico…) para descubrir tus puntos fuertes y débiles.</p>'}
    </div>
    <div class="card"><h3>📌 Proyectos abiertos</h3>
      ${projects.length ? projects.map((p) => `<div class="proj">${gradeChip(p)}<div><b>${esc(p.name)}</b><small class="muted">${plural(p.sessions, 'sesión', 'sesiones')} · ${p.attemptsTotal} intentos · último ${I.fmtDate(p.lastTried)}</small></div></div>`).join('')
        : '<p class="muted small">Marca una escalada como «Proyecto» y ponle nombre para seguirla entre sesiones.</p>'}
      ${done.length ? `<h4>✅ Proyectos encadenados</h4>${done.slice(0, 5).map((p) => `<div class="proj">${gradeChip(p)}<div><b>${esc(p.name)}</b><small class="muted">${I.fmtDate(p.date)} · tras ${p.sessionsTried} sesiones</small></div></div>`).join('')}` : ''}
    </div>
    <h2 class="section-title">Logros <span class="muted">${ach.filter((a) => a.done).length}/${ach.length}</span></h2>
    <div class="badges">${ach.map(badge).join('')}</div>`;
}

// ---------------- Cuerpo ----------------
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

function viewBody() {
  const range = state.ui.bodyRange;
  const now = I.today();
  const ss = range === 'all' ? state.sessions : state.sessions.filter((s) => I.daysBetween(s.date, now) < Number(range));
  const bl = I.bodyLoad(ss, set());
  const parts = Object.entries(bl.total).sort((a, b) => b[1] - a[1]);
  return `<h1 class="page-title">Tu cuerpo</h1>
    ${seg('body-range', range, { 28: '4 semanas', 90: '3 meses', all: 'Todo' })}
    ${bl.sum ? `<div class="card body-card">${C.bodyMap(bl.total, bl.max)}
      <div class="heat-legend"><span>Menos</span><i></i><span>Más</span></div></div>
      <div class="card"><h3>Reparto del esfuerzo</h3>${parts.map(([p, v]) => `<div class="bar-row wide"><span>${M.BODY_PARTS[p]}</span><div class="bar heat"><i style="width:${Math.round(v / bl.max * 100)}%"></i></div><small>${Math.round(v / bl.sum * 100)}%</small></div>`).join('')}</div>
      <h2 class="section-title">Consejos para tus zonas más cargadas</h2>
      ${parts.slice(0, 3).map(([p]) => `<div class="insight info"><div class="ins-icon">${{ dedos: '🤞', antebrazos: '💪', biceps: '💪', hombros: '🏋️', espalda: '🔙', core: '🎯', cadera: '🧘', piernas: '🦵' }[p]}</div><div><b>${M.BODY_PARTS[p]}</b><p>${BODY_TIPS[p]}</p></div></div>`).join('')}
      <p class="muted small note">ℹ️ Estimación orientativa: se calcula a partir del grado, los intentos y las etiquetas de cada escalada (inclinación, presas, movimientos). Cuanto más etiquetes, más fiel será. No sustituye la opinión de un fisio.</p>`
      : emptyState('Sin datos en este periodo', 'Registra escaladas y etiqueta su estilo (desplome, regletas, talonamientos…) para ver qué partes del cuerpo trabajas más.', '<a class="btn primary" href="#/nueva">Nueva sesión</a>')}`;
}

// ---------------- Ajustes ----------------
function viewSettings() {
  const st = set();
  const scale = M.boulderScale(st);
  const demoCount = state.sessions.filter((s) => s.demo).length;
  return `<h1 class="page-title">Ajustes</h1>
    <div class="card form">
      <label class="field"><span>Tu nombre</span><input data-setting="name" value="${esc(st.name)}" placeholder="¿Cómo te llamas?"></label>
      <label class="field"><span>Rocódromo</span><input data-setting="gym" value="${esc(st.gym)}"></label>
      <div class="field"><span>Tema</span>${seg('theme', st.theme || 'auto', { auto: 'Automático', light: 'Claro', dark: 'Oscuro' })}</div>
    </div>
    <div class="card">
      <h3>Escala de bloque</h3>
      <p class="muted small">Ajusta los colores y su grado aproximado para que coincidan con los circuitos de tu rocódromo (los rocódromos los cambian con cada reequipamiento). El orden va de más fácil a más difícil.</p>
      <div class="scale-editor">${scale.map((g, i) => `<div class="scale-row">
        <input type="color" value="${toHex(g.color)}" data-scale="${i}" data-k="color" aria-label="Color">
        <input value="${esc(g.name)}" data-scale="${i}" data-k="name" aria-label="Nombre">
        <input value="${esc(g.approx)}" data-scale="${i}" data-k="approx" placeholder="≈ grado" aria-label="Grado aproximado">
        <button class="icon-btn" data-action="scale-up" data-i="${i}" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-btn" data-action="scale-del" data-i="${i}" aria-label="Eliminar">×</button></div>`).join('')}</div>
      <div class="row-gap wrap"><button class="btn ghost sm" data-action="scale-add">＋ Añadir nivel</button>
        <button class="btn ghost sm" data-action="scale-preset" data-v="colores">Restablecer colores</button>
        <button class="btn ghost sm" data-action="scale-preset" data-v="font">Usar grados Font (6A, 6B…)</button></div>
      <p class="muted small">⚠️ Cambiar el número u orden de niveles afecta a cómo se muestran las escaladas ya registradas.</p>
    </div>
    <div class="card">
      <h3>Tus datos</h3>
      <p class="muted small">Todo se guarda solo en este dispositivo y navegador. Haz copias de seguridad de vez en cuando (incluyen las fotos) y úsalas también para pasar tus datos a otro móvil.</p>
      <div class="stack">
        <button class="btn" data-action="export">⬇️ Descargar copia de seguridad</button>
        <label class="btn ghost"><input type="file" accept="application/json,.json" data-upload="import" hidden>⬆️ Restaurar copia</label>
        ${demoCount ? `<button class="btn ghost" data-action="demo-clear">Quitar datos de ejemplo (${demoCount})</button>` : '<button class="btn ghost" data-action="demo">Cargar datos de ejemplo</button>'}
        <button class="btn danger ghost" data-action="wipe">Borrar todos los datos</button>
      </div>
      <p class="muted small">${plural(state.sessions.length, 'sesión', 'sesiones')} · ${plural(state.photos.size, 'foto', 'fotos')}</p>
    </div>
    <p class="muted small center">Cuaderno de escalada · hecho con cariño para escalar más y mejor 🧗‍♀️</p>`;
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
// Cambios estructurales se guardan al momento; el texto, con un pequeño retardo.
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
  const { isNew, newPhotos, removedPhotos, ...session } = d;
  session.createdAt ||= Date.now();
  session.updatedAt = Date.now();
  session.climbs = session.climbs.map(({ isNew: _, ...c }) => c);
  // Fotos de escaladas que ya no existen
  const climbIds = new Set(session.climbs.map((c) => c.id));
  const orphan = [...state.photos.values()].filter((p) => p.sessionId === d.id && p.climbId && !climbIds.has(p.climbId)).map((p) => p.id);
  const toRemove = [...removedPhotos, ...orphan];
  const toAdd = newPhotos.filter((p) => !p.climbId || climbIds.has(p.climbId)).map((p) => ({ ...p, sessionId: d.id, date: session.date }));
  // Mantener la fecha de las fotos sincronizada con la sesión
  const toUpdate = [...state.photos.values()].filter((p) => p.sessionId === d.id && !toRemove.includes(p.id) && p.date !== session.date).map((p) => ({ ...p, date: session.date }));
  await db.put('sessions', session);
  if (toAdd.length || toUpdate.length) await db.putMany('photos', [...toAdd, ...toUpdate]);
  if (toRemove.length) await db.delMany('photos', toRemove);
  [...toAdd, ...toUpdate].forEach((p) => state.photos.set(p.id, p));
  toRemove.forEach((id) => state.photos.delete(id));
  const i = state.sessions.findIndex((s) => s.id === session.id);
  if (i >= 0) state.sessions[i] = session; else state.sessions.push(session);
  await clearDraft();
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

// ---------------- Exportar / importar ----------------
async function exportData() {
  toast('Preparando copia…');
  const photos = await Promise.all([...state.photos.values()].map(async ({ blob, ...p }) => ({ ...p, data: await blobToDataURL(blob) })));
  const data = { app: 'cuaderno-escalada', version: 1, exportedAt: new Date().toISOString(), settings: state.settings, sessions: state.sessions, photos };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `escalada-${I.today()}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'cuaderno-escalada') throw new Error('formato');
    if (!confirm(`Restaurar ${plural(data.sessions.length, 'sesión', 'sesiones')} y ${plural(data.photos?.length || 0, 'foto', 'fotos')}? Se combinarán con los datos actuales.`)) return;
    const photos = await Promise.all((data.photos || []).map(async ({ data: url, ...p }) => ({ ...p, blob: await dataURLToBlob(url) })));
    await db.putMany('sessions', data.sessions);
    await db.putMany('photos', photos);
    if (data.settings) { state.settings = { ...state.settings, ...data.settings, key: 'settings' }; await saveSettings(); }
    data.sessions.forEach((s) => { const i = state.sessions.findIndex((x) => x.id === s.id); if (i >= 0) state.sessions[i] = s; else state.sessions.push(s); });
    photos.forEach((p) => state.photos.set(p.id, p));
    applyTheme();
    toast('Copia restaurada ✅');
    render();
  } catch (e) {
    toast('No se pudo leer el archivo de copia');
  }
}

// ---------------- Eventos ----------------
const actions = {
  async demo() {
    const sessions = makeDemo(set());
    await db.putMany('sessions', sessions);
    state.sessions.push(...sessions);
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
  export: exportData,
  'hist-tab'(el) { state.ui.histTab = el.dataset.v || el.dataset.tab; if (location.hash !== '#/historial') return; rerender(); },
  'hist-filter'(el) { state.ui.histFilter = el.dataset.v; rerender(); },
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
    go('#/historial');
  },
  async 'cancel-draft'() {
    const d = state.draft;
    if (d?.isNew && (d.climbs.length || d.newPhotos.length || d.notes) && !confirm('¿Descartar esta sesión sin guardar?')) return;
    const back = d && !d.isNew ? `#/sesion/${d.id}` : '#/inicio';
    await clearDraft();
    go(back);
  },
  'set-type'(el) { state.draft.type = el.dataset.v; saveDraftSoon(); rerender(); },
  'set-mood'(el) { const v = Number(el.dataset.v); state.draft.mood = state.draft.mood === v ? null : v; saveDraftSoon(); rerender(); },
  'add-climb'(el) { openClimbSheet(newClimb(el.dataset.v)); },
  'edit-climb'(el) { const c = state.draft.climbs.find((x) => x.id === el.dataset.id); if (c) openClimbSheet({ ...structuredClone(c), isNew: false }); },
  'quick-result'(el) { state.ui.quickResult = el.dataset.v; rerender(); keepQuickOpen(); },
  'quick-add'(el) {
    const c = newClimb(el.dataset.disc, { grade: Number(el.dataset.v) });
    c.result = state.ui.quickResult || 'send';
    if (c.result === 'project') c.attempts = 3;
    delete c.isNew;
    state.draft.climbs.push(c);
    saveDraftSoon(); rerender(); keepQuickOpen();
    toast(`${M.gradeLabel(c, set())} · ${M.RESULTS[c.result].label} añadido`);
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
    // Si se cancela una escalada nueva, sus fotos pendientes se descartan.
    if (state.climb?.isNew) state.draft.newPhotos = state.draft.newPhotos.filter((p) => p.climbId !== state.climb.id);
    $('#sheet').close();
  },
  'cd-disc'(el) {
    const c = state.climb; if (c.discipline === el.dataset.v) return;
    const fresh = newClimb(el.dataset.v);
    Object.assign(c, { discipline: el.dataset.v, grade: fresh.grade, ropeMode: fresh.ropeMode, result: c.result === 'onsight' ? 'flash' : c.result });
    renderSheet();
  },
  'cd-grade'(el) { state.climb.grade = Number(el.dataset.v); renderSheet(); },
  'cd-result'(el) {
    const c = state.climb; c.result = el.dataset.v;
    if ((c.result === 'flash' || c.result === 'onsight')) c.attempts = 1;
    else if (c.attempts === 1 && c.result === 'send') c.attempts = 2;
    renderSheet();
  },
  'cd-att'(el) {
    const c = state.climb; c.attempts = Math.max(1, Math.min(99, c.attempts + Number(el.dataset.v)));
    if (c.attempts > 1 && (c.result === 'flash' || c.result === 'onsight')) c.result = 'send';
    renderSheet();
  },
  'cd-rope'(el) { state.climb.ropeMode = el.dataset.v; renderSheet(); },
  'cd-tag'(el) {
    const arr = state.climb[el.dataset.group] ||= [];
    const i = arr.indexOf(el.dataset.v);
    if (i >= 0) arr.splice(i, 1); else arr.push(el.dataset.v);
    renderSheet();
  },
  'save-climb'(el) {
    const c = state.climb; const d = state.draft;
    const { isNew, ...clean } = c;
    const i = d.climbs.findIndex((x) => x.id === c.id);
    if (i >= 0) d.climbs[i] = clean; else d.climbs.push(clean);
    saveDraftSoon();
    if (el.dataset.again) {
      toast(`${M.gradeLabel(c, set())} añadido`);
      openClimbSheet(newClimb(c.discipline, { grade: c.grade, zone: c.zone }));
    } else $('#sheet').close();
    rerender();
  },
  'delete-climb'() {
    const d = state.draft; const c = state.climb;
    d.climbs = d.climbs.filter((x) => x.id !== c.id);
    d.newPhotos = d.newPhotos.filter((p) => p.climbId !== c.id);
    saveDraftSoon();
    $('#sheet').close(); rerender();
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

function keepQuickOpen() { const q = $('details.quick'); if (q) q.open = true; }

function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.tagName === 'BUTTON' || el.dataset.action === 'edit-climb' || el.tagName === 'IMG') e.preventDefault();
  fn(el, e);
}

let settingsTimer;
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
  }
}

async function onChange(e) {
  const el = e.target;
  if (!el.dataset.upload || !el.files?.length) return;
  const files = [...el.files];
  el.value = '';
  if (el.dataset.upload === 'import') return importData(files[0]);
  toast('Procesando foto…');
  if (el.dataset.upload === 'climb') {
    await addPhotos(files.slice(0, 1), state.climb.id);
    renderSheet();
  } else {
    await addPhotos(files);
    rerender();
  }
}

// ---------------- Utilidades UI ----------------
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

function openPhoto(id) {
  const p = state.photos.get(id); if (!p) return;
  const s = state.sessions.find((x) => x.id === p.sessionId);
  const c = s?.climbs?.find((x) => x.id === p.climbId);
  const dlg = $('#lightbox');
  dlg.innerHTML = `<form method="dialog"><button class="lb-close" aria-label="Cerrar">×</button></form>
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
