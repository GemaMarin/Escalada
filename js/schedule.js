// Días de escalada: horario fijo (p. ej. jueves 19:00) + días sueltos.
// Detecta la sesión de hoy, la próxima y las que quedaron sin registrar.
import { toISO, parseDate, today } from './insights.js';

export const WEEKDAYS = [['1', 'L'], ['2', 'M'], ['3', 'X'], ['4', 'J'], ['5', 'V'], ['6', 'S'], ['0', 'D']];
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export const dayName = (iso) => DAY_NAMES[parseDate(iso).getDay()];
export const niceDate = (iso, article = true) => {
  const t = today();
  const diff = Math.round((parseDate(iso) - parseDate(t)) / 86400000);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === -1) return 'ayer';
  const d = parseDate(iso);
  return `${article ? 'el ' : ''}${DAY_NAMES[d.getDay()]} ${d.getDate()}`;
};
// «de hoy», «de ayer», «del jueves 12»
export const sessionOf = (iso) => {
  const n = niceDate(iso, false);
  return ['hoy', 'ayer', 'mañana'].includes(n) ? `de ${n}` : `del ${n}`;
};

function isPlanned(iso, sch) {
  if ((sch.extraDates || []).includes(iso)) return true;
  return (sch.days || []).map(Number).includes(parseDate(iso).getDay());
}

const minutes = (hhmm) => { const [h, m] = (hhmm || '19:00').split(':').map(Number); return h * 60 + (m || 0); };

// { today, pending, next } según el horario y las sesiones registradas.
export function planState(settings, sessions, draft) {
  const sch = settings.schedule || { days: [4], time: '19:00' };
  const sch2 = { ...sch, extraDates: settings.extraDates || [] };
  const logged = new Set(sessions.map((s) => s.date));
  if (draft?.isNew && draft.climbs?.length) logged.add(draft.date);
  const skipped = new Set(settings.skipped || []);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const t = today();
  const res = { time: sch.time || '19:00', today: null, pending: null, next: null };
  // Hoy
  if (isPlanned(t, sch2) && !logged.has(t) && !skipped.has(t)) {
    res.today = { date: t, after: nowMin >= minutes(sch.time) + 60 };
  }
  // Sin registrar (últimos 10 días; hoy cuenta si ya ha pasado la hora de la clase + 2 h)
  for (let i = 0; i <= 10; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const iso = toISO(d);
    if (i === 0 && nowMin < minutes(sch.time) + 120) continue;
    if (isPlanned(iso, sch2) && !logged.has(iso) && !skipped.has(iso) && iso >= (settings.planSince || '0')) { res.pending = iso; break; }
  }
  if (res.pending === t) res.today = null;
  // Próxima
  for (let i = res.today ? 1 : 0; i <= 14; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i);
    const iso = toISO(d);
    if (i === 0 && nowMin >= minutes(sch.time)) continue;
    if (isPlanned(iso, sch2)) { res.next = iso; break; }
  }
  return res;
}

// Calendario (.ics) con el horario semanal y aviso para registrar la sesión.
export function scheduleICS(settings) {
  const sch = settings.schedule || { days: [4], time: '19:00' };
  const days = (sch.days || []).map(Number);
  const byday = days.map((d) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d]).join(',');
  const [h, m] = (sch.time || '19:00').split(':').map(Number);
  const start = new Date(); start.setHours(h, m || 0, 0, 0);
  while (days.length && !days.includes(start.getDay())) start.setDate(start.getDate() + 1);
  const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
  const end = new Date(start); end.setHours(end.getHours() + 2);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const url = location.href.split('#')[0];
  const ev = (uid, s, e, rrule) => [
    'BEGIN:VEVENT', `UID:${uid}@cuaderno-escalada`, `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Madrid:${fmt(s)}`, `DTEND;TZID=Europe/Madrid:${fmt(e)}`, rrule,
    'SUMMARY:🧗‍♀️ Escalada', `LOCATION:${settings.gym || 'Rocódromo'}`,
    `DESCRIPTION:Al terminar\\, registra tu sesión: ${url}`, `URL:${url}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Hoy toca escalar 🧗‍♀️', 'TRIGGER:-PT2H', 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:¿Qué tal la sesión? Regístrala en el Cuaderno de escalada', 'TRIGGER;RELATED=END:PT15M', 'END:VALARM',
    'END:VEVENT',
  ].filter(Boolean);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cuaderno de escalada//ES', 'CALSCALE:GREGORIAN'];
  if (days.length) lines.push(...ev('semanal', start, end, `RRULE:FREQ=WEEKLY;BYDAY=${byday}`));
  for (const iso of settings.extraDates || []) {
    if (iso < today()) continue;
    const s = parseDate(iso); s.setHours(h, m || 0); const e = new Date(s); e.setHours(e.getHours() + 2);
    lines.push(...ev(`extra-${iso}`, s, e, ''));
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
