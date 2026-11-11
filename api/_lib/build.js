// สร้างไฟล์ใบงาน (.owpkg) บนเซิร์ฟเวอร์ จาก JSON รูปแบบเดียวกับที่ AI ส่งให้ตัวแก้ไข
// ใช้ parseImport/layoutFields ของแอปเอง (js/aiimport.js) แล้วตกแต่งด้วยธีม:
// แถบหัวเรื่อง กล่องคำถาม ป้ายเลขข้อ สีพื้นหน้า สติกเกอร์ และภาพประกอบ SVG
// ทุกอย่างเป็นช่องปกติของตัวแก้ไข ครูจึงย้าย/แก้/ลบได้ทั้งหมด
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GRAPHICS_DIR = path.resolve(HERE, '../../graphics');

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

// ---------------------------------------------------------------------------
// ธีม
// ---------------------------------------------------------------------------

export const THEMES = {
  playful: { name: 'สดใส (ประถม)', accent: '#FF6B6B', accent2: '#FFC83D', paper: '#FFFBF2', card: '#FFF1D6', text: '#3B2F2F', font: 'notothai', sticker: 'star', cards: true },
  ocean: { name: 'ท้องทะเล', accent: '#2F80ED', accent2: '#56CCF2', paper: '#F5FAFF', card: '#E3F2FD', text: '#17324D', font: 'sarabun', sticker: 'globe', cards: true },
  nature: { name: 'ธรรมชาติ / วิทยาศาสตร์', accent: '#2E7D32', accent2: '#A5D6A7', paper: '#F7FBF4', card: '#E6F4E1', text: '#1B3A1E', font: 'sarabun', sticker: 'leaf', cards: true },
  space: { name: 'อวกาศ', accent: '#4B3BBF', accent2: '#B3A8FF', paper: '#F7F5FF', card: '#ECE8FF', text: '#22195C', font: 'sarabun', sticker: 'planet', cards: true },
  thai: { name: 'ไทยประเพณี', accent: '#8E2C1F', accent2: '#D4A017', paper: '#FFFDF6', card: '#FBF0D9', text: '#3E1A12', font: 'sarabun', sticker: null, band: 'thai-pattern', cards: true },
  clean: { name: 'เรียบหรู (มัธยม)', accent: '#334E68', accent2: '#9FB3C8', paper: '#FFFFFF', card: '#F0F4F8', text: '#102A43', font: 'sarabun', sticker: 'book', cards: true },
  exam: { name: 'แบบทดสอบทางการ', accent: '#222222', accent2: '#999999', paper: '#FFFFFF', card: null, text: '#111111', font: 'sarabun', sticker: null, cards: false, plainHeader: true }
};
export const THEME_IDS = Object.keys(THEMES);

let _graphics = null;
export function graphicsIndex() {
  if (!_graphics) {
    try { _graphics = JSON.parse(fs.readFileSync(path.join(GRAPHICS_DIR, 'index.json'), 'utf8')); } catch { _graphics = []; }
  }
  return _graphics;
}
function libGraphic(id) {
  const g = graphicsIndex().find(x => x.id === id);
  if (!g) return null;
  try { return { bytes: fs.readFileSync(path.join(GRAPHICS_DIR, id + '.svg')), ratio: g.ratio }; } catch { return null; }
}

// ---------------------------------------------------------------------------
// SVG จาก AI: ทำให้ปลอดภัยและพอดี (แสดงผ่าน <img> จึงไม่รันสคริปต์อยู่แล้ว แต่กันไว้อีกชั้น)
// ---------------------------------------------------------------------------

export function sanitizeSvg(raw) {
  let s = String(raw || '').trim();
  const start = s.indexOf('<svg');
  const end = s.lastIndexOf('</svg>');
  if (start < 0 || end < 0) return null;
  s = s.slice(start, end + 6);
  if (s.length > 80000) return null;
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/<(iframe|object|embed|audio|video)[\s\S]*?(<\/\1\s*>|\/>)/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
    .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none')
    .replace(/<\?xml[^>]*>/gi, '');
  if (!/xmlns=/.test(s.slice(0, 200))) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  const vb = s.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  const ratio = vb ? Math.max(0.15, Math.min(4, Number(vb[2]) / Number(vb[1]))) : 0.75;
  return { bytes: Buffer.from(s, 'utf8'), ratio };
}

