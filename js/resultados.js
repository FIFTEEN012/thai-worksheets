// ฉบับภาษาไทย: ห้องครู — เข้าสู่ระบบ/สมัคร ดูคะแนนแยกตามใบงานและห้อง และเชื่อมต่อ MCP
import { fieldTypeName } from './fieldtypes.js';

const $ = s => document.querySelector(s);
const CFG = window.OPENWORKSHEETS_CONFIG || {};
const API = (CFG.apiBase || '/api').replace(/\/+$/, '');
const SITE = (CFG.siteUrl || location.origin).replace(/\/+$/, '');

let me = null;
let worksheets = [];
let allRows = [];
let sortBy = 'alumno';
let sortDir = 1;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n, d = 2) => (Math.round(Number(n) * 10 ** d) / 10 ** d).toLocaleString('th-TH');
const thCmp = (a, b) => String(a).localeCompare(String(b), 'th', { numeric: true });
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? String(iso ?? '') : d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }); };
const RESULT_TH = { correcta: 'ถูก', incorrecta: 'ผิด', parcial: 'ถูกบางส่วน', pendiente: 'รอตรวจ', 'en blanco': 'ไม่ได้ตอบ' };
const RESULT_CLS = { correcta: 'rs-ok', incorrecta: 'rs-bad', parcial: 'rs-pend', pendiente: 'rs-pend' };

async function api(path, opts = {}) {
  const resp = await fetch(API + path, {
    credentials: 'include',
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await resp.json().catch(() => ({ ok: false, error: 'HTTP ' + resp.status }));
  if (resp.status === 401 && path !== '/auth') { showAuth(); }
  return data;
}

function msg(el, text, isError) {
  el.hidden = !text;
  el.textContent = text || '';
  el.style.color = isError ? 'var(--rojo)' : '';
}

// ---------- เข้าสู่ระบบ ----------

function showAuth() {
  $('#rsApp').hidden = true;
  $('#rsAuthCard').hidden = false;
}

document.querySelectorAll('[data-auth]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-auth]').forEach(x => x.classList.toggle('is-active', x === b));
  $('#rsLoginForm').hidden = b.dataset.auth !== 'login';
  $('#rsRegisterForm').hidden = b.dataset.auth !== 'register';
  msg($('#rsAuthMsg'), '');
}));

$('#rsLoginForm').addEventListener('submit', async e => {
  e.preventDefault();
  msg($('#rsAuthMsg'), 'กำลังเข้าสู่ระบบ…');
  const d = await api('/auth', { method: 'POST', body: { action: 'login', email: $('#lgEmail').value, password: $('#lgPass').value } });
  if (!d.ok) return msg($('#rsAuthMsg'), d.error || 'เข้าสู่ระบบไม่สำเร็จ', true);
  enterApp(d.teacher);
});

$('#rsRegisterForm').addEventListener('submit', async e => {
  e.preventDefault();
  msg($('#rsAuthMsg'), 'กำลังสมัคร…');
  const d = await api('/auth', { method: 'POST', body: { action: 'register', name: $('#rgName').value, email: $('#rgEmail').value, password: $('#rgPass').value, signupCode: $('#rgCode').value } });
  if (!d.ok) return msg($('#rsAuthMsg'), d.error || 'สมัครไม่สำเร็จ', true);
  enterApp(d.teacher);
});

$('#rsLogout').addEventListener('click', async () => {
  await api('/auth', { method: 'POST', body: { action: 'logout' } });
  location.reload();
});

async function enterApp(teacher) {
  me = teacher;
  $('#rsAuthCard').hidden = true;
  $('#rsApp').hidden = false;
  $('#rsWho').textContent = `${me.name} (${me.email})${me.isAdmin ? ' · ผู้ดูแลระบบ' : ''}`;
  renderMcp();
  await loadWorksheets();
}

// ---------- ใบงานและคะแนน ----------

