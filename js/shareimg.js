// Genera una imagen bonita (1080×1350) con el resumen de una sesión para compartir.
import { textOn } from './charts.js';

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); }
  ctx.closePath();
}

function pill(ctx, x, y, text, color, h = 64, font = 34) {
  ctx.font = `700 ${font}px Outfit, system-ui, sans-serif`;
  const w = Math.max(h * 1.6, ctx.measureText(text).width + 44);
  rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.stroke();
  ctx.fillStyle = textOn(color.startsWith('#') ? color : '#888');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  return w;
}

export async function sessionImage(d) {
  try { await document.fonts?.load('800 60px Outfit'); await document.fonts?.load('500 30px Outfit'); } catch { /* sin fuentes */ }
  const W = 1080; const H = 1350;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f7f3ee'; ctx.fillRect(0, 0, W, H);

  // Cabecera naranja
  const g = ctx.createLinearGradient(0, 0, W, 560);
  g.addColorStop(0, '#ff5a1f'); g.addColorStop(1, '#ff9a3c');
  rr(ctx, 40, 40, W - 80, 540, 56); ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(W - 120, 90, 230, 0, Math.PI * 2); ctx.fill(); ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '700 32px Outfit, system-ui, sans-serif';
  ctx.fillText(d.name ? d.name.toUpperCase() : 'MI SESIÓN', 100, 130);
  ctx.fillStyle = '#fff'; ctx.font = '800 76px Outfit, system-ui, sans-serif';
  ctx.fillText(d.title, 100, 220);
  ctx.font = '500 36px Outfit, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.fillText(d.date + (d.with ? ` · con ${d.with}` : d.solo ? ' · sola' : ''), 100, 278);
  if (d.mood) { ctx.font = '110px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'right'; ctx.fillText(d.mood, W - 100, 230); ctx.textAlign = 'left'; }

  // Números grandes
  const stats = [[d.sent, 'conseguidos'], [d.flash, 'a la primera'], [d.tried, 'intentados']];
  stats.forEach(([n, l], i) => {
    const x = 100 + i * 300;
    ctx.fillStyle = '#fff'; ctx.font = '800 120px Outfit, system-ui, sans-serif'; ctx.fillText(String(n), x, 460);
    ctx.font = '600 32px Outfit, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText(l, x, 512);
  });

  // Por color
  let y = 660;
  ctx.fillStyle = '#1a1512'; ctx.font = '800 44px Outfit, system-ui, sans-serif';
  ctx.fillText(d.rowsTitle, 80, y);
  if (d.hardest) {
    ctx.font = '700 30px Outfit, system-ui, sans-serif';
    const tw = ctx.measureText(d.hardest.label).width + 44;
    pill(ctx, W - 80 - tw, y - 42, d.hardest.label, d.hardest.color, 56, 30);
    ctx.fillStyle = '#7d7169'; ctx.font = '600 28px Outfit, system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('Lo más difícil', W - 96 - tw, y - 6); ctx.textAlign = 'left';
  }
  y += 40;
  const rows = d.rows.slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => r.sent + r.tried));
  const rowH = rows.length > 6 ? 66 : 84;
  rows.forEach((r) => {
    pill(ctx, 80, y, r.label, r.color, 56, 30);
    const bx = 330; const bw = 560; const bh = 30; const by = y + 13;
    rr(ctx, bx, by, bw, bh, bh / 2); ctx.fillStyle = '#ebe3da'; ctx.fill();
    const sw = (r.sent / max) * bw; const tw = (r.tried / max) * bw;
    if (sw) { rr(ctx, bx, by, Math.max(sw, bh), bh, bh / 2); ctx.fillStyle = r.color; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 2; ctx.stroke(); }
    if (tw) { ctx.save(); ctx.globalAlpha = 0.35; rr(ctx, bx + sw, by, Math.max(tw, bh / 2), bh, bh / 2); ctx.fillStyle = r.color; ctx.fill(); ctx.restore(); }
    ctx.fillStyle = '#1a1512'; ctx.font = '700 32px Outfit, system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(`${r.sent ? `✓${r.sent}` : ''}${r.tried ? `  ↻${r.tried}` : ''}`, W - 80, y + 40); ctx.textAlign = 'left';
    y += rowH;
  });
  if (!rows.length) { ctx.font = '500 34px Outfit, system-ui, sans-serif'; ctx.fillStyle = '#7d7169'; ctx.fillText('Sesión sin bloques apuntados', 80, y + 40); y += 80; }

  // Pie: logo + nombre de la app
  const fy = H - 70;
  ctx.fillStyle = '#ff5a1f'; rr(ctx, 80, fy - 46, 64, 64, 18); ctx.fill();
  ctx.fillStyle = '#1d1714';
  ctx.beginPath(); ctx.moveTo(88, fy + 8); ctx.lineTo(106, fy - 22); ctx.lineTo(114, fy - 10); ctx.lineTo(122, fy - 18); ctx.lineTo(136, fy + 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1a1512'; ctx.font = '700 30px Outfit, system-ui, sans-serif';
  ctx.fillText('Mi Escalada', 164, fy - 14);
  ctx.fillStyle = '#7d7169'; ctx.font = '500 24px Outfit, system-ui, sans-serif';
  ctx.fillText(d.gym || '', 164, fy + 16);

  return new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
}

