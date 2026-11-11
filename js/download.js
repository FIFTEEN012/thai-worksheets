// Descarga del ZIP de la ficha desde una URL pública.
//
// Estrategias, en orden:
//   1. Descarga directa con fetch (funciona en GitHub, servidores propios, etc.).
//   2. Proxy de Google Apps Script, si está configurado en config.js
//      (necesario normalmente para Google Drive, que bloquea CORS).
//   3. Proxies CORS públicos como último recurso.

function config() {
  return window.OPENWORKSHEETS_CONFIG || { gasUrl: '', corsProxies: [] };
}

function isGoogleDriveUrl(url) {
  return /(^https?:\/\/)?(?:[^/]+\.)?(drive\.google\.com|drive\.usercontent\.google\.com)\//i.test(url || '');
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function readBody(resp, onProgress) {
  const total = Number(resp.headers.get('Content-Length')) || 0;
  if (!resp.body || !resp.body.getReader) {
    return new Uint8Array(await resp.arrayBuffer());
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress) onProgress(received, total);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

// บอกว่าได้อะไรกลับมาแทน ZIP (ช่วยวินิจฉัย เช่น หน้า HTML ของ Google)
function describeNotZip(bytes) {
  if (!bytes || !bytes.length) return 'ไม่ได้รับข้อมูล';
  const head = new TextDecoder().decode(bytes.slice(0, 120)).replace(/s+/g, ' ').trim();
  const b = bytes;
  const kind =
    (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ? 'รูปภาพ PNG' :
    (b[0] === 0xff && b[1] === 0xd8) ? 'รูปภาพ JPEG' :
    (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) ? 'ไฟล์ PDF' :
    (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) ? 'รูปภาพ WEBP' : '';
  if (kind) return 'ไฟล์นี้เป็น' + kind + ' ไม่ใช่ใบงาน (.owpkg): ให้เปิดไฟล์นี้ในตัวแก้ไข วางช่องคำตอบ แล้วกด ไฟล์ → บันทึกใบงาน (.owpkg) จากนั้นอัปโหลดไฟล์ .owpkg ขึ้น Drive แทน';
  if (/<!doctype html|<html/i.test(head)) return 'ได้หน้าเว็บ HTML แทนไฟล์ (มักเกิดเพราะไฟล์ไม่ได้แชร์แบบสาธารณะ)';
  return 'ได้ข้อมูลที่ไม่ใช่ ZIP (' + bytes.length + ' ไบต์): ' + head.slice(0, 60);
}

function looksLikeZip(bytes) {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

async function tryDirect(url, onProgress) {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const bytes = await readBody(resp, onProgress);
  if (!looksLikeZip(bytes)) {
    // Drive devuelve una página HTML intermedia para archivos grandes
    // o no públicos: no sirve como ZIP.
    throw new Error('ไฟล์ที่ได้ไม่ใช่ ZIP — ' + describeNotZip(bytes));
  }
  return bytes;
}

// Proxy con el protocolo "bundle" de Visor Web-ZIP, de modo que puede
// reutilizarse un despliegue ya existente de ese proyecto:
//   ?url=...&bundle=1&meta=1               → { name, totalSize, chunkSize, ... }
//   ?url=...&bundle=1&part=N&chunkSize=S   → { totalSize, size, base64, chunkSize, ... }
const GAS_CHUNK = 20 * 1024 * 1024;   // 20 MB por trozo (igual que visor-webzip)
const GAS_MAX_PARALLEL = 3;

async function gasJson(query) {
  const resp = await fetch(query, { cache: 'no-store' });
  if (!resp.ok) throw new Error('Proxy: HTTP ' + resp.status);
  return resp.json();
}

function concatParts(parts, size) {
  // ขนาดที่เซิร์ฟเวอร์แจ้งอาจเป็นขนาดหลังบีบอัด (gzip) จึงห้ามตัดข้อมูลจริงทิ้ง
  let sum = 0;
  for (const p of parts) sum += p ? p.length : 0;
  const total = Math.max(Number(size) || 0, sum);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { if (p && p.length) { out.set(p, offset); offset += p.length; } }
  return offset === total ? out : out.slice(0, offset);
}

// Metadatos del archivo en el proxy (tamaño total, trozo sugerido…), sin descargar.
async function gasMeta(gasUrl, url) {
  const data = await gasJson(gasUrl + '?url=' + encodeURIComponent(url) + '&bundle=1&meta=1&ts=' + Date.now());
  if (data && data.error) throw new Error('Proxy: ' + data.error);
  return data || {};
}

// Un trozo del archivo, con reintentos ante fallos transitorios del proxy.
async function gasPart(gasUrl, url, part, chunkSize) {
  const q = gasUrl + '?url=' + encodeURIComponent(url) + '&bundle=1&part=' + part + '&chunkSize=' + chunkSize;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await gasJson(q);
      if (data && data.error) throw new Error('Proxy: ' + data.error);
      return data || {};
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(700 * (attempt + 1));
    }
  }
  throw lastErr;
}

// Descarga a través del proxy GAS SIEMPRE por trozos (como visor-webzip): se pide
// primero la metadata y luego las partes, en paralelo si se conoce el tamaño. Así
// se evita pedir el archivo entero de una vez, que para fichas grandes hace que el
// proxy tarde mucho y acabe devolviendo 404/timeout. No requiere cambios en el GAS.
async function tryGas(url, onProgress) {
  const gasUrl = config().gasUrl;
  if (!gasUrl) throw new Error('ยังไม่ได้ตั้งค่า Apps Script');

  let chunkSize = GAS_CHUNK;
  let totalSize = 0;
  try {
    const meta = await gasMeta(gasUrl, url);
    if (meta.chunkSize) chunkSize = Number(meta.chunkSize) || chunkSize;
    totalSize = Number(meta.totalSize || meta.size) || 0;
  } catch { /* sin meta: se descarga secuencialmente desde la parte 0 */ }

  // Tamaño conocido: partes en paralelo (más rápido).
  if (totalSize > 0) {
    const totalParts = Math.ceil(totalSize / chunkSize);
    const parts = new Array(totalParts);
    let received = 0;
    let next = 0;
    const worker = async () => {
      while (next < totalParts) {
        const i = next++;
        const data = await gasPart(gasUrl, url, i, chunkSize);
        const bytes = base64ToBytes(data.base64 || '');
        parts[i] = bytes;
        received += bytes.length;
        if (onProgress) onProgress(Math.min(received, totalSize), totalSize);
      }
    };
    const workers = [];
    for (let k = 0; k < Math.min(GAS_MAX_PARALLEL, totalParts); k++) workers.push(worker());
    await Promise.all(workers);
    // ขนาดที่แจ้งมาน้อยกว่าจริง: ถ้าส่วนสุดท้ายเต็มขนาด ให้ดึงต่อจนครบ
    for (let i = totalParts; i < 1000 && parts[i - 1] && parts[i - 1].length >= chunkSize; i++) {
      const data = await gasPart(gasUrl, url, i, chunkSize);
      const bytes = base64ToBytes(data.base64 || '');
      if (!bytes.length) break;
      parts[i] = bytes;
    }
    const out = concatParts(parts, totalSize);
    if (!looksLikeZip(out)) throw new Error('Apps Script ส่งกลับมาไม่ใช่ ZIP — ' + describeNotZip(out));
    return out;
  }

  // Sin tamaño: descarga secuencial hasta que una parte venga incompleta o vacía.
  const parts = [];
  let received = 0;
  let total = 0;
  for (let part = 0; part < 1000; part++) {
    const data = await gasPart(gasUrl, url, part, chunkSize);
    if (data.chunkSize) chunkSize = Number(data.chunkSize) || chunkSize;
    if (!total && data.totalSize) total = Number(data.totalSize) || 0;
    const bytes = base64ToBytes(data.base64 || '');
    if (!bytes.length) break;
    parts.push(bytes);
    received += bytes.length;
    if (onProgress) onProgress(received, total || 0);
    if (total && received >= total) break;
    if (bytes.length < chunkSize) break; // última parte
  }
  const out = concatParts(parts);
  if (!looksLikeZip(out)) throw new Error('Apps Script ส่งกลับมาไม่ใช่ ZIP — ' + describeNotZip(out));
  return out;
}

async function tryCorsProxies(url, onProgress) {
  let lastError = null;
  for (const proxy of config().corsProxies || []) {
    const proxied = proxy.url + (proxy.encode ? encodeURIComponent(url) : url);
    try {
      return await tryDirect(proxied, onProgress);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('ไม่มีช่องทางสำรอง');
}

// Metadatos ligeros del recurso remoto (validadores HTTP) para detectar cambios
// de versión SIN descargar el archivo completo. Devuelve { etag, lastModified,
// size } o null si no se pueden obtener de forma fiable: Google Drive se sirve
// por proxy y no expone estos encabezados por CORS, y otros servidores pueden no
// permitir HEAD o no exponer los validadores. En esos casos se prefiere no
// comprobar la versión antes que descargar la ficha entera en segundo plano.
export async function fetchRemoteMeta(url) {
  if (isGoogleDriveUrl(url)) return null;
  try {
    const resp = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (!resp.ok) return null;
    const etag = resp.headers.get('ETag') || '';
    const lastModified = resp.headers.get('Last-Modified') || '';
    const size = Number(resp.headers.get('Content-Length')) || 0;
    if (!etag && !lastModified && !size) return null;
    return { etag, lastModified, size };
  } catch {
    return null;
  }
}

const inflightDownloads = new Map();

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Reintentos automáticos de toda la cadena de descarga: el proxy de Google Apps
// Script falla de forma intermitente (arranque en frío, cuotas, `user_content_key`
// caducado), y normalmente el segundo o tercer intento ya completa. Se reintenta
// la operación completa, sin tocar la lógica del proxy.
const DOWNLOAD_TRIES = 3;

// Un único intento de la cadena de estrategias: directa → proxy → alternativas.
async function attemptDownload(url, status, onProgress) {
  const errors = [];
  const preferGas = isGoogleDriveUrl(url) && Boolean(config().gasUrl);

  if (!preferGas) {
    status('กำลังดาวน์โหลดใบงาน…');
    try {
      return await tryDirect(url, onProgress);
    } catch (e) {
      errors.push('ดาวน์โหลดตรง: ' + e.message);
    }
  }

  if (config().gasUrl) {
    status(preferGas ? 'กำลังเชื่อมต่อ Google Drive…' : 'กำลังดาวน์โหลดผ่าน Apps Script…');
    try {
      return await tryGas(url, onProgress);
    } catch (e) {
      errors.push('Apps Script: ' + e.message);
    }
  }

  status('กำลังลองช่องทางสำรอง…');
  try {
    return await tryCorsProxies(url, onProgress);
  } catch (e) {
    errors.push('ช่องทางสำรอง: ' + e.message);
  }

  const err = new Error(
    'ดาวน์โหลดใบงานไม่สำเร็จ ตรวจสอบว่าไฟล์แชร์แบบ «ทุกคนที่มีลิงก์» และลิงก์ถูกต้อง\n' +
    'รายละเอียด: ' + errors.join(' · ')
  );
  err.detail = errors;
  throw err;
}

// Descarga el ZIP y devuelve sus bytes (Uint8Array).
// onStatus(texto) y onProgress(recibido, total) son opcionales.
export async function downloadZip(url, { onStatus, onProgress } = {}) {
  const key = String(url || '').trim();
  if (inflightDownloads.has(key)) return inflightDownloads.get(key);

  const status = onStatus || (() => {});
  const task = (async () => {
    let lastError;
    for (let intento = 1; intento <= DOWNLOAD_TRIES; intento++) {
      try {
        return await attemptDownload(url, status, onProgress);
      } catch (e) {
        lastError = e;
        if (intento < DOWNLOAD_TRIES) {
          status('ดาวน์โหลดไม่สำเร็จ กำลังลองใหม่…');
          await sleep(800 * intento);
        }
      }
    }
    throw lastError;
  })();

  inflightDownloads.set(key, task);
  try {
    return await task;
  } finally {
    inflightDownloads.delete(key);
  }
}