async function loadWorksheets() {
  msg($('#rsMsg'), 'กำลังโหลดใบงาน…');
  const d = await api('/results');
  if (!d.ok) return msg($('#rsMsg'), d.error || 'โหลดไม่สำเร็จ', true);
  worksheets = d.worksheets || [];
  const sel = $('#rsFicha');
  const prev = sel.value;
  sel.innerHTML = worksheets.map(w => `<option value="${esc(w.id)}">${esc(w.title || '(ไม่มีชื่อ)')} (${w.submissions})</option>`).join('');
  if (!worksheets.length) {
    msg($('#rsMsg'), 'ยังไม่มีใบงานหรือคะแนน: สร้างใบงานในตัวแก้ไข (เข้าสู่ระบบไว้ก่อนบันทึก) หรือให้ AI สร้างผ่าน MCP แล้วแชร์ลิงก์ให้นักเรียน');
    allRows = []; render(); return;
  }
  if (prev && worksheets.some(w => w.id === prev)) sel.value = prev;
  await loadRows();
}

async function loadRows() {
  const id = $('#rsFicha').value;
  if (!id) return;
  msg($('#rsMsg'), 'กำลังโหลดคะแนน…');
  const d = await api('/results?worksheet=' + encodeURIComponent(id));
  if (!d.ok) return msg($('#rsMsg'), d.error || 'โหลดไม่สำเร็จ', true);
  allRows = d.rows || [];
  msg($('#rsMsg'), allRows.length ? '' : 'ใบงานนี้ยังไม่มีนักเรียนส่ง');
  const ws = worksheets.find(w => w.id === id);
  const link = $('#rsStudentLink');
  link.hidden = !(ws && ws.hosted);
  $('#rsPublicLb').checked = Boolean(ws && ws.publicLeaderboard);
  if (ws && ws.hosted) link.href = `${SITE}/alumno.html?url=${encodeURIComponent(`${API}/worksheet?id=${id}&pkg=1`)}`;
  fillClasses(d.classes || []);
  render();
}

