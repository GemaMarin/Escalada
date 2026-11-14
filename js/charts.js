// Gráficos SVG ligeros, sin dependencias.
import { BODY_PARTS } from './model.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortWeek = (d) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');

// Línea de progreso: máximo semanal y media del top-5.
export function progressChart(data, labelFor, { color = 'var(--accent)' } = {}) {
  const W = 340, H = 190, L = 44, R = 10, T = 14, B = 26;
  const vals = data.flatMap((d) => [d.max, d.avg]).filter((v) => v != null);
  if (!vals.length) return '<p class="muted small">Aún no hay encadenados en las últimas semanas.</p>';
  let lo = Math.floor(Math.min(...vals)) - 1, hi = Math.ceil(Math.max(...vals)) + 1;
  lo = Math.max(0, lo);
  if (hi - lo < 3) hi = lo + 3;
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, data.length - 1);
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let grid = '';
  const step = Math.max(1, Math.ceil((hi - lo) / 5));
  for (let g = lo; g <= hi; g += step) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" class="grid"/>`
      + `<text x="${L - 6}" y="${y(g) + 4}" text-anchor="end" class="axis">${esc(labelFor(g))}</text>`;
  }
  data.forEach((d, i) => {
    if (i % 3 === (data.length - 1) % 3) grid += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="axis">${shortWeek(d.week)}</text>`;
  });
  const path = (key) => {
    let p = ''; let pen = false;
    data.forEach((d, i) => { if (d[key] == null) { pen = false; return; } p += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`; pen = true; });
    return p;
  };
  const dots = data.map((d, i) => (d.max == null ? '' : `<circle cx="${x(i)}" cy="${y(d.max)}" r="4" fill="${color}"><title>${shortWeek(d.week)}: máx ${esc(labelFor(d.max))} · ${d.count} encadenados</title></circle>`)).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Progreso semanal">
    ${grid}
    <path d="${path('avg')}" fill="none" stroke="var(--accent-2)" stroke-width="2" stroke-dasharray="4 4" stroke-linecap="round"/>
    <path d="${path('max')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
  </svg>
  <div class="legend"><span><i style="background:${color}"></i>Máximo semanal</span><span><i class="dash"></i>Media de tus 5 mejores</span></div>`;
}

// Pirámide de grados.
export function pyramidChart(rows, labelFor, colorFor) {
  if (!rows.length) return '<p class="muted small">Registra algunas escaladas para ver tu pirámide.</p>';
  const max = Math.max(...rows.map((r) => r.flash + r.send + r.project), 1);
  return `<div class="pyramid">${rows.map((r) => {
    const tot = r.flash + r.send + r.project;
    const pct = (v) => (v / max) * 100;
    return `<div class="pyr-row">
      <span class="grade sm" style="${gradeStyle(colorFor(r.grade))}">${esc(labelFor(r.grade))}</span>
      <div class="pyr-bar" title="${r.flash} flash · ${r.send} encadenados · ${r.project} en proyecto">
        <span class="pseg flash" style="width:${pct(r.flash)}%"></span><span class="pseg send" style="width:${pct(r.send)}%"></span><span class="pseg proj" style="width:${pct(r.project)}%"></span>
      </div><span class="pyr-n">${tot || ''}</span></div>`;
  }).join('')}</div>
  <div class="legend"><span><i class="flash"></i>Flash / a vista</span><span><i class="send"></i>Encadenado</span><span><i class="proj"></i>Proyecto</span></div>`;
}

// Volumen semanal en barras apiladas.
export function volumeChart(data) {
  const W = 340, H = 140, L = 24, R = 6, T = 10, B = 22;
  const max = Math.max(...data.map((d) => d.boulder + d.route), 1);
  const bw = (W - L - R) / data.length;
  const y = (v) => (H - T - B) * (v / max);
  let out = '';
  for (let g = 0; g <= max; g += Math.max(1, Math.ceil(max / 4))) {
    const yy = H - B - y(g);
    out += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="grid"/><text x="${L - 4}" y="${yy + 4}" text-anchor="end" class="axis">${g}</text>`;
  }
  data.forEach((d, i) => {
    const x = L + i * bw + 3; const w = bw - 6;
    const hb = y(d.boulder), hr = y(d.route);
    out += `<g><title>Semana del ${shortWeek(d.week)}: ${d.boulder} bloques, ${d.route} vías</title>`
      + (hb ? `<rect x="${x}" y="${H - B - hb}" width="${w}" height="${hb}" rx="3" fill="var(--accent)"/>` : '')
      + (hr ? `<rect x="${x}" y="${H - B - hb - hr}" width="${w}" height="${hr}" rx="3" fill="var(--accent-2)"/>` : '')
      + '</g>';
    if (i % 3 === (data.length - 1) % 3) out += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle" class="axis">${shortWeek(d.week)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Volumen semanal">${out}</svg>
  <div class="legend"><span><i style="background:var(--accent)"></i>Bloques</span><span><i style="background:var(--accent-2)"></i>Vías</span></div>`;
}

// Calendario tipo "heatmap" de las últimas semanas.
export function calendarHeatmap(sessions, weeks = 18) {
  const byDay = {};
  for (const s of sessions) byDay[s.date] = (byDay[s.date] || 0) + Math.max(1, (s.climbs || []).length);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7 * (weeks - 1));
  const max = Math.max(...Object.values(byDay), 1);
  const cell = 15, gap = 3, L = 18, T = 14;
  let out = '';
  ['L', '', 'X', '', 'V', '', 'D'].forEach((d, i) => { if (d) out += `<text x="0" y="${T + i * (cell + gap) + 11}" class="axis">${d}</text>`; });
  const todayT = new Date().setHours(0, 0, 0, 0);
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(start); day.setDate(start.getDate() + w * 7 + d);
      if (day.getTime() > todayT) continue;
      if (d === 0 && day.getMonth() !== lastMonth) {
        lastMonth = day.getMonth();
        out += `<text x="${L + w * (cell + gap)}" y="9" class="axis">${day.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}</text>`;
      }
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      const v = byDay[iso] || 0;
      const fill = v ? `color-mix(in oklab, var(--accent) ${Math.round(30 + 70 * v / max)}%, var(--surface-2))` : 'var(--surface-2)';
      out += `<rect x="${L + w * (cell + gap)}" y="${T + d * (cell + gap)}" width="${cell}" height="${cell}" rx="3" fill="${fill}"><title>${day.toLocaleDateString('es-ES')}${v ? `: ${v} escaladas` : ''}</title></rect>`;
    }
  }
  const W = L + weeks * (cell + gap), H = T + 7 * (cell + gap);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart heat" role="img" aria-label="Calendario de sesiones">${out}</svg>`;
}

// Silueta corporal (frente y espalda) coloreada según la carga relativa.
export function bodyMap(total, max) {
  const f = (p) => {
    const v = max ? total[p] / max : 0;
    return `fill="color-mix(in oklab, var(--heat) ${Math.round(v * 100)}%, var(--body-base))" data-part="${p}"`;
  };
  const neutral = 'fill="var(--body-base)"';
  const t = (p) => `<title>${BODY_PARTS[p]}: ${max ? Math.round((total[p] / max) * 100) : 0}% del máximo</title>`;
  const figure = (ox, back) => `
    <g transform="translate(${ox},0)">
      <circle cx="55" cy="18" r="12" ${neutral}/>
      <rect x="50" y="29" width="10" height="8" rx="3" ${neutral}/>
      ${back
        ? `<path d="M38 40 Q55 34 72 40 L70 82 Q55 90 40 82 Z" ${f('espalda')}>${t('espalda')}</path>`
        : `<path d="M40 40 Q55 35 70 40 L69 62 L41 62 Z" ${neutral}/>
           <rect x="42" y="62" width="26" height="28" rx="6" ${f('core')}>${t('core')}</rect>`}
      <circle cx="36" cy="44" r="8.5" ${f('hombros')}>${t('hombros')}</circle>
      <circle cx="74" cy="44" r="8.5" ${f('hombros')}>${t('hombros')}</circle>
      <rect x="23" y="50" width="11" height="26" rx="5.5" ${back ? neutral : f('biceps')}>${back ? '' : t('biceps')}</rect>
      <rect x="76" y="50" width="11" height="26" rx="5.5" ${back ? neutral : f('biceps')}>${back ? '' : t('biceps')}</rect>
      <rect x="19" y="78" width="11" height="28" rx="5.5" transform="rotate(8 24 92)" ${f('antebrazos')}>${t('antebrazos')}</rect>
      <rect x="80" y="78" width="11" height="28" rx="5.5" transform="rotate(-8 86 92)" ${f('antebrazos')}>${t('antebrazos')}</rect>
      <circle cx="21" cy="113" r="6.5" ${f('dedos')}>${t('dedos')}</circle>
      <circle cx="89" cy="113" r="6.5" ${f('dedos')}>${t('dedos')}</circle>
      ${back ? `<rect x="40" y="84" width="30" height="22" rx="9" ${f('cadera')}>${t('cadera')}</rect>`
        : `<rect x="40" y="91" width="30" height="15" rx="6" ${f('cadera')}>${t('cadera')}</rect>`}
      <rect x="41" y="107" width="13" height="62" rx="6.5" ${f('piernas')}>${t('piernas')}</rect>
      <rect x="56" y="107" width="13" height="62" rx="6.5" ${f('piernas')}>${t('piernas')}</rect>
      <rect x="42" y="171" width="11" height="44" rx="5.5" ${f('piernas')}>${t('piernas')}</rect>
      <rect x="57" y="171" width="11" height="44" rx="5.5" ${f('piernas')}>${t('piernas')}</rect>
      <text x="55" y="232" text-anchor="middle" class="axis">${back ? 'Espalda' : 'Frente'}</text>
    </g>`;
  return `<svg viewBox="0 0 230 238" class="body-map" role="img" aria-label="Mapa de carga corporal">${figure(0, false)}${figure(120, true)}</svg>`;
}

export function gradeStyle(color) {
  return `--g:${color};--gt:${textOn(color)}`;
}

export function textOn(color) {
  if (!color?.startsWith('#')) return '#fff';
  let h = color.slice(1); if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111827' : '#fff';
}

// Barras semanales: altura = lo más difícil conseguido esa semana, con su color.
export function weeklyBars(data, labelFor, colorFor, maxIndex) {
  const W = 340, H = 170, L = 6, R = 6, T = 26, B = 24;
  if (!data.some((d) => d.max != null)) return '<p class="muted small">Cuando registres sesiones verás aquí tu nivel de cada semana.</p>';
  const bw = (W - L - R) / data.length;
  const top = Math.max(maxIndex, ...data.map((d) => d.max ?? 0)) + 1;
  let out = '';
  data.forEach((d, i) => {
    const x = L + i * bw + 3; const w = bw - 6;
    if (d.max == null) {
      out += `<rect x="${x}" y="${H - B - 4}" width="${w}" height="4" rx="2" fill="var(--surface-2)"/>`;
    } else {
      const h = Math.max(10, (H - T - B) * ((d.max + 1) / top));
      const c = colorFor(d.max);
      out += `<g><title>Semana del ${shortWeek(d.week)}: ${esc(labelFor(d.max))} · ${d.count} conseguidos</title>
        <rect x="${x}" y="${H - B - h}" width="${w}" height="${h}" rx="6" fill="${c}" stroke="rgb(0 0 0 / .12)"/>
        ${i === data.length - 1 || d.max >= Math.max(...data.map((z) => z.max ?? -1)) ? `<text x="${x + w / 2}" y="${H - B - h - 6}" text-anchor="middle" class="axis strong">${esc(labelFor(d.max))}</text>` : ''}</g>`;
    }
    if (i % 3 === (data.length - 1) % 3) out += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle" class="axis">${shortWeek(d.week)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Nivel por semana">${out}</svg>`;
}

// Conseguidos e intentados por color/grado.
export function colorBars(rows) {
  const max = Math.max(...rows.map((r) => r.sent + r.tried), 1);
  return `<div class="cbars">${rows.map((r) => `<div class="cbar">
      <span class="grade sm" style="${gradeStyle(r.color)}">${esc(r.label)}</span>
      <div class="cbar-track"><i style="width:${(r.sent / max) * 100}%;background:${r.color}"></i><i class="tried" style="width:${(r.tried / max) * 100}%;--c:${r.color}"></i></div>
      <small>${r.sent}${r.tried ? ` <em>+${r.tried}</em>` : ''}</small></div>`).join('')}</div>
    <div class="legend"><span><i style="background:var(--text)"></i>Conseguidos</span><span><i class="tried-k"></i>Intentados</span></div>`;
}
