// ฉบับภาษาไทย: (1) ให้ AI สร้างใบงานบนเว็บได้ทันที (POST /api/generate)
//               (2) คลังกราฟิก: สติกเกอร์ ป้าย ลายตกแต่ง และอัปโหลดรูปของตัวเอง
import { el, toast, copyToClipboard } from './util.js';

const API = () => (window.OPENWORKSHEETS_CONFIG?.apiBase || '/api').replace(/\/+$/, '');

// ต้องตรงกับ api/_lib/build.js (THEMES)
export const THEME_CHOICES = [
  { id: 'auto', name: 'ให้ AI เลือกให้', colors: ['#888', '#ccc'] },
  { id: 'playful', name: 'สดใส (ประถม)', colors: ['#FF6B6B', '#FFC83D'] },
  { id: 'ocean', name: 'ท้องทะเล', colors: ['#2F80ED', '#56CCF2'] },
  { id: 'nature', name: 'ธรรมชาติ / วิทยาศาสตร์', colors: ['#2E7D32', '#A5D6A7'] },
  { id: 'space', name: 'อวกาศ', colors: ['#4B3BBF', '#B3A8FF'] },
  { id: 'thai', name: 'ไทยประเพณี', colors: ['#8E2C1F', '#D4A017'] },
  { id: 'clean', name: 'เรียบหรู (มัธยม)', colors: ['#334E68', '#9FB3C8'] },
  { id: 'exam', name: 'แบบทดสอบทางการ', colors: ['#222222', '#999999'] }
];

const STYLE = `
.aig-dialog { width: min(720px, 94vw); border: 0; border-radius: 16px; padding: 0; }
.aig-dialog::backdrop { background: rgba(15, 23, 42, .45); }
.aig-body { padding: 20px 22px; display: grid; gap: 12px; }
.aig-body h2 { margin: 0; }
.aig-body textarea, .aig-body input[type=text], .aig-body input[type=number] { width: 100%; box-sizing: border-box; }
.aig-row { display: grid; grid-template-columns: 1fr 140px; gap: 12px; }
.aig-themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.aig-theme { display: flex; align-items: center; gap: 8px; border: 2px solid var(--tinta-tenue, #ddd); border-radius: 10px; padding: 8px 10px; cursor: pointer; background: transparent; text-align: left; font: inherit; color: inherit; }
.aig-theme.is-on { border-color: var(--tinta, #222); box-shadow: 0 0 0 2px color-mix(in srgb, var(--tinta, #222) 15%, transparent); }
.aig-sw { width: 26px; height: 26px; border-radius: 8px; flex: none; }
.aig-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.aig-status { font-weight: 600; }
.aig-result { border: 1px solid var(--tinta-tenue, #ddd); border-radius: 12px; padding: 12px 14px; display: grid; gap: 8px; }
.aig-link { font-family: ui-monospace, Consolas, monospace; font-size: .8rem; word-break: break-all; background: color-mix(in srgb, #4FC3F7 14%, transparent); padding: 6px 8px; border-radius: 8px; }
.aig-examples { display: flex; gap: 6px; flex-wrap: wrap; }
.aig-chip { border: 1px solid var(--tinta-tenue, #ccc); border-radius: 999px; padding: 3px 10px; font-size: .82rem; background: transparent; cursor: pointer; color: inherit; font: inherit; }
.gfx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; max-height: 52vh; overflow: auto; padding: 2px; }
.gfx-item { border: 1px solid var(--tinta-tenue, #ddd); border-radius: 12px; padding: 8px; background: #fff; cursor: pointer; display: grid; gap: 4px; justify-items: center; font: inherit; color: #333; }
.gfx-item:hover { border-color: #4F7CAC; transform: translateY(-1px); }
.gfx-item img { width: 100%; height: 64px; object-fit: contain; }
.gfx-item span { font-size: .75rem; text-align: center; }
.gfx-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
`;
function ensureStyle() {
  if (document.getElementById('aig-style')) return;
  document.head.appendChild(el('style', { id: 'aig-style' }, STYLE));
}

function dialogShell(title) {
  ensureStyle();
  const dlg = el('dialog', { class: 'aig-dialog' });
  const body = el('div', { class: 'aig-body' }, el('h2', {}, title));
  dlg.appendChild(body);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  return { dlg, body };
}

// ---------------------------------------------------------------------------
// (1) AI สร้างใบงาน
// ---------------------------------------------------------------------------

const EXAMPLES = [
  'ใบงานเรื่องระบบสุริยะ ป.6 เน้นลำดับดาวเคราะห์และลักษณะเด่น',
  'แบบฝึกหัดการบวกลบเศษส่วน ป.5 พร้อมโจทย์ปัญหา',
  'ใบงานคำควบกล้ำ ป.2 ให้เติมคำและจับคู่ภาพ',
  'ใบงานวงจรชีวิตผีเสื้อ ป.3 เรียงลำดับขั้นตอน',
  'Vocabulary: Animals for Grade 4 (English worksheet)'
];

