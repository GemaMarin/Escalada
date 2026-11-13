// Almacenamiento local con IndexedDB: sesiones, fotos y ajustes.
// Todo vive en el navegador del dispositivo (no hay servidor).
const DB_NAME = 'cuaderno-escalada';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  async all(store) {
    const d = await open();
    return reqP(d.transaction(store).objectStore(store).getAll());
  },
  async get(store, key) {
    const d = await open();
    return reqP(d.transaction(store).objectStore(store).get(key));
  },
  put(store, value) { return tx(store, 'readwrite', (s) => { s.put(value); }); },
  putMany(store, values) { return tx(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); }); },
  del(store, key) { return tx(store, 'readwrite', (s) => { s.delete(key); }); },
  delMany(store, keys) { return tx(store, 'readwrite', (s) => { keys.forEach((k) => s.delete(k)); }); },
  clear(store) { return tx(store, 'readwrite', (s) => { s.clear(); }); },
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Comprime una imagen a JPEG (máx. 1600 px) para no llenar el móvil.
export async function compressImage(file, max = 1600, quality = 0.82) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', quality));
}

export const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

export async function dataURLToBlob(url) {
  const res = await fetch(url);
  return res.blob();
}
