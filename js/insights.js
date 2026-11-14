// Cálculos: estadísticas, carga corporal, progreso, consejos y logros.
import {
  BODY_WEIGHTS, BODY_PARTS, RESULTS, ROUTE_GRADES, TAGS, boulderScale, intensity, isSent,
  climbTags, tagLabel, gradeLabel,
} from './model.js';

export const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => toISO(new Date());
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
export function weekStart(d) {
  const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x;
}

export const sortSessions = (sessions) => [...sessions].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
export const allClimbs = (sessions) => sessions.flatMap((s) => (s.climbs || []).map((c) => ({ ...c, date: s.date, sessionId: s.id })));

// ---------- Carga corporal ----------
export function climbBodyLoad(c, settings) {
  const load = {};
  const k = (0.5 + intensity(c, settings)) * (1 + Math.log(Math.max(1, c.attempts || 1)));
  const add = (part, v) => { load[part] = (load[part] || 0) + v * k; };
  add('dedos', 1); add('antebrazos', c.discipline === 'route' ? 1.6 : 1);
  if (c.discipline === 'route') add('piernas', 0.6);
  for (const t of climbTags(c)) for (const [p, w] of Object.entries(BODY_WEIGHTS[t] || {})) add(p, w);
  return load;
}

export function bodyLoad(sessions, settings) {
  const total = Object.fromEntries(Object.keys(BODY_PARTS).map((p) => [p, 0]));
  for (const c of allClimbs(sessions)) for (const [p, v] of Object.entries(climbBodyLoad(c, settings))) total[p] += v;
  const sum = Object.values(total).reduce((a, b) => a + b, 0);
  const max = Math.max(...Object.values(total), 0);
  return { total, sum, max };
}

// Carga de sesión (sRPE: minutos × esfuerzo percibido, Foster 2001).
export const sessionLoad = (s) => (s.duration || 0) * (s.rpe || 0);

// ---------- Estadísticas básicas ----------
export function summary(sessions, settings) {
  const climbs = allClimbs(sessions);
  const sent = climbs.filter(isSent);
  const best = (disc, pred = isSent) => {
    const xs = climbs.filter((c) => c.discipline === disc && pred(c));
    return xs.length ? xs.reduce((m, c) => (c.grade > m.grade ? c : m)) : null;
  };
  const now = today();
  const month = now.slice(0, 7);
  return {
    sessions: sessions.length,
    climbs: climbs.length,
    sent: sent.length,
    flashes: climbs.filter((c) => c.result === 'flash' || c.result === 'onsight').length,
    minutes: sessions.reduce((a, s) => a + (s.duration || 0), 0),
    monthSessions: sessions.filter((s) => s.date.startsWith(month)).length,
    bestBoulder: best('boulder'),
    bestRoute: best('route'),
    bestFlashBoulder: best('boulder', (c) => c.result === 'flash'),
    bestFlashRoute: best('route', (c) => c.result === 'flash' || c.result === 'onsight'),
    sendRate: climbs.length ? sent.length / climbs.length : 0,
    label: (c) => (c ? gradeLabel(c, settings) : '—'),
  };
}

export function pyramid(sessions, discipline, settings) {
  const n = discipline === 'route' ? ROUTE_GRADES.length : boulderScale(settings).length;
  const rows = Array.from({ length: n }, (_, i) => ({ grade: i, flash: 0, send: 0, project: 0 }));
  for (const c of allClimbs(sessions)) {
    if (c.discipline !== discipline || !rows[c.grade]) continue;
    if (c.result === 'flash' || c.result === 'onsight') rows[c.grade].flash++;
    else if (c.result === 'send') rows[c.grade].send++;
    else rows[c.grade].project++;
  }
  let lo = rows.findIndex((r) => r.flash + r.send + r.project > 0);
  let hi = rows.length - 1 - [...rows].reverse().findIndex((r) => r.flash + r.send + r.project > 0);
  if (lo < 0) return [];
  lo = Math.max(0, lo); hi = Math.min(n - 1, hi + 1);
  return rows.slice(lo, hi + 1).reverse();
}