// ---------------------------------------------------------------------------
// หน้ากระดาษ (PNG สีพื้นทึบ 1600x2263 เท่ากับหน้าว่างของตัวแก้ไข)
// ---------------------------------------------------------------------------

const PAGE_W = 1600, PAGE_H = 2263;
const pngCache = new Map();
function solidPage(hex) {
  if (pngCache.has(hex)) return pngCache.get(hex);
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = bytes => { let c = -1; for (const x of bytes) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(PAGE_W, 0); ihdr.writeUInt32BE(PAGE_H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + PAGE_W * 3);
  for (let x = 0; x < PAGE_W; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: PAGE_H }, () => row));
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  pngCache.set(hex, png);
  return png;
}

// ---------------------------------------------------------------------------
// ตกแต่งตามธีม (ช่องตกแต่งใส่ไว้ก่อนเนื้อหา จึงอยู่ด้านหลังเสมอ)
// ---------------------------------------------------------------------------

let seq = 0;
const fid = () => 'fd' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);
const PX_RATIO = PAGE_W / PAGE_H; // แปลงความกว้าง (สัดส่วนหน้า) เป็นความสูงที่ได้รูปเดิม

const rectF = (rect, cfg) => ({ id: fid(), type: 'rect', rect, points: 0, fontScale: 1, config: { color: cfg.fill, width: 0, style: 'solid', noStroke: true, fillOpacity: 1, borderRadius: 0, ...cfg } });
const ellipseF = (rect, cfg) => ({ id: fid(), type: 'ellipse', rect, points: 0, fontScale: 1, config: { color: cfg.fill, width: 0, style: 'solid', noStroke: true, fillOpacity: 1, ...cfg } });
const labelF = (rect, text, cfg, fontScale = 1, fontFamily) => ({ id: fid(), type: 'label', rect, points: 0, fontScale, ...(fontFamily ? { fontFamily } : {}), config: { text, color: '#000000', bold: false, align: 'left', ...cfg } });
const imageF = (rect, src) => ({ id: fid(), type: 'image', rect, points: 0, fontScale: 1, config: { src } });