export function openAiGenerateDialog({ onOpen } = {}) {
  const { dlg, body } = dialogShell('✨ ให้ AI สร้างใบงานให้');
  let theme = 'auto';
  const prompt = el('textarea', { rows: '4', placeholder: 'บอก AI ว่าต้องการใบงานแบบไหน เช่น «ใบงานเรื่องระบบสุริยะ ป.6 มีภาพประกอบ เน้นเลือกตอบและเติมคำ»' });
  const level = el('input', { type: 'text', placeholder: 'เช่น ป.6, ม.2 (ไม่บังคับ)' });
  const count = el('input', { type: 'number', min: '3', max: '30', value: '10' });
  const classes = el('textarea', { rows: '2', placeholder: 'รายชื่อห้องให้นักเรียนเลือก บรรทัดละห้อง เช่น ป.6/1 (ไม่บังคับ)' });
  const ill = el('input', { type: 'checkbox', checked: '' });
  const themeBtns = THEME_CHOICES.map(tc => {
    const b = el('button', { type: 'button', class: 'aig-theme' + (tc.id === theme ? ' is-on' : '') },
      el('span', { class: 'aig-sw', style: `background:linear-gradient(135deg,${tc.colors[0]},${tc.colors[1]})` }), tc.name);
    b.addEventListener('click', () => { theme = tc.id; themeBtns.forEach(x => x.classList.toggle('is-on', x === b)); });
    return b;
  });
  const status = el('p', { class: 'aig-status', hidden: '' });
  const result = el('div');
  const go = el('button', { class: 'btn primary', type: 'button' }, '✨ สร้างใบงาน');
  const cancel = el('button', { class: 'btn', type: 'button' }, 'ปิด');
  cancel.addEventListener('click', () => dlg.close());

  body.append(
    el('p', { style: 'margin:0' }, 'AI จะเขียนคำถาม จัดหน้าให้สวยตามธีม วาดภาพประกอบ และตั้งค่าส่งคะแนนเข้าบัญชีของคุณ ใช้เวลาราว 1–2 นาที'),
    el('label', { class: 'f-label' }, 'ต้องการใบงานแบบไหน'), prompt,
    el('div', { class: 'aig-examples' }, ...EXAMPLES.map(x => {
      const c = el('button', { type: 'button', class: 'aig-chip' }, x);
      c.addEventListener('click', () => { prompt.value = x; prompt.focus(); });
      return c;
    })),
    el('div', { class: 'aig-row' },
      el('div', {}, el('label', { class: 'f-label' }, 'ระดับชั้น'), level),
      el('div', {}, el('label', { class: 'f-label' }, 'จำนวนข้อ'), count)),
    el('label', { class: 'f-label' }, 'ธีม'), el('div', { class: 'aig-themes' }, ...themeBtns),
    el('label', { class: 'check-row' }, ill, ' ให้ AI วาดภาพประกอบให้ด้วย'),
    el('label', { class: 'f-label' }, 'ห้องเรียน'), classes,
    status, result,
    el('div', { class: 'aig-actions' }, cancel, go));

  go.addEventListener('click', async () => {
    if (prompt.value.trim().length < 3) { toast('พิมพ์ว่าต้องการใบงานเรื่องอะไร', 'error'); prompt.focus(); return; }
    go.disabled = true;
    result.innerHTML = '';
    status.hidden = false;
    status.style.color = '';
    const t0 = Date.now();
    const tick = () => { status.textContent = `⏳ AI กำลังออกแบบใบงาน… ${Math.round((Date.now() - t0) / 1000)} วินาที`; };
    tick();
    const timer = setInterval(tick, 1000);
    try {
      const resp = await fetch(API() + '/generate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.value, level: level.value, count: Number(count.value), classes: classes.value, theme, illustrations: ill.checked })
      });
      const d = await resp.json().catch(() => ({ ok: false, error: 'HTTP ' + resp.status }));
      clearInterval(timer);
      if (!d.ok) {
        status.style.color = 'var(--rojo, #c0392b)';
        status.textContent = '✗ ' + (d.error || 'สร้างไม่สำเร็จ');
        if (resp.status === 401) status.append(' ', el('a', { href: 'resultados.html', target: '_blank', rel: 'noopener' }, 'เข้าสู่ระบบครู'));
        go.disabled = false;
        return;
      }
      status.style.color = 'var(--verde, #2e7d32)';
      status.textContent = `✓ สร้างแล้วใน ${Math.round((Date.now() - t0) / 1000)} วินาที (วันนี้ใช้ได้อีก ${d.remainingToday} ครั้ง)`;
      const copyBtn = el('button', { class: 'btn small', type: 'button' }, 'คัดลอกลิงก์');
      copyBtn.addEventListener('click', () => copyToClipboard(d.studentLink).then(ok => toast(ok ? 'คัดลอกลิงก์แล้ว' : 'คัดลอกไม่สำเร็จ', ok ? 'ok' : 'error')));
      const openEd = el('button', { class: 'btn primary', type: 'button' }, 'เปิดในตัวแก้ไขเพื่อปรับแต่ง');
      openEd.addEventListener('click', () => { if (onOpen) onOpen(d); else location.href = d.editorLink; });
      result.appendChild(el('div', { class: 'aig-result' },
        el('b', {}, `«${d.title}» · ${d.fields} ช่อง · ${d.pages} หน้า`),
        el('div', {}, 'ลิงก์สำหรับนักเรียน (แชร์ได้ทันที คะแนนเข้าห้องครูอัตโนมัติ):'),
        el('div', { class: 'aig-link' }, d.studentLink),
        el('div', { class: 'aig-actions', style: 'justify-content:flex-start' },
          copyBtn,
          el('a', { class: 'btn small', href: d.studentLink, target: '_blank', rel: 'noopener' }, 'ดูแบบนักเรียน'),
          openEd),
        d.warnings && d.warnings.length ? el('small', {}, 'หมายเหตุ: ' + d.warnings.join(' / ')) : null));
      go.disabled = false;
      go.textContent = '✨ สร้างใหม่อีกแบบ';
    } catch (e) {
      clearInterval(timer);
      status.style.color = 'var(--rojo, #c0392b)';
      status.textContent = '✗ เชื่อมต่อไม่ได้: ' + (e.message || e);
      go.disabled = false;
    }
  });
  dlg.showModal();
  prompt.focus();
}

