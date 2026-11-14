// Genera data/sharma.json con los bloques y vías actuales de la sala, el plano de
// cada sector y la zona de cada bloque/vía en su foto del muro.
// Lo ejecuta GitHub Actions al publicar (y cada día). Uso: node scripts/update-sharma.mjs
// Reutiliza lo ya publicado para no volver a pedir fichas que no han cambiado.
import { writeFile } from 'node:fs/promises';

const BASE = 'https://gyms.vertical-life.info';
const GYM = 'sharma-climbing-madrid';
const OUT = new URL('../data/sharma.json', import.meta.url);
const OUT_EVENTS = new URL('../data/events.json', import.meta.url);
const EVENTS_API = 'https://sharmaclimbing.com/wp-json/tribe/events/v1/events';
const MADRID_CAT = 174; // categoría «Sharma Climbing Madrid» en la web de la sala
const PREV = process.env.PREV_URL || 'https://gemamarin.github.io/Escalada/data/sharma.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, fragment = false, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: fragment ? { Accept: 'text/javascript', 'X-Requested-With': 'XMLHttpRequest' } : {} });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.text();
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(1000 * i);
    }
  }
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const unwrap = (t) => (t.match(/\.html\("([\s\S]*)"\);?\s*$/)?.[1] ?? t)
  .replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\//g, '/').replace(/\\\\/g, '\\');

function parsePane(html, kind) {
  const start = html.indexOf(`id="${kind === 'route' ? 'routes' : 'boulders'}"`);
  if (start < 0) return [];
  const next = html.indexOf('class="tab-pane', start + 30);
  const block = html.slice(start, next > 0 ? next : undefined);
  return [...block.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, r]) => {
    const link = r.match(new RegExp(`class="${kind}_name"[^>]*href="[^"]*iframe/(\\d+)/[^"]*">([^<]*)<`));
    const sec = r.match(/class="sector"><a[^>]*iframe\/(\d+)\/[^"]*">([^<]*)</);
    if (!link) return null;
    return {
      vlId: link[1], kind,
      number: decode(r.match(new RegExp(`${kind}_number">([\\s\\S]*?)<`))?.[1] || ''),
      hold: decode(link[2]),
      holdColor: (r.match(/border-top-color:\s*([^;"]+)/)?.[1] || '#999').trim().toLowerCase(),
      grade: decode(r.match(/class="text-center grade">([^<]*)</)?.[1] || ''),
      sector: decode(sec?.[2] || ''), sectorId: sec?.[1] || null,
      setter: decode(r.match(/route_setter hidden-xs">([^<]*)</)?.[1] || ''),
      date: Number(r.match(/class="date">(\d+)/)?.[1] || 0) * 1000,
      zlags: Number(r.match(/zlags hidden-xs">\s*(\d+)/)?.[1] || 0),
      isNew: r.includes('new-small-badge'),
    };
  }).filter(Boolean);
}

function topo(html, cls) {
  const tag = html.match(new RegExp(`<div[^>]*class="${cls} [^"]*"[^>]*>`))?.[0];
  if (!tag) return null;
  const attr = (n) => tag.match(new RegExp(`${n}="([^"]*)"`))?.[1];
  try {
    const path = JSON.parse(attr('data-path') || '[]').map((p) => p.map(Number).slice(0, 2));
    const src = attr('data-image-src');
    return src && path.length ? { src, path } : null;
  } catch { return null; }
}

const strip = (h) => decode(String(h || '').replace(/<[^>]+>/g, ' ').replace(/&#8217;/g, '’').replace(/&#8211;/g, '–').replace(/&nbsp;/g, ' ')).replace(/\s+/g, ' ').trim();

// Eventos publicados en la web de la sala (pasados recientes y próximos).
async function updateEvents() {
  const from = new Date(Date.now() - 150 * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);
  const url = `${EVENTS_API}?per_page=50&categories=${MADRID_CAT}&start_date=${from}&end_date=${to}`;
  const data = JSON.parse(await get(url));
  const events = (data.events || []).map((e) => ({
    id: String(e.id), title: strip(e.title), start: e.start_date, end: e.end_date, allDay: !!e.all_day,
    url: e.url, image: e.image?.sizes?.medium?.url || e.image?.url || null,
    summary: strip(e.excerpt || e.description).slice(0, 260),
    cats: (e.categories || []).map((c) => c.name).filter((n) => !/^Sharma Climbing/.test(n)),
  }));
  await writeFile(OUT_EVENTS, JSON.stringify({ fetchedAt: Date.now(), source: 'sharmaclimbing.com', events }));
  console.log(`OK: ${events.length} eventos`);
}

const main = async () => {
  try { await updateEvents(); } catch (e) { console.warn('Eventos:', e.message); }
  const html = await get(`${BASE}/${GYM}/iframe`);
  const boulders = parsePane(html, 'boulder');
  const routes = parsePane(html, 'route');
  if (!boulders.length && !routes.length) throw new Error('Sin datos en el widget');
  let prev = {};
  try { prev = await (await fetch(PREV)).json(); } catch { /* primera vez */ }
  const sectors = {};
  for (const x of [...boulders, ...routes]) {
    if (!x.sectorId || sectors[x.sectorId]) continue;
    const old = prev.sectors?.[x.sectorId];
    let map = old?.map || null;
    if (!map) { try { map = topo(unwrap(await get(`${BASE}/en/${GYM}/iframe/${x.sectorId}/iframe_sector_zlaggables`, true)), 'zlaggable-topo-wall'); } catch (e) { console.warn(e.message); } await sleep(300); }
    sectors[x.sectorId] = { name: x.sector, kind: x.kind, map };
  }
  const topos = {}; let fetched = 0;
  for (const x of [...boulders, ...routes]) {
    if (prev.topos?.[x.vlId]) { topos[x.vlId] = prev.topos[x.vlId]; continue; }
    try {
      const frag = unwrap(await get(`${BASE}/en/${GYM}/iframe/${x.vlId}/iframe_${x.kind}_detail`, true));
      topos[x.vlId] = {
        wall: topo(frag, 'zlaggable-topo'),
        expires: frag.match(/EXPIRATION DATE:[^\d]*([\d.]+)/)?.[1] || null,
        stars: ((frag.match(/zlaggable-stars">([\s\S]*?)<\/span>/) || [])[1]?.match(/class="star"/g) || []).length,
      };
      fetched++;
    } catch (e) { console.warn(e.message); }
    await sleep(250);
  }
  const data = { fetchedAt: Date.now(), boulders, routes, sectors, topos };
  await writeFile(OUT, JSON.stringify(data));
  console.log(`OK: ${boulders.length} bloques, ${routes.length} vías, ${Object.keys(sectors).length} sectores, ${fetched} fichas nuevas`);
};

main().catch((e) => { console.error(e); process.exit(1); });