// ภาพ SVG ขนาดพิกเซลตรงกับช่อง (มุมโค้งเท่ากันทุกด้าน ไม่บิดเบี้ยว)
function svgBox(rect, body) {
  const w = Math.round(rect.w * PAGE_W), h = Math.round(rect.h * PAGE_H);
  return { w, h, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${body(w, h)}</svg>` };
}
function hexMix(a, b, k) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

function decorate(pages, t, { title, addFile }) {
  let boxNo = 0;
  const boxImage = (rect, body) => {
    const b = svgBox(rect, body);
    const p = addFile(`deco/box-${++boxNo}.svg`, Buffer.from(b.svg, 'utf8'));
    return imageF(rect, p);
  };
  const stickerSrc = t.sticker ? addFile('graphics/' + t.sticker + '.svg', libGraphic(t.sticker)?.bytes) : null;
  const bandSrc = t.band ? addFile('graphics/' + t.band + '.svg', libGraphic(t.band)?.bytes) : null;
  let qNo = 0;

  pages.forEach((fields, pi) => {
    const decor = [];
    const content = fields;

    // หัวกระดาษ
    if (pi === 0) {
      if (t.plainHeader) {
        decor.push(labelF({ x: 0.08, y: 0.035, w: 0.84, h: 0.04 }, title, { color: t.text, bold: true, align: 'center' }, 1.5, t.font));
        decor.push(rectF({ x: 0.08, y: 0.082, w: 0.84, h: 0.0025 }, { fill: t.accent }));
        decor.push(labelF({ x: 0.08, y: 0.09, w: 0.84, h: 0.022 }, 'ชื่อ ........................................................  ชั้น ............  เลขที่ ........', { color: t.text, align: 'center' }, 0.9, t.font));
      } else {
        const dark = hexMix(t.accent, '#000000', 0.18);
        decor.push(boxImage({ x: 0.045, y: 0.022, w: 0.91, h: 0.088 }, (w, h) =>
          `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.accent}"/><stop offset="1" stop-color="${dark}"/></linearGradient>` +
          `<clipPath id="c"><rect width="${w}" height="${h}" rx="34"/></clipPath></defs>` +
          `<rect width="${w}" height="${h}" rx="34" fill="url(#g)"/>` +
          `<g clip-path="url(#c)"><circle cx="${w * 0.80}" cy="${h * 0.15}" r="${h * 0.75}" fill="${t.accent2}" opacity=".35"/>` +
          `<circle cx="${w * 0.66}" cy="${h * 1.05}" r="${h * 0.35}" fill="#fff" opacity=".15"/>` +
          `<circle cx="${w * 0.03}" cy="${h * 0.05}" r="${h * 0.3}" fill="#fff" opacity=".12"/></g>`));
        decor.push(labelF({ x: 0.075, y: 0.047, w: stickerSrc ? 0.68 : 0.82, h: 0.05 }, title, { color: '#FFFFFF', bold: true }, 1.55, t.font));
        if (stickerSrc) decor.push(imageF({ x: 0.80, y: 0.016, w: 0.13, h: 0.13 * PX_RATIO }, stickerSrc));
        if (bandSrc) decor.push(imageF({ x: 0.045, y: 0.112, w: 0.91, h: 0.91 * 0.1 * PX_RATIO }, bandSrc));
      }
    } else {
      decor.push(rectF({ x: 0.045, y: 0.016, w: 0.91, h: 0.008 }, { fill: t.accent, borderRadius: 8 }));
    }

    // กลุ่มคำถาม: โจทย์ (ข้อความตัวหนา) ตามด้วยช่องคำตอบ
    const sorted = content.slice().sort((a, b) => a.rect.y - b.rect.y);
    for (let i = 0; i < sorted.length; i++) {
      const f = sorted[i];
      if (f.type === 'label') {
        const next = sorted[i + 1];
        const isPrompt = next && next.type !== 'label' && next.type !== 'image';
        f.fontFamily = t.font;
        if (!isPrompt) {
          // หัวข้อตอน / คำชี้แจง
          const heading = Boolean(f.config.bold) || /^#/.test(f.config.text);
          f.config.color = heading ? t.accent : t.text;
          f.fontScale = heading ? 1.22 : 1;
          continue;
        }
        // เริ่มกลุ่มคำถาม
        const group = [f];
        let j = i + 1;
        while (j < sorted.length && sorted[j].type !== 'label' && sorted[j].type !== 'image') group.push(sorted[j++]);
        i = j - 1;
        qNo++;
        const top = Math.min(...group.map(g => g.rect.y));
        const bottom = Math.max(...group.map(g => g.rect.y + g.rect.h));
        if (t.cards) {
          const edge = hexMix(t.card, t.accent, 0.25);
          decor.push(boxImage({ x: 0.055, y: top - 0.009, w: 0.89, h: bottom - top + 0.018 }, (w, h) =>
            `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="26" fill="${t.card}" stroke="${edge}" stroke-width="3"/>` +
            `<rect x="2" y="26" width="10" height="${Math.max(0, h - 52)}" rx="5" fill="${t.accent}" opacity=".85"/>`));
        }
        // ป้ายเลขข้อ (ถ้าโจทย์ยังไม่ได้ขึ้นต้นด้วยเลข)
        if (!/^\s*\d+[.)]/.test(f.config.text)) {
          const d = 0.038;
          decor.push(ellipseF({ x: 0.06, y: top - 0.002, w: d, h: d * PX_RATIO }, { fill: t.accent, circle: true }));
          decor.push(labelF({ x: 0.06, y: top + 0.0035, w: d, h: d * PX_RATIO - 0.008 }, String(qNo), { color: '#FFFFFF', bold: true, align: 'center' }, 0.95, t.font));
          for (const g of group) { g.rect.x = Math.max(g.rect.x, 0.108); g.rect.w = Math.min(g.rect.w, 0.92 - g.rect.x); }
        }
        f.config.color = t.text;
        f.config.bold = true;
        for (const g of group.slice(1)) {
          g.config.bg = '#FFFFFF';
          g.config.bgOpacity = 1;
          g.config.fgColor = t.text;
          g.fontFamily = t.font;
        }
      }
    }

    // ส่วนท้าย: เลขหน้า
    decor.push(rectF({ x: 0.08, y: 0.968, w: 0.84, h: 0.0015 }, { fill: t.accent2, fillOpacity: 0.8 }));
    decor.push(labelF({ x: 0.78, y: 0.973, w: 0.14, h: 0.017 }, `หน้า ${pi + 1}`, { color: t.accent, bold: true, align: 'right' }, 0.75, t.font));

    fields.unshift(...decor);
  });
}

