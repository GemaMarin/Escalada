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
  ctx.fillText(d.date + (d.with ? ` · con ${d.with}` : ''), 100, 278);
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
  ctx.fillText('Cuaderno de escalada', 164, fy - 14);
  ctx.fillStyle = '#7d7169'; ctx.font = '500 24px Outfit, system-ui, sans-serif';
  ctx.fillText(d.gym || '', 164, fy + 16);

  return new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
}