// ---------------------------------------------------------------------------
// (2) คลังกราฟิก
// ---------------------------------------------------------------------------

const CATS = { sticker: 'สติกเกอร์', banner: 'ป้าย / กล่องข้อความ', decor: 'ลายตกแต่ง / กรอบ' };

// onPick({ blob, ext, ratio, name })
export async function openGraphicsDialog({ onPick }) {
  const { dlg, body } = dialogShell('🎨 คลังกราฟิก');
  const grid = el('div', { class: 'gfx-grid' });
  const tabs = el('div', { class: 'gfx-tabs' });
  const upload = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  const upBtn = el('button', { class: 'btn', type: 'button' }, '📁 อัปโหลดรูปของฉัน');
  upBtn.addEventListener('click', () => upload.click());
  upload.addEventListener('change', async () => {
    const f = upload.files && upload.files[0];
    if (!f) return;
    const ratio = await imageRatio(f);
    const ext = (f.type.split('/')[1] || 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg');
    dlg.close();
    onPick({ blob: f, ext, ratio, name: f.name });
  });
  const close = el('button', { class: 'btn', type: 'button' }, 'ปิด');
  close.addEventListener('click', () => dlg.close());
  body.append(el('p', { style: 'margin:0' }, 'คลิกภาพเพื่อวางบนหน้าปัจจุบัน แล้วลากย้าย/ปรับขนาดได้ตามต้องการ'), tabs, grid,
    el('div', { class: 'aig-actions' }, upBtn, upload, close));
  dlg.showModal();

  let list = [];
  try { list = await fetch('graphics/index.json').then(r => r.json()); } catch { grid.textContent = 'โหลดคลังกราฟิกไม่ได้'; return; }
  const show = cat => {
    grid.innerHTML = '';
    list.filter(g => !cat || g.category === cat).forEach(g => {
      const b = el('button', { type: 'button', class: 'gfx-item', title: g.name }, el('img', { src: g.file, alt: g.name }), el('span', {}, g.name));
      b.addEventListener('click', async () => {
        const blob = await fetch(g.file).then(r => r.blob());
        dlg.close();
        onPick({ blob: new Blob([blob], { type: 'image/svg+xml' }), ext: 'svg', ratio: g.ratio, name: g.name });
      });
      grid.appendChild(b);
    });
  };
  const tabBtns = [['', 'ทั้งหมด'], ...Object.entries(CATS)].map(([cat, name]) => {
    const b = el('button', { type: 'button', class: 'aig-chip' }, name);
    b.addEventListener('click', () => { tabBtns.forEach(x => x.style.fontWeight = x === b ? '700' : ''); show(cat); });
    return b;
  });
  tabs.append(...tabBtns);
  tabBtns[0].style.fontWeight = '700';
  show('');
}

function imageRatio(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.75); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(0.75); URL.revokeObjectURL(url); };
    img.src = url;
  });
}