// ---------------------------------------------------------------------------
// กระชับความสูงช่อง: layout ของ aiimport กันที่ไว้เผื่อ แต่ตัวเล่นใช้จริงราว 60%
// (วัดจากหน้านักเรียน) จึงลดความสูงแล้วเลื่อนช่องถัดไปขึ้น ทำให้กล่องคำถามพอดี
// ---------------------------------------------------------------------------

const USED = { single: 0.62, multi: 0.62, truefalse: 0.66, gaps: 0.66, order: 0.74, match: 0.8 };

const PAGE_TOP = 0.045, PAGE_BOTTOM = 0.955;
const r4 = v => Math.round(v * 1e4) / 1e4;

// จัดหน้าใหม่ทั้งใบงานหลังลดความสูง: โจทย์อยู่หน้าเดียวกับช่องคำตอบ
// และหัวข้อตอนย้ายไปพร้อมข้อแรกของตอน (ไม่ค้างอยู่ท้ายหน้า)
function compactLayout(pages) {
  // 1) ลำดับช่องทั้งหมด พร้อมระยะห่างเดิม (ไม่นับระยะข้ามหน้า)
  const seq = [];
  pages.forEach(fields => {
    let prevBottom = null;
    fields.slice().sort((a, b) => a.rect.y - b.rect.y).forEach(f => {
      const gap = prevBottom === null ? null : Math.max(0, f.rect.y - prevBottom);
      prevBottom = f.rect.y + f.rect.h;
      if (USED[f.type]) f.rect.h = r4(f.rect.h * USED[f.type] + 0.006);
      seq.push({ f, gap });
    });
  });
  if (!seq.length) return pages;
  const firstTop = seq[0].f.rect.y;

  // 2) รวมเป็นหน่วยที่ห้ามแยกหน้า
  const units = [];
  for (let i = 0; i < seq.length;) {
    const unit = [seq[i++]];
    if (unit[0].f.type === 'label') {
      while (i < seq.length && seq[i].f.type !== 'label' && seq[i].f.type !== 'image') unit.push(seq[i++]);
    }
    units.push(unit);
  }
  const unitHeight = u => u.reduce((h, s, k) => h + (k ? s.gap ?? 0.006 : 0) + s.f.rect.h, 0);

  // 3) วางลงหน้า
  const out = [[]];
  let cursor = null;
  units.forEach((u, ui) => {
    const isHeading = u.length === 1 && u[0].f.type === 'label';
    const next = units[ui + 1];
    const gap = cursor === null ? 0 : (u[0].gap ?? 0.02);
    let need = unitHeight(u);
    if (isHeading && next) need += (next[0].gap ?? 0.013) + unitHeight(next);
    const start = cursor === null ? firstTop : cursor + gap;
    if (cursor !== null && start + need > PAGE_BOTTOM && out[out.length - 1].length) {
      out.push([]);
      cursor = null;
    }
    let y = cursor === null ? (out.length === 1 ? firstTop : PAGE_TOP) : cursor + gap;
    u.forEach((s, k) => {
      if (k) y += s.gap ?? 0.006;
      s.f.rect.y = r4(y);
      y += s.f.rect.h;
      out[out.length - 1].push(s.f);
    });
    cursor = y;
  });
  return out;
}

// ---------------------------------------------------------------------------
// สร้างใบงาน
// ---------------------------------------------------------------------------

