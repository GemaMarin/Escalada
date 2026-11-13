// Datos de ejemplo para probar la app (se pueden quitar desde Ajustes).
import { uid } from './db.js';
import { boulderScale } from './model.js';
import { toISO } from './insights.js';

export function makeDemo(settings) {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const some = (arr, max) => arr.filter(() => rnd() < max / arr.length);
  const nB = boulderScale(settings).length;
  const zones = ['Cueva', 'Muro de competición', 'Placa', 'Desplome central'];
  const styles = ['placa', 'vertical', 'desplome', 'desplome', 'techo'];
  const holds = ['regletas', 'romos', 'pinzas', 'agujeros', 'cantos', 'volumenes'];
  const moves = ['dinamico', 'bloqueos', 'talon', 'puntera', 'compresion', 'coordinacion', 'equilibrio'];
  const projects = [
    { name: 'El rosa del techo', discipline: 'boulder', grade: Math.min(nB - 1, 5), styles: ['techo'], holds: ['romos'], moves: ['talon', 'compresion'] },
    { name: 'Travesía de regletas', discipline: 'boulder', grade: Math.min(nB - 1, 4), styles: ['vertical'], holds: ['regletas'], moves: ['bloqueos'] },
    { name: 'La del diedro', discipline: 'route', grade: 12, styles: ['vertical'], holds: ['regletas', 'cantos'], moves: ['resistencia'] },
  ];
  const sessions = [];
  const start = new Date(); start.setDate(start.getDate() - 75);
  const day = new Date(start);
  let n = 0;
  while (day < new Date()) {
    day.setDate(day.getDate() + 2 + Math.floor(rnd() * 3));
    if (day > new Date()) break;
    const progress = n / 28; // mejora gradual
    const type = rnd() < 0.68 ? 'boulder' : (rnd() < 0.7 ? 'route' : 'mixed');
    const climbs = [];
    const count = 6 + Math.floor(rnd() * 8);
    for (let i = 0; i < count; i++) {
      const discipline = type === 'mixed' ? (i % 2 ? 'route' : 'boulder') : type;
      if (discipline === 'route' && i > 6) break;
      const base = discipline === 'route' ? 7 + progress * 3 : 1 + progress * 2;
      const grade = Math.max(0, Math.min(discipline === 'route' ? 15 : nB - 1, Math.round(base + (rnd() * 3.2 - 1.2))));
      const hard = grade - base;
      const r = rnd();
      const result = hard > 1.3 ? (r < 0.65 ? 'project' : 'send') : hard > 0.3 ? (r < 0.25 ? 'project' : r < 0.5 ? 'flash' : 'send') : (r < 0.7 ? 'flash' : 'send');
      const st = [pick(styles)];
      climbs.push({
        id: uid(), discipline, grade, result: discipline === 'route' && result === 'flash' && rnd() < 0.5 ? 'onsight' : result,
        attempts: result === 'flash' ? 1 : 2 + Math.floor(rnd() * 5),
        ropeMode: discipline === 'route' ? (rnd() < 0.5 ? 'lead' : 'toprope') : undefined,
        styles: st[0] === 'placa' || rnd() < 0.8 ? st : [], holds: some(holds, 1.3), moves: some(moves, 1.2),
        name: '', zone: pick(zones), notes: '',
      });
    }
    // Proyectos recurrentes
    for (const p of projects) {
      if ((type === 'mixed' || type === p.discipline) && rnd() < 0.45) {
        const tries = sessions.filter((s) => s.climbs.some((c) => c.name === p.name)).length;
        const sentNow = tries >= 3 && rnd() < 0.5;
        if (sessions.some((s) => s.climbs.some((c) => c.name === p.name && c.result === 'send'))) continue;
        climbs.push({ id: uid(), ...p, result: sentNow ? 'send' : 'project', attempts: 3 + Math.floor(rnd() * 4), zone: pick(zones), notes: sentNow ? '¡Por fin! El truco era meter el talón antes.' : '' , ropeMode: p.discipline === 'route' ? 'lead' : undefined });
      }
    }
    const rpe = 5 + Math.floor(rnd() * 4);
    sessions.push({
      id: uid(), demo: true, date: toISO(day), type, duration: 60 + 15 * Math.floor(rnd() * 6), rpe,
      mood: Math.min(4, Math.max(0, Math.round(2 + rnd() * 2.4 - (rpe > 7 ? 1 : 0)))),
      notes: rnd() < 0.3 ? pick(['Muy buenas sensaciones, pies precisos.', 'Dedos algo cansados, he parado antes.', 'Sesión con amigas, mucho cachondeo y algún bloque nuevo.', 'Circuito nuevo en la cueva, ¡qué bloques más chulos!']) : '',
      climbs, createdAt: day.getTime(),
    });
    n++;
  }
  return sessions;
}