// Máximo grado encadenado por semana (últimas N semanas).
export function weeklyProgress(sessions, discipline, weeks = 12) {
  const start = weekStart(new Date()); start.setDate(start.getDate() - 7 * (weeks - 1));
  const out = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(start); d.setDate(d.getDate() + 7 * i);
    return { week: d, max: null, avg: null, count: 0 };
  });
  const buckets = out.map(() => []);
  for (const c of allClimbs(sessions)) {
    if (c.discipline !== discipline || !isSent(c)) continue;
    const i = Math.floor((parseDate(c.date) - start) / (7 * 86400000));
    if (i >= 0 && i < weeks) buckets[i].push(c.grade);
  }
  buckets.forEach((b, i) => {
    if (!b.length) return;
    const top = [...b].sort((x, y) => y - x).slice(0, 5);
    out[i].max = Math.max(...b);
    out[i].avg = top.reduce((a, x) => a + x, 0) / top.length;
    out[i].count = b.length;
  });
  return out;
}

export function weeklyVolume(sessions, weeks = 12) {
  const start = weekStart(new Date()); start.setDate(start.getDate() - 7 * (weeks - 1));
  const out = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(start); d.setDate(d.getDate() + 7 * i);
    return { week: d, boulder: 0, route: 0, load: 0 };
  });
  for (const s of sessions) {
    const i = Math.floor((parseDate(s.date) - start) / (7 * 86400000));
    if (i < 0 || i >= weeks) continue;
    out[i].load += sessionLoad(s);
    for (const c of s.climbs || []) out[i][c.discipline]++;
  }
  return out;
}

export function tagStats(sessions) {
  const stats = {};
  for (const c of allClimbs(sessions)) {
    for (const t of climbTags(c)) {
      const s = stats[t] ||= { tag: t, label: tagLabel(t), total: 0, sent: 0, last: c.date };
      s.total++; if (isSent(c)) s.sent++;
      if (c.date > s.last) s.last = c.date;
    }
  }
  return Object.values(stats).map((s) => ({ ...s, rate: s.sent / s.total })).sort((a, b) => b.total - a.total);
}

export function weekStreak(sessions) {
  if (!sessions.length) return 0;
  const weeks = new Set(sessions.map((s) => weekStart(parseDate(s.date)).getTime()));
  let w = weekStart(new Date());
  if (!weeks.has(w.getTime())) w.setDate(w.getDate() - 7); // la semana actual aún puede llegar
  let n = 0;
  while (weeks.has(w.getTime())) { n++; w.setDate(w.getDate() - 7); }
  return n;
}

export function openProjects(sessions, settings) {
  const climbs = allClimbs(sessions).sort((a, b) => a.date.localeCompare(b.date));
  const map = new Map();
  for (const c of climbs) {
    const key = `${c.discipline}|${c.grade}|${(c.name || '').trim().toLowerCase()}`;
    if (!c.name?.trim()) continue;
    if (isSent(c)) { if (map.has(key)) map.get(key).sentOn = c.date; continue; }
    const p = map.get(key) || { ...c, sessions: 0, attemptsTotal: 0, first: c.date, sentOn: null };
    if (p.sentOn) { p.sentOn = null; p.sessions = 0; p.attemptsTotal = 0; p.first = c.date; }
    p.sessions++; p.attemptsTotal += c.attempts || 1; p.lastTried = c.date;
    map.set(key, p);
  }
  return [...map.values()].filter((p) => !p.sentOn).map((p) => ({ ...p, label: gradeLabel(p, settings) }))
    .sort((a, b) => b.lastTried.localeCompare(a.lastTried));
}

export function sentProjects(sessions) {
  // Proyectos encadenados: bloques/vías con nombre que se probaron en ≥2 sesiones antes de salir.
  const climbs = allClimbs(sessions).sort((a, b) => a.date.localeCompare(b.date));
  const tried = new Map(); const done = [];
  for (const c of climbs) {
    if (!c.name?.trim()) continue;
    const key = `${c.discipline}|${c.grade}|${c.name.trim().toLowerCase()}`;
    if (!isSent(c)) { tried.set(key, (tried.get(key) || 0) + 1); continue; }
    if (tried.get(key)) { done.push({ ...c, sessionsTried: tried.get(key) + 1 }); tried.delete(key); }
  }
  return done.reverse();
}

