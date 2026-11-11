// สร้างไฟล์ใบงาน (.owpkg) บนเซิร์ฟเวอร์ จาก JSON รูปแบบเดียวกับที่ AI ส่งให้ตัวแก้ไข
// ใช้ parseImport/layoutFields ของแอปเอง (js/aiimport.js) เพื่อให้ผลเหมือนในเว็บ
import zlib from 'node:zlib';
import JSZip from 'jszip';

// js/i18n.js อ่านภาษาจาก localStorage ตอนเรียก t(): ให้เป็นภาษาไทยเสมอ
if (!globalThis.localStorage) {
  globalThis.localStorage = { getItem: () => 'th', setItem() {}, removeItem() {} };
}

let appMods = null;
async function app() {
  if (!appMods) {
    const [ai, zipio] = await Promise.all([import('../../js/aiimport.js'), import('../../js/zipio.js')]);
    appMods = { ...ai, newManifest: zipio.newManifest };
  }
  return appMods;
}

export async function aiTypeSpecs() {
  const { AI_TYPES } = await app();
  return AI_TYPES;
}

// หน้า A4 สีขาว 1600x2263 (ขนาดเดียวกับหน้าว่างของตัวแก้ไข)
let pagePng = null;
function whitePage() {
  if (pagePng) return pagePng;
  const W = 1600, H = 2263;
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + W * 3, 255); row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: H }, () => row));
  pagePng = {
    w: W, h: H,
    bytes: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
  };
  return pagePng;
}

// spec = { title, instructions, author, classes[], items[] }
// คืนค่า { id, manifest, bytes, warnings, fields }
export async function buildWorksheet(spec, { teacherCode, apiUrl }) {
  const { parseImport, layoutFields, newManifest } = await app();
  const res = parseImport(JSON.stringify({ title: spec.title, instructions: spec.instructions, items: spec.items }));
  if (!res.ok) {
    const err = new Error('JSON ของใบงานไม่ถูกต้อง: ' + (res.errors || []).join(' / '));
    err.userFacing = true;
    throw err;
  }
  const layout = layoutFields(res.data.items);
  const page = whitePage();
  const m = newManifest();
  m.title = String(res.data.title || spec.title || '').slice(0, 300);
  m.author = String(spec.author || '').slice(0, 120);
  m.instructions = String(res.data.instructions || '');
  m.lang = 'th';
  m.settings.fontFamily = 'sarabun';
  m.settings.onlineSubmit = {
    enabled: true,
    api: apiUrl,
    teacher: teacherCode,
    classes: (Array.isArray(spec.classes) ? spec.classes : []).map(c => String(c).trim()).filter(Boolean).slice(0, 100)
  };
  const zip = new JSZip();
  layout.forEach((fields, i) => {
    const path = `pages/page-${i + 1}.png`;
    zip.file(path, page.bytes);
    m.pages.push({ image: path, w: page.w, h: page.h, fields, bgColor: '#ffffff', blank: true });
  });
  zip.file('manifest.json', JSON.stringify(m, null, 2));
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { id: m.id, manifest: m, bytes, warnings: res.errors || [], fields: layout.reduce((a, p) => a + p.length, 0) };
}