function loadImg(src) {
  return new Promise((res) => { if (!src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}

// Imagen de «Mi progreso» (1080×1350): nivel, números, colores y últimas semanas.
export async function progressImage(d) {
  try { await document.fonts?.load('800 60px Outfit'); await document.fonts?.load('500 30px Outfit'); } catch { /* sin fuentes */ }
  const W = 1080; const H = 1350;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f7f3ee'; ctx.fillRect(0, 0, W, H);

  // Cabecera
  const g = ctx.createLinearGradient(0, 0, W, 470);
  g.addColorStop(0, '#ff5a1f'); g.addColorStop(1, '#ff9a3c');
  rr(ctx, 40, 40, W - 80, 440, 56); ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(W - 110, 80, 240, 0, Math.PI * 2); ctx.fill(); ctx.restore();

  // Foto o inicial
  const av = await loadImg(d.avatar);
  const ax = 100; const ay = 110; const ar = 70;
  ctx.save(); ctx.beginPath(); ctx.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2); ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fill(); ctx.clip();
  if (av) { const s = Math.max((ar * 2) / av.width, (ar * 2) / av.height); ctx.drawImage(av, ax + ar - (av.width * s) / 2, ay + ar - (av.height * s) / 2, av.width * s, av.height * s); }
  else { ctx.fillStyle = '#fff'; ctx.font = '800 70px Outfit, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText((d.name || '🧗')[0].toUpperCase(), ax + ar, ay + ar + 25); ctx.textAlign = 'left'; }
  ctx.restore();
  ctx.lineWidth = 6; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2); ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '700 30px Outfit, system-ui, sans-serif';
  ctx.fillText('MI PROGRESO', 270, 150);
  ctx.fillStyle = '#fff'; ctx.font = '800 72px Outfit, system-ui, sans-serif';
  ctx.fillText(d.name || 'Escaladora', 270, 222);
  ctx.font = '500 32px Outfit, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.fillText(d.since || '', 270, 268);

  // Nivel (medalla)
  if (d.level) {
    const mx = 170; const my = 380; const mr = 62;
    ctx.beginPath(); ctx.arc(mx, my, mr + 10, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fillStyle = d.level.color; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.stroke();
    ctx.fillStyle = textOn(d.level.color.startsWith('#') ? d.level.color : '#888'); ctx.textAlign = 'center';
    ctx.font = '800 56px Outfit, system-ui, sans-serif'; ctx.fillText(String(d.level.num), mx, my + 14);
    ctx.font = '700 18px Outfit, system-ui, sans-serif'; ctx.fillText('NIVEL', mx, my + 40); ctx.textAlign = 'left';
    ctx.fillStyle = '#fff'; ctx.font = '600 30px Outfit, system-ui, sans-serif'; ctx.fillText('Mi color', 270, 362);
    ctx.font = '800 60px Outfit, system-ui, sans-serif'; ctx.fillText(d.level.name, 270, 422);
    if (d.level.next) { ctx.font = '600 28px Outfit, system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText(`Siguiente: ${d.level.next}`, W - 90, 422); ctx.textAlign = 'left'; }
  }

  // Números
  const stats = d.stats.slice(0, 4);
  const cw = (W - 160 - 30 * (stats.length - 1)) / stats.length;
  stats.forEach(([n, l], i) => {
    const x = 80 + i * (cw + 30); const y = 520;
    rr(ctx, x, y, cw, 150, 28); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#e8e0d6'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#1a1512'; ctx.font = '800 64px Outfit, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(n), x + cw / 2, y + 82);
    let fs = 26; ctx.font = `600 ${fs}px Outfit, system-ui, sans-serif`;
    while (ctx.measureText(l).width > cw - 24 && fs > 16) { fs -= 1; ctx.font = `600 ${fs}px Outfit, system-ui, sans-serif`; }
    ctx.fillStyle = '#7d7169'; ctx.fillText(l, x + cw / 2, y + 122); ctx.textAlign = 'left';
  });

  // Por color
  let y = 760;
  ctx.fillStyle = '#1a1512'; ctx.font = '800 40px Outfit, system-ui, sans-serif'; ctx.fillText(d.rowsTitle || 'Conseguidos por color', 80, y); y += 30;
  const rows = d.rows.slice(0, 7);
  const max = Math.max(1, ...rows.map((r) => r.sent));
  rows.forEach((r) => {
    pill(ctx, 80, y, r.label, r.color, 50, 27);
    const bx = 320; const bw = 580; const bh = 26; const by = y + 12;
    rr(ctx, bx, by, bw, bh, bh / 2); ctx.fillStyle = '#ebe3da'; ctx.fill();
    if (r.sent) { rr(ctx, bx, by, Math.max(bh, (r.sent / max) * bw), bh, bh / 2); ctx.fillStyle = r.color; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.fillStyle = '#1a1512'; ctx.font = '700 30px Outfit, system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(String(r.sent), W - 80, y + 36); ctx.textAlign = 'left';
    y += 62;
  });

  // Últimas semanas
  if (d.weeks?.some((w) => w.color)) {
    const top = Math.max(y + 10, 1150);
    ctx.fillStyle = '#7d7169'; ctx.font = '600 26px Outfit, system-ui, sans-serif'; ctx.fillText('Mi nivel, semana a semana', 80, top - 14);
    const n = d.weeks.length; const gap = 10; const bw = (W - 160 - gap * (n - 1)) / n; const maxH = 70;
    d.weeks.forEach((w, i) => {
      const h = w.color ? Math.max(10, maxH * w.h) : 6;
      rr(ctx, 80 + i * (bw + gap), top + maxH - h, bw, h, 8); ctx.fillStyle = w.color || '#e5ddd3'; ctx.fill();
    });
  }

  // Pie
  const fy = H - 46;
  ctx.fillStyle = '#ff5a1f'; rr(ctx, W - 380, fy - 40, 52, 52, 14); ctx.fill();
  ctx.fillStyle = '#1d1714';
  ctx.beginPath(); ctx.moveTo(W - 373, fy + 4); ctx.lineTo(W - 358, fy - 22); ctx.lineTo(W - 351, fy - 12); ctx.lineTo(W - 344, fy - 19); ctx.lineTo(W - 333, fy + 4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1a1512'; ctx.font = '700 28px Outfit, system-ui, sans-serif'; ctx.fillText('Mi Escalada', W - 314, fy - 12);
  ctx.fillStyle = '#7d7169'; ctx.font = '500 22px Outfit, system-ui, sans-serif'; ctx.fillText(d.gym || '', W - 314, fy + 14);

  return new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
}