// ---------- Consejos ----------
export function buildInsights(sessions, settings) {
  const out = [];
  if (!sessions.length) return out;
  const sorted = sortSessions(sessions);
  const now = today();
  const last = sorted[0];
  const since = daysBetween(last.date, now);

  const streak = weekStreak(sessions);
  if (streak >= 2) out.push({ icon: '🔥', tone: 'good', title: `${streak} semanas seguidas escalando`, text: 'La constancia es lo que más hace progresar. ¡No rompas la racha!' });

  if (since >= 7) out.push({ icon: '🧗', tone: 'info', title: `Hace ${since} días de tu última sesión`, text: 'Tras una pausa larga, empieza un par de grados por debajo y calienta bien los dedos.' });
  else if (since === 0 && last.rpe >= 8) out.push({ icon: '🛌', tone: 'warn', title: 'Sesión dura hoy', text: 'Esfuerzo alto: deja al menos 48 h antes de volver a apretar regletas o desplome fuerte.' });

  // Carga aguda vs crónica (7 días vs media semanal de los 28 previos)
  const loadIn = (from, to) => sessions.filter((s) => { const d = daysBetween(s.date, now); return d >= from && d < to; })
    .reduce((a, s) => a + sessionLoad(s), 0);
  const acute = loadIn(0, 7);
  const chronic = loadIn(7, 35) / 4;
  if (chronic > 0 && acute > 0) {
    const r = acute / chronic;
    if (r > 1.5) out.push({ icon: '⚠️', tone: 'warn', title: `Carga semanal ×${r.toFixed(1)} sobre tu media`, text: 'Subidas bruscas de carga se asocian a más lesiones (sobre todo poleas). Plantéate una sesión suave o descanso.' });
    else if (r < 0.6 && sorted.length > 4) out.push({ icon: '🌱', tone: 'info', title: 'Semana más tranquila de lo habitual', text: 'Buen momento para recuperar… o para volver con energía a tus proyectos.' });
  }

  // Nuevo máximo
  const climbs = allClimbs(sessions);
  for (const disc of ['boulder', 'route']) {
    const sent = climbs.filter((c) => c.discipline === disc && isSent(c));
    if (!sent.length) continue;
    const max = Math.max(...sent.map((c) => c.grade));
    const first = sent.filter((c) => c.grade === max).sort((a, b) => a.date.localeCompare(b.date))[0];
    const older = sent.filter((c) => daysBetween(c.date, now) > 30);
    if (daysBetween(first.date, now) <= 30 && older.length && Math.max(...older.map((c) => c.grade)) < max) {
      out.push({ icon: '🏆', tone: 'good', title: `¡Nuevo máximo en ${disc === 'route' ? 'vía' : 'bloque'}: ${gradeLabel(first, settings)}!`, text: `Lo conseguiste el ${fmtDate(first.date)}. Ahora toca consolidar ese grado.` });
    }
  }

  // Siguiente objetivo por pirámide
  for (const disc of ['boulder', 'route']) {
    const sent = climbs.filter((c) => c.discipline === disc && isSent(c));
    if (sent.length < 5) continue;
    const max = Math.max(...sent.map((c) => c.grade));
    const atMax = sent.filter((c) => c.grade === max).length;
    const below = sent.filter((c) => c.grade === max - 1).length;
    const label = (g) => gradeLabel({ discipline: disc, grade: g }, settings);
    if (atMax >= 3 && below >= 5) out.push({ icon: '🚀', tone: 'good', title: `¡Lista para probar ${label(max + 1)}!`, text: `Ya has conseguido ${atMax} de ${label(max)} y ${below} de ${label(max - 1)}. El siguiente color te está esperando.` });
    else if (max > 0) out.push({ icon: '🧱', tone: 'info', title: `Afianza el ${label(max)}`, text: `Llevas ${atMax} de ${label(max)}. Consigue unos cuantos más y estarás lista para el siguiente.` });
  }

  const flashes = climbs.filter((c) => c.result === 'flash' || c.result === 'onsight').length;
  if (climbs.length >= 15) {
    const fr = flashes / climbs.length;
    if (fr > 0.6) out.push({ icon: '⚡', tone: 'info', title: `El ${Math.round(fr * 100)}% te sale a la primera`, text: '¡Genial! Prueba algún bloque del color siguiente: así es como se mejora.' });
  }


  // Mejor día
  if (sessions.length >= 8) {
    const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const by = {};
    for (const s of sessions) {
      const d = parseDate(s.date).getDay();
      const b = by[d] ||= { n: 0, sent: 0, tot: 0 };
      b.n++; b.tot += (s.climbs || []).length; b.sent += (s.climbs || []).filter(isSent).length;
    }
    const best = Object.entries(by).filter(([, b]) => b.n >= 2 && b.tot).sort((a, b) => b[1].sent / b[1].tot - a[1].sent / a[1].tot)[0];
    if (best) out.push({ icon: '📅', tone: 'info', title: `Los ${days[best[0]]} rindes mejor`, text: `Encadenas el ${Math.round(best[1].sent / best[1].tot * 100)}% de lo que pruebas. Buen día para ir a por proyectos.` });
  }

  return out;
}