// spec = { title, instructions, author, classes[], items[], theme, illustrations: [{ id, svg, alt }] }
// รายการภาพ: { type: 'image', src: '<id ของ illustrations>' | 'lib:<id คลังกราฟิก>', width, align }
// คืนค่า { id, manifest, bytes, warnings, fields }
export async function buildWorksheet(spec, { teacherCode, apiUrl }) {
  const { parseImport, layoutFields, newManifest } = await app();
  const themeId = THEMES[spec.theme] ? spec.theme : (spec.theme === 'none' ? 'none' : 'clean');
  const t = THEMES[themeId] || null;
  const warnings = [];

  // ไฟล์ในแพ็กเกจ
  const files = new Map();
  const addFile = (p, bytes) => { if (!bytes) return null; files.set(p, bytes); return p; };

  // ภาพประกอบจาก AI
  const ill = new Map();
  for (const it of Array.isArray(spec.illustrations) ? spec.illustrations.slice(0, 12) : []) {
    const id = String(it && it.id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
    const clean = id && sanitizeSvg(it.svg);
    if (!clean) { warnings.push(`ภาพประกอบ «${id || '?'}» ไม่ใช่ SVG ที่ใช้ได้ จึงตัดออก`); continue; }
    ill.set(id, { ...clean, path: `media/${id}.svg` });
  }

  // รายการ: แปลงภาพเป็นไฟล์จริง เว้นที่ให้หัวกระดาษ และเว้นระยะระหว่างข้อเมื่อมีกล่องคำถาม
  const items = [];
  if (t) items.push({ type: 'spacer', height: t.plainHeader ? 0.085 : (t.band ? 0.14 : 0.095) });
  const QUESTION = new Set(['text', 'number', 'formula', 'truefalse', 'single', 'multi', 'select', 'essay', 'gaps', 'table', 'match', 'order']);
  for (const raw of Array.isArray(spec.items) ? spec.items : []) {
    if (!raw || typeof raw !== 'object') continue;
    let it = raw;
    if (it.type === 'image') {
      const ref = String(it.src || '');
      let g = null, p = null;
      if (ref.startsWith('lib:')) { const id = ref.slice(4); g = libGraphic(id); p = g && addFile(`graphics/${id}.svg`, g.bytes); }
      else if (ill.has(ref)) { g = ill.get(ref); p = addFile(g.path, g.bytes); }
      if (!p) { warnings.push(`ไม่พบภาพ «${ref}» จึงข้าม`); continue; }
      const w = Math.min(0.84, Math.max(0.12, Number(it.width) || 0.36));
      it = { type: 'image', src: p, width: w, height: Math.min(0.45, w * g.ratio * PX_RATIO), align: it.align, alt: it.alt };
    }
    if (t && t.cards && QUESTION.has(it.type) && items.length) items.push({ type: 'spacer', height: 0.012 });
    items.push(it);
  }

  const res = parseImport(JSON.stringify({ title: spec.title, instructions: spec.instructions, items }));
  if (!res.ok) {
    const err = new Error('JSON ของใบงานไม่ถูกต้อง: ' + (res.errors || []).join(' / '));
    err.userFacing = true;
    throw err;
  }
  warnings.push(...(res.errors || []));
  const layout = compactLayout(layoutFields(res.data.items));
  const title = String(res.data.title || spec.title || '').slice(0, 300);
  if (t) decorate(layout, t, { title, addFile });

  const paper = t ? t.paper : '#FFFFFF';
  const m = newManifest();
  m.title = title;
  m.author = String(spec.author || '').slice(0, 120);
  m.instructions = String(res.data.instructions || '');
  m.lang = 'th';
  m.settings.fontFamily = t ? t.font : 'sarabun';
  m.settings.theme = themeId;
  m.settings.onlineSubmit = {
    enabled: true,
    api: apiUrl,
    teacher: teacherCode,
    classes: (Array.isArray(spec.classes) ? spec.classes : []).map(c => String(c).trim()).filter(Boolean).slice(0, 100)
  };
  const zip = new JSZip();
  // แต่ละหน้ามีไฟล์ภาพของตัวเอง: ตัวแก้ไขระบายสีพื้นหน้าใหม่ทับไฟล์เดิม
  layout.forEach((fields, i) => {
    const pagePath = `pages/page-${i + 1}.png`;
    zip.file(pagePath, solidPage(paper));
    m.pages.push({ image: pagePath, w: PAGE_W, h: PAGE_H, fields, bgColor: paper, blank: true });
  });
  for (const [p, bytes] of files) zip.file(p, bytes);
  zip.file('manifest.json', JSON.stringify(m, null, 2));
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const contentFields = layout.reduce((a, p) => a + p.filter(f => !String(f.id).startsWith('fd')).length, 0);
  return { id: m.id, manifest: m, bytes, warnings, fields: contentFields, theme: themeId };
}