function fillClasses(declared) {
  const sel = $('#rsClase');
  const prev = sel.value;
  const classes = [...new Set([...declared, ...allRows.map(r => r.grupo || '')])].sort(thCmp);
  sel.innerHTML = '<option value="__all">ทุกห้อง</option>' + classes.map(c => `<option value="${esc(c)}">${esc(c || '(ไม่ระบุห้อง)')}</option>`).join('');
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function currentRows() {
  const clase = $('#rsClase').value;
  const q = $('#rsBuscar').value.trim().toLowerCase();
  let rows = allRows.filter(r => clase === '__all' || (r.grupo || '') === clase);
  const byStudent = new Map();
  rows.slice().sort((a, b) => (a.fecha > b.fecha ? 1 : -1)).forEach(r => {
    const k = (r.grupo || '') + '\u0000' + r.alumno.trim().toLowerCase();
    const n = (byStudent.get(k) || 0) + 1;
    byStudent.set(k, n);
    r._attempt = n; r._key = k;
  });
  rows.forEach(r => { r._attempts = byStudent.get(r._key); });
  if ($('#rsLatest').checked) rows = rows.filter(r => r._attempt === r._attempts);
  if (q) rows = rows.filter(r => r.alumno.toLowerCase().includes(q));
  const numeric = ['nota', 'nota10', 'pct', 'vigilancia', 'pendientes', '_attempt'];
  rows.sort((a, b) => {
    const x = a[sortBy], y = b[sortBy];
    const c = numeric.includes(sortBy) ? Number(x) - Number(y) : thCmp(x ?? '', y ?? '');
    return c * sortDir || thCmp(a.alumno, b.alumno);
  });
  return rows;
}

const stat = (label, value) => `<div class="rs-stat"><b>${value}</b><span>${label}</span></div>`;

function render() {
  const rows = currentRows();
  const n = rows.length;
  const avg = n ? rows.reduce((a, r) => a + r.nota10, 0) / n : 0;
  const pass = rows.filter(r => r.pct >= 50).length;
  $('#rsStats').innerHTML =
    stat('จำนวนนักเรียน', n) +
    stat('คะแนนเฉลี่ย (เต็ม 10)', n ? num(avg) : '–') +
    stat('สูงสุด / ต่ำสุด', n ? num(Math.max(...rows.map(r => r.nota10))) + ' / ' + num(Math.min(...rows.map(r => r.nota10))) : '–') +
    stat('ผ่าน (≥ 50%)', n ? `${pass} (${Math.round(pass / n * 100)}%)` : '–') +
    stat('รอครูตรวจ', rows.filter(r => r.pendientes > 0).length);

  const sum = $('#rsClassSum');
  if ($('#rsClase').value === '__all' && n) {
    const g = new Map();
    rows.forEach(r => { const c = r.grupo || ''; const o = g.get(c) || { n: 0, s: 0, p: 0 }; o.n++; o.s += r.nota10; if (r.pct >= 50) o.p++; g.set(c, o); });
    sum.innerHTML = '<table class="class-table"><thead><tr><th>ห้อง</th><th class="rs-num">นักเรียน</th><th class="rs-num">เฉลี่ย /10</th><th class="rs-num">ผ่าน</th></tr></thead><tbody>' +
      [...g.entries()].sort((a, b) => thCmp(a[0], b[0])).map(([c, o]) =>
        `<tr data-class="${esc(c)}"><td>${esc(c || '(ไม่ระบุห้อง)')}</td><td class="rs-num">${o.n}</td><td class="rs-num">${num(o.s / o.n)}</td><td class="rs-num">${o.p} (${Math.round(o.p / o.n * 100)}%)</td></tr>`).join('') + '</tbody></table>';
    sum.querySelectorAll('tr[data-class]').forEach(tr => tr.addEventListener('click', () => { $('#rsClase').value = tr.dataset.class; render(); }));
  } else sum.innerHTML = '';

  // ตารางผู้นำ: คะแนนดีที่สุดของแต่ละคน แยกตามห้อง (10 อันดับ)
  const board = $('#rsBoard');
  const byClass = new Map();
  allRows.filter(r => $('#rsClase').value === '__all' || (r.grupo || '') === $('#rsClase').value).forEach(r => {
    const c = r.grupo || '(ไม่ระบุห้อง)';
    const m = byClass.get(c) || new Map();
    const k = r.alumno.trim().toLowerCase();
    const prev = m.get(k);
    if (!prev || r.pct > prev.pct || (r.pct === prev.pct && r.fecha < prev.fecha)) m.set(k, r);
    byClass.set(c, m);
  });
  const medal = i => ['🥇', '🥈', '🥉'][i] || String(i + 1);
  board.innerHTML = [...byClass.entries()].sort((a, b) => thCmp(a[0], b[0])).map(([c, m]) => {
    const top = [...m.values()].sort((a, b) => b.pct - a.pct || (a.fecha > b.fecha ? 1 : -1)).slice(0, 10);
    return `<div class="card"><h3>ห้อง ${esc(c)}</h3><ol>${top.map((r, i) => `<li><span style="text-align:center;font-weight:900">${medal(i)}</span><span>${esc(r.alumno)}</span><b style="color:var(--prs-blue-dark)">${r.pct}%</b></li>`).join('')}</ol></div>`;
  }).join('') || '<p style="color:var(--prs-ink-soft)">ยังไม่มีข้อมูล</p>';

  const cols = [['alumno', 'ชื่อนักเรียน'], ['grupo', 'ห้อง'], ['nota', 'คะแนน'], ['nota10', '/10'], ['pct', '%'],
    ['pendientes', 'รอตรวจ'], ['vigilancia', 'ออกจากจอ'], ['fecha', 'เวลาส่ง'], ['_attempt', 'ครั้งที่']];
  const numCols = ['nota', 'nota10', 'pct', 'pendientes', 'vigilancia', '_attempt'];
  const head = '<thead><tr><th>#</th>' + cols.map(([k, l]) =>
    `<th class="cl-sort${numCols.includes(k) ? ' rs-num' : ''}" data-k="${k}">${l}${sortBy === k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('') + '<th></th></tr></thead>';
  const body = rows.map((r, i) => `<tr data-i="${i}">
      <td>${i + 1}</td><td>${esc(r.alumno)}</td><td>${esc(r.grupo)}</td>
      <td class="rs-num">${num(r.nota)} / ${num(r.total)}</td><td class="rs-num"><b>${num(r.nota10)}</b></td><td class="rs-num">${r.pct}</td>
      <td class="rs-num ${r.pendientes ? 'rs-pend' : ''}">${r.pendientes || ''}</td>
      <td class="rs-num ${r.vigilancia ? 'rs-bad' : ''}">${r.vigilancia || ''}</td>
      <td>${esc(fmtDate(r.fecha))}</td><td class="rs-num">${r._attempt}${r._attempts > 1 ? ' / ' + r._attempts : ''}</td>
      <td><button class="btn small ghost rs-del" type="button" data-del="${esc(r.id)}" title="ลบรายการนี้">✕</button></td></tr>`).join('');
  const table = $('#rsTable');
  table.innerHTML = head + '<tbody>' + (body || '<tr><td colspan="11">ไม่มีข้อมูล</td></tr>') + '</tbody>';
  table.querySelectorAll('th[data-k]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.k;
    if (sortBy === k) sortDir = -sortDir; else { sortBy = k; sortDir = ['nota10', 'pct', 'fecha', 'nota'].includes(k) ? -1 : 1; }
    render();
  }));
  table.querySelectorAll('tbody tr[data-i]').forEach(tr => tr.addEventListener('click', e => {
    if (e.target.closest('[data-del]')) return;
    toggleDetail(tr, rows[Number(tr.dataset.i)]);
  }));
  table.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const r = allRows.find(x => x.id === b.dataset.del);
    if (!r || !confirm(`ลบงานที่ส่งของ «${r.alumno}» (${fmtDate(r.fecha)})? ลบแล้วกู้คืนไม่ได้`)) return;
    const d = await api('/results', { method: 'POST', body: { action: 'delete', id: r.id } });
    if (d.ok) { allRows = allRows.filter(x => x.id !== r.id); render(); } else alert(d.error || 'ลบไม่สำเร็จ');
  }));
}

function toggleDetail(tr, r) {
  const next = tr.nextElementSibling;
  if (next && next.classList.contains('rs-detail')) { next.remove(); return; }
  const items = (r.detalle || []).map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.p)}</td><td>${esc(fieldTypeName(d.t) || d.t)}</td><td>${esc(d.a || '—')}</td><td class="rs-num">${num(d.e)} / ${num(d.m)}</td><td class="${RESULT_CLS[d.r] || ''}">${esc(RESULT_TH[d.r] || d.r)}</td></tr>`).join('');
  const row = document.createElement('tr');
  row.className = 'rs-detail';
  row.innerHTML = `<td colspan="11"><table><thead><tr><th>ข้อ</th><th>หน้า</th><th>ประเภท</th><th>คำตอบ</th><th class="rs-num">คะแนน</th><th>ผล</th></tr></thead><tbody>${items || '<tr><td colspan="6">ไม่มีรายละเอียด</td></tr>'}</tbody></table><p><small>รหัสตรวจสอบ: ${esc(r.codigo)}</small></p></td>`;
  tr.after(row);
}

function exportCsv() {
  const rows = currentRows();
  const head = ['ลำดับ', 'ชื่อนักเรียน', 'ห้อง', 'คะแนน', 'คะแนนเต็ม', 'คะแนน/10', 'ร้อยละ', 'รอครูตรวจ', 'ออกจากหน้าจอ', 'เวลาส่ง', 'ครั้งที่'];
  const q = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [head, ...rows.map((r, i) => [i + 1, r.alumno, r.grupo, r.nota, r.total, r.nota10, r.pct, r.pendientes, r.vigilancia, fmtDate(r.fecha), r._attempt])].map(l => l.map(q).join(','));
  const title = ($('#rsFicha').selectedOptions[0]?.textContent || 'คะแนน').replace(/\s*\(\d+\)$/, '');
  const clase = $('#rsClase').value === '__all' ? 'ทุกห้อง' : $('#rsClase').value;
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title} - ${clase}.csv`.replace(/[\\/:*?"<>|]/g, '-');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- MCP ----------

function copy(text, btn) {
  navigator.clipboard.writeText(text).then(() => { const o = btn.textContent; btn.textContent = 'คัดลอกแล้ว ✓'; setTimeout(() => { btn.textContent = o; }, 1500); },
    () => prompt('คัดลอกข้อความนี้:', text));
}

function renderMcp(newKey) {
  const box = $('#rsMcpBox');
  box.innerHTML = '';
  if (newKey) {
    const url = `${SITE}/mcp/${newKey}`;
    box.innerHTML = `<p><b>URL สำหรับเพิ่ม connector</b> (แสดงครั้งเดียว ถ้าลืมให้สร้างใหม่):</p><code class="rs-code">${esc(url)}</code>`;
    const b = document.createElement('button'); b.className = 'btn small primary'; b.type = 'button'; b.textContent = 'คัดลอก URL';
    b.addEventListener('click', () => copy(url, b));
    box.appendChild(b);
  } else {
    box.innerHTML = `<p>${me.hasMcpKey ? 'มีกุญแจ MCP อยู่แล้ว (URL จะแสดงตอนสร้างเท่านั้น) กดสร้างใหม่ถ้าต้องการ URL ใหม่ กุญแจเดิมจะใช้ไม่ได้' : 'ยังไม่มีกุญแจ MCP'}</p>`;
  }
  const gen = document.createElement('button'); gen.className = 'btn small'; gen.type = 'button';
  gen.textContent = me.hasMcpKey || newKey ? 'สร้างกุญแจใหม่' : 'สร้างกุญแจ MCP';
  gen.style.marginLeft = '6px';
  gen.addEventListener('click', async () => {
    if ((me.hasMcpKey || newKey) && !confirm('สร้างกุญแจใหม่? connector ที่ใช้กุญแจเดิมจะเชื่อมต่อไม่ได้')) return;
    const d = await api('/auth', { method: 'POST', body: { action: 'mcpKey' } });
    if (!d.ok) return alert(d.error || 'สร้างไม่สำเร็จ');
    me.hasMcpKey = true;
    renderMcp(d.key);
  });
  box.appendChild(gen);
  if (me.hasMcpKey || newKey) {
    const rv = document.createElement('button'); rv.className = 'btn small ghost'; rv.type = 'button'; rv.textContent = 'ยกเลิกกุญแจ'; rv.style.marginLeft = '6px';
    rv.addEventListener('click', async () => {
      if (!confirm('ยกเลิกกุญแจ MCP? connector จะเชื่อมต่อไม่ได้จนกว่าจะสร้างกุญแจใหม่')) return;
      const d = await api('/auth', { method: 'POST', body: { action: 'mcpKeyRevoke' } });
      if (d.ok) { me.hasMcpKey = false; renderMcp(); }
    });
    box.appendChild(rv);
  }

  const local = [
    'ติดตั้งโฟลเดอร์นี้เป็นเซิร์ฟเวอร์ MCP ในเครื่อง:',
    'https://github.com/FIFTEEN012/thai-worksheets/tree/main/mcp',
    '',
    'ทำตาม README ลงทะเบียนในไคลเอนต์ MCP ที่ฉันใช้อยู่ และตั้งค่าตัวแปรสภาพแวดล้อมของเซิร์ฟเวอร์ดังนี้',
    `OWS_TEACHER_CODE=${me.submitCode}`,
    `OWS_SITE=${SITE}`,
    'แล้วตรวจว่าเครื่องมือแสดงขึ้นถูกต้อง ถ้าเครื่องขาดอะไรให้ติดตั้งเอง ถ้าทำเองไม่ได้ให้บอกฉันว่าต้องวางอะไรในไฟล์ไหน'
  ].join('\n');
  $('#rsLocalPrompt').textContent = local;
  $('#rsCopyLocal').onclick = e => copy(local, e.currentTarget);
}

// ---------- เริ่มต้น ----------

$('#rsFicha').addEventListener('change', loadRows);
$('#rsClase').addEventListener('change', render);
$('#rsLatest').addEventListener('change', render);
$('#rsBuscar').addEventListener('input', render);
$('#rsCsv').addEventListener('click', exportCsv);
$('#rsReload').addEventListener('click', loadWorksheets);
$('#rsPublicLb').addEventListener('change', async e => {
  const id = $('#rsFicha').value;
  const d = await api('/worksheet', { method: 'POST', body: { action: 'setLeaderboard', id, enabled: e.target.checked } });
  if (!d.ok) { e.target.checked = !e.target.checked; alert(d.error || 'บันทึกไม่สำเร็จ'); return; }
  const ws = worksheets.find(w => w.id === id);
  if (ws) ws.publicLeaderboard = e.target.checked;
});

(async () => {
  const d = await api('/auth').catch(() => ({}));
  if (d && d.teacher) enterApp(d.teacher); else showAuth();
})();