// ---------- Logros por niveles ----------
// Cada familia tiene niveles: al completar uno aparece el siguiente.
function maxStreakEver(sessions) {
  const weeks = [...new Set(sessions.map((s) => weekStart(parseDate(s.date)).getTime()))].sort((a, b) => a - b);
  let best = 0; let run = 0; let prev = null;
  for (const w of weeks) { run = prev != null && Math.round((w - prev) / (7 * 86400000)) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = w; }
  return best;
}

export function achievements(allSessions, photos, extra = {}) {
  const climbs = allClimbs(allSessions);
  const sessions = allSessions.filter((s) => !s.loose);
  const sent = climbs.filter(isSent);
  const months = {};
  sessions.forEach((s) => { months[s.date.slice(0, 7)] = (months[s.date.slice(0, 7)] || 0) + 1; });
  const scale = extra.scale || [];
  const bSent = sent.filter((c) => c.discipline === 'boulder').map((c) => c.grade);
  const rSent = sent.filter((c) => c.discipline === 'route').map((c) => c.grade);
  const colorTiers = scale.map((g, i) => ({ ...g, i })).filter((g) => !g.joker);
  const routeTiers = ['5a', '5c', '6a', '6b', '6c', '7a', '7b', '7c', '8a'].map((g) => ROUTE_GRADES.indexOf(g));
  const maxB = bSent.length ? Math.max(...bSent) : -1;
  const maxR = rSent.length ? Math.max(...rSent) : -1;
  const families = [
    { key: 'sesiones', icon: '🎒', title: 'Constancia', value: sessions.length, tiers: [1, 5, 10, 25, 50, 100, 200], unit: (n) => `${n} ${n === 1 ? 'sesión' : 'sesiones'}` },
    { key: 'conseguidos', icon: '✅', title: 'Conseguidos', value: sent.length, tiers: [5, 25, 50, 100, 250, 500, 1000], unit: (n) => `${n} bloques o vías` },
    { key: 'flash', icon: '⚡', title: 'A la primera', value: climbs.filter((c) => c.result === 'flash' || c.result === 'onsight').length, tiers: [1, 10, 25, 50, 100, 250], unit: (n) => `${n} a la primera` },
    { key: 'racha', icon: '🔥', title: 'Racha', value: maxStreakEver(sessions), tiers: [2, 4, 8, 12, 26, 52], unit: (n) => `${n} semanas seguidas` },
    { key: 'mes', icon: '📆', title: 'Mes intenso', value: Math.max(0, ...Object.values(months)), tiers: [4, 6, 8, 10, 12, 15, 20], unit: (n) => `${n} sesiones en un mes` },
  ];
  if (colorTiers.length) {
    const reached = colorTiers.filter((t) => maxB >= t.i).length;
    families.push({ key: 'colores', icon: '🌈', title: 'Colores', value: reached, tiers: colorTiers.map((_, k) => k + 1), unit: (n) => `Consigue un ${colorTiers[n - 1]?.name || ''}`, doneUnit: (n) => `Primer ${colorTiers[n - 1]?.name || ''}` });
  }
  if (maxB >= 0 && colorTiers.length) {
    // Siempre hay algo que mejorar: bloques conseguidos de tu color más difícil.
    const top = colorTiers.filter((t) => t.i <= maxB).pop();
    if (top) families.push({ key: `domina-${top.i}`, icon: '👑', title: `Domina el ${top.name}`, value: bSent.filter((g) => g === top.i).length, tiers: [3, 5, 10, 20], open: true, unit: (n) => `${n} bloques ${top.name.toLowerCase().endsWith('o') ? top.name.toLowerCase().replace(/o$/, 'os') : top.name.toLowerCase()}` });
  }
  if (rSent.length) {
    const reached = routeTiers.filter((t) => maxR >= t).length;
    families.push({ key: 'vias', icon: '🪢', title: 'Grado en vía', value: reached, tiers: routeTiers.map((_, k) => k + 1), unit: (n) => `Consigue un ${ROUTE_GRADES[routeTiers[n - 1]]}`, doneUnit: (n) => `Primer ${ROUTE_GRADES[routeTiers[n - 1]]}` });
  }
  families.push(
    { key: 'sala', icon: '🧱', title: 'Bloques de la sala', value: new Set(sent.filter((c) => c.vlId).map((c) => c.vlId)).size, tiers: [1, 5, 15, 30, 60, 100], unit: (n) => `${n} ${n === 1 ? 'bloque concreto' : 'bloques concretos'} de la sala` },
    { key: 'circuito', icon: '🏆', title: 'Color completo', value: extra.completeCircuits || 0, tiers: [1, 2, 3, 4], unit: (n) => `Completa ${n === 1 ? 'un color entero' : `${n} colores enteros`} de la sala`, doneUnit: (n) => `${n === 1 ? 'Un color entero' : `${n} colores enteros`} de la sala` },
    { key: 'persistente', icon: '💪', title: 'Persistente', value: sentProjects(allSessions).length, tiers: [1, 5, 10, 25], unit: (n) => `Consigue ${n === 1 ? 'un bloque' : `${n} bloques`} que habías intentado otro día`, doneUnit: (n) => `${n} ${n === 1 ? 'bloque que se te resistía' : 'bloques que se te resistían'}` },
    { key: 'explora', icon: '🗺️', title: 'Exploradora', value: new Set(sessions.map((s) => (s.where === 'other' ? (s.gym || '').trim().toLowerCase() : 'sharma'))).size, tiers: [2, 3, 5, 10, 20], unit: (n) => `Escala en ${n} rocódromos distintos`, doneUnit: (n) => `${n} rocódromos distintos` },
    { key: 'amigas', icon: '👯', title: 'En compañía', value: sessions.filter((s) => (s.with || []).length).length, tiers: [1, 5, 10, 25], unit: (n) => `${n} ${n === 1 ? 'sesión' : 'sesiones'} con amigas` },
    { key: 'fotos', icon: '📸', title: 'Fotógrafa', value: photos || 0, tiers: [1, 5, 20, 50], unit: (n) => `${n} ${n === 1 ? 'foto' : 'fotos'}` },
  );
  const finite = new Set(['colores', 'vias', 'mes']);
  return families.map((f) => {
    // Al superar el último nivel se generan más (mismo salto que el último), así siempre hay objetivo.
    if (!finite.has(f.key)) {
      const t = [...f.tiers];
      while (t[t.length - 1] <= f.value) { const a = t[t.length - 1]; const b = t[t.length - 2] || 0; t.push(a + Math.max(1, a - b)); }
      f.tiers = t;
    }
    const level = f.tiers.filter((t) => f.value >= t).length;
    const next = f.tiers[level];
    const prev = level ? f.tiers[level - 1] : 0;
    return {
      ...f, level, max: f.tiers.length, complete: finite.has(f.key) && level === f.tiers.length,
      goal: next != null ? f.unit(next) : '¡Todo completado!',
      done: level ? (f.doneUnit || f.unit)(f.tiers[level - 1]) : null,
      progress: next != null ? Math.min(1, (f.value - prev) / (next - prev)) : 1,
    };
  });
}

// Claves de los niveles conseguidos («sesiones:3»), para detectar logros nuevos.
export function unlockedKeys(list) {
  return list.flatMap((a) => Array.from({ length: a.level }, (_, k) => `${a.key}:${k + 1}`));
}

export function fmtDate(iso, opts = { day: 'numeric', month: 'short' }) {
  return parseDate(iso).toLocaleDateString('es-ES', opts);
}

export { RESULTS, TAGS };
