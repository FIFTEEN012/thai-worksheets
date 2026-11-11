// ฉบับภาษาไทย: หน้าดูคะแนนของครู (อ่านจาก Google Apps Script → Google Sheets)
import { fieldTypeName } from './fieldtypes.js';

const $ = s => document.querySelector(s);
const KEY_STORE = 'ows.th.teacherKey';
const gasUrl = window.OPENWORKSHEETS_CONFIG?.gasUrl || '';
let allRows = [];
let sheetUrl = '';
let sortBy = 'alumno';
let sortDir = 1;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n, d = 2) => (Math.round(Number(n) * 10 ** d) / 10 ** d).toLocaleString('th-TH');
const thCmp = (a, b) => String(a).localeCompare(String(b), 'th', { numeric: true });
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }); };
const RESULT_TH = { correcta: 'ถูก', incorrecta: 'ผิด', parcial: 'ถูกบางส่วน', pendiente: 'รอตรวจ', 'en blanco': 'ไม่ได้ตอบ' };
const RESULT_CLS = { correcta: 'rs-ok', incorrecta: 'rs-bad', parcial: 'rs-pend', pendiente: 'rs-pend' };

function msg(text, isError) {
  const p = $('#rsMsg');
  p.hidden = !text;
  p.textContent = text || '';
  p.style.color = isError ? 'var(--rojo)' : '';
}

function storedKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } }
function storeKey(k) { try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch { /* ignore */ } }

async function load(key) {
  if (!gasUrl) { msg('เว็บนี้ยังไม่ได้ตั้งค่า Google Apps Script (gasUrl ใน config.js)', true); return false; }
  msg('กำลังโหลดคะแนน…');
  $('#rsGo').disabled = true;
  try {
    const resp = await fetch(gasUrl + '?results=1&key=' + encodeURIComponent(key) + '&ts=' + Date.now(), { cache: 'no-store' });
    const data = await resp.json();
    if (!data.ok) { msg(data.error || 'โหลดไม่สำเร็จ', true); return false; }
    allRows = data.rows || [];
    sheetUrl = data.sheetUrl || '';
    msg(allRows.length ? '' : 'ยังไม่มีคะแนนที่ส่งเข้ามา');
    return true;
  } catch (e) {
    msg('เชื่อมต่อ Apps Script ไม่ได้: ' + (e.message || e) + ' (ถ้าเพิ่งอัปเดตโค้ด Apps Script ต้องสร้างเวอร์ชันใหม่ใน «ทำให้ใช้งานได้ → จัดการการทำให้ใช้งานได้»)', true);
    return false;
  } finally {
    $('#rsGo').disabled = false;
  }
}

function fillFilters() {
  const fichaSel = $('#rsFicha');
  const prevFicha = fichaSel.value;
  const fichas = new Map();
  for (const r of allRows) {
    const f = fichas.get(r.fichaId) || { title: r.titulo, n: 0, last: '' };
    f.n++; if (r.fecha > f.last) { f.last = r.fecha; f.title = r.titulo || f.title; }
    fichas.set(r.fichaId, f);
  }
  const list = [...fichas.entries()].sort((a, b) => (b[1].last > a[1].last ? 1 : -1));
  fichaSel.innerHTML = list.map(([id, f]) => `<option value="${esc(id)}">${esc(f.title || '(ไม่มีชื่อ)')} (${f.n})</option>`).join('');
  if (prevFicha && fichas.has(prevFicha)) fichaSel.value = prevFicha;
  fillClasses();
}

function fillClasses() {
  const sel = $('#rsClase');
  const prev = sel.value;
  const classes = [...new Set(allRows.filter(r => r.fichaId === $('#rsFicha').value).map(r => r.grupo || ''))].sort(thCmp);
  sel.innerHTML = '<option value="__all">ทุกห้อง</option>' +
    classes.map(c => `<option value="${esc(c)}">${esc(c || '(ไม่ระบุห้อง)')}</option>`).join('');
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function currentRows() {
  const ficha = $('#rsFicha').value;
  const clase = $('#rsClase').value;
  const q = $('#rsBuscar').value.trim().toLowerCase();
  let rows = allRows.filter(r => r.fichaId === ficha && (clase === '__all' || (r.grupo || '') === clase));
  // นับครั้งที่ส่งของแต่ละคน
  const byStudent = new Map();
  rows.slice().sort((a, b) => (a.fecha > b.fecha ? 1 : -1)).forEach(r => {
    const k = (r.grupo || '') + '\u0000' + r.alumno.trim().toLowerCase();
    const n = (byStudent.get(k) || 0) + 1;
    byStudent.set(k, n);
    r._attempt = n;
    r._key = k;
  });
  rows.forEach(r => { r._attempts = byStudent.get(r._key); });
  if ($('#rsLatest').checked) rows = rows.filter(r => r._attempt === r._attempts);
  if (q) rows = rows.filter(r => r.alumno.toLowerCase().includes(q));
  const val = r => (sortBy === 'nota10' || sortBy === 'pct' || sortBy === 'vigilancia' || sortBy === 'pendientes') ? Number(r[sortBy]) : String(r[sortBy] ?? '');
  rows.sort((a, b) => {
    const x = val(a), y = val(b);
    const c = typeof x === 'number' ? x - y : thCmp(x, y);
    return c * sortDir || thCmp(a.alumno, b.alumno);
  });
  return rows;
}

function stat(label, value) { return `<div class="rs-stat"><b>${value}</b><span>${label}</span></div>`; }

function render() {
  const rows = currentRows();
  const n = rows.length;
  const avg = n ? rows.reduce((a, r) => a + r.nota10, 0) / n : 0;
  const pass = rows.filter(r => r.pct >= 50).length;
  const pend = rows.filter(r => r.pendientes > 0).length;
  $('#rsStats').innerHTML =
    stat('จำนวนนักเรียน', n) +
    stat('คะแนนเฉลี่ย (เต็ม 10)', n ? num(avg) : '–') +
    stat('สูงสุด / ต่ำสุด', n ? num(Math.max(...rows.map(r => r.nota10))) + ' / ' + num(Math.min(...rows.map(r => r.nota10))) : '–') +
    stat('ผ่าน (≥ 50%)', n ? `${pass} (${Math.round(pass / n * 100)}%)` : '–') +
    stat('รอครูตรวจ', pend);

  // สรุปรายห้อง (เมื่อเลือก «ทุกห้อง»)
  const sum = $('#rsClassSum');
  if ($('#rsClase').value === '__all' && n) {
    const g = new Map();
    rows.forEach(r => { const c = r.grupo || '(ไม่ระบุห้อง)'; const o = g.get(c) || { n: 0, s: 0, p: 0 }; o.n++; o.s += r.nota10; if (r.pct >= 50) o.p++; g.set(c, o); });
    sum.innerHTML = '<table class="class-table"><thead><tr><th>ห้อง</th><th class="rs-num">นักเรียน</th><th class="rs-num">เฉลี่ย /10</th><th class="rs-num">ผ่าน</th></tr></thead><tbody>' +
      [...g.entries()].sort((a, b) => thCmp(a[0], b[0])).map(([c, o]) =>
        `<tr data-class="${esc(c)}"><td>${esc(c)}</td><td class="rs-num">${o.n}</td><td class="rs-num">${num(o.s / o.n)}</td><td class="rs-num">${o.p} (${Math.round(o.p / o.n * 100)}%)</td></tr>`).join('') +
      '</tbody></table>';
    sum.querySelectorAll('tr[data-class]').forEach(tr => tr.addEventListener('click', () => {
      const c = tr.dataset.class; $('#rsClase').value = c === '(ไม่ระบุห้อง)' ? '' : c; render();
    }));
  } else sum.innerHTML = '';

  const cols = [
    ['alumno', 'ชื่อนักเรียน'], ['grupo', 'ห้อง'], ['nota', 'คะแนน'], ['nota10', '/10'], ['pct', '%'],
    ['pendientes', 'รอตรวจ'], ['vigilancia', 'ออกจากจอ'], ['fecha', 'เวลาส่ง'], ['_attempt', 'ครั้งที่']
  ];
  const head = '<thead><tr><th>#</th>' + cols.map(([k, l]) =>
    `<th class="cl-sort${['nota', 'nota10', 'pct', 'pendientes', 'vigilancia', '_attempt'].includes(k) ? ' rs-num' : ''}" data-k="${k}">${l}${sortBy === k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('') + '</tr></thead>';
  const body = rows.map((r, i) => `<tr data-i="${i}">
      <td>${i + 1}</td><td>${esc(r.alumno)}</td><td>${esc(r.grupo)}</td>
      <td class="rs-num">${num(r.nota)} / ${num(r.total)}</td><td class="rs-num"><b>${num(r.nota10)}</b></td><td class="rs-num">${r.pct}</td>
      <td class="rs-num ${r.pendientes ? 'rs-pend' : ''}">${r.pendientes || ''}</td>
      <td class="rs-num ${r.vigilancia ? 'rs-bad' : ''}">${r.vigilancia || ''}</td>
      <td>${esc(fmtDate(r.fecha))}</td><td class="rs-num">${r._attempt}${r._attempts > 1 ? ' / ' + r._attempts : ''}</td></tr>`).join('');
  const table = $('#rsTable');
  table.innerHTML = head + '<tbody>' + (body || '<tr><td colspan="10">ไม่มีข้อมูล</td></tr>') + '</tbody>';
  table.querySelectorAll('th[data-k]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.k;
    if (sortBy === k) sortDir = -sortDir; else { sortBy = k; sortDir = ['nota10', 'pct', 'fecha'].includes(k) ? -1 : 1; }
    render();
  }));
  table.querySelectorAll('tbody tr[data-i]').forEach(tr => tr.addEventListener('click', () => toggleDetail(tr, rows[Number(tr.dataset.i)])));
  $('#rsSheet').href = sheetUrl || '#';
  $('#rsSheet').hidden = !sheetUrl;
}

function toggleDetail(tr, r) {
  const next = tr.nextElementSibling;
  if (next && next.classList.contains('rs-detail')) { next.remove(); return; }
  const items = (r.detalle || []).map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.p)}</td><td>${esc(fieldTypeName(d.t) || d.t)}</td><td>${esc(d.a || '—')}</td><td class="rs-num">${num(d.e)} / ${num(d.m)}</td><td class="${RESULT_CLS[d.r] || ''}">${esc(RESULT_TH[d.r] || d.r)}</td></tr>`).join('');
  const row = document.createElement('tr');
  row.className = 'rs-detail';
  row.innerHTML = `<td colspan="10"><table><thead><tr><th>ข้อ</th><th>หน้า</th><th>ประเภท</th><th>คำตอบ</th><th class="rs-num">คะแนน</th><th>ผล</th></tr></thead><tbody>${items || '<tr><td colspan="6">ไม่มีรายละเอียด</td></tr>'}</tbody></table><p><small>รหัสตรวจสอบ: ${esc(r.codigo)}</small></p></td>`;
  tr.after(row);
}

function exportCsv() {
  const rows = currentRows();
  const head = ['ลำดับ', 'ชื่อนักเรียน', 'ห้อง', 'คะแนน', 'คะแนนเต็ม', 'คะแนน/10', 'ร้อยละ', 'รอครูตรวจ', 'ออกจากหน้าจอ', 'เวลาส่ง', 'ครั้งที่'];
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
  const lines = [head, ...rows.map((r, i) => [i + 1, r.alumno, r.grupo, r.nota, r.total, r.nota10, r.pct, r.pendientes, r.vigilancia, fmtDate(r.fecha), r._attempt])].map(l => l.map(q).join(','));
  const title = ($('#rsFicha').selectedOptions[0]?.textContent || 'คะแนน').replace(/\s*\(\d+\)$/, '');
  const clase = $('#rsClase').value === '__all' ? 'ทุกห้อง' : $('#rsClase').value;
  // BOM เพื่อให้ Excel อ่านภาษาไทยถูกต้อง
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title} - ${clase}.csv`.replace(/[\\/:*?"<>|]/g, '-');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function enter(key) {
  if (!(await load(key))) { $('#rsApp').hidden = true; return; }
  if ($('#rsRemember').checked) storeKey(key); else storeKey('');
  $('#rsLogin').hidden = true;
  $('#rsApp').hidden = false;
  fillFilters();
  render();
}

$('#rsLogin').addEventListener('submit', e => { e.preventDefault(); enter($('#rsKey').value.trim()); });
$('#rsFicha').addEventListener('change', () => { fillClasses(); render(); });
$('#rsClase').addEventListener('change', render);
$('#rsLatest').addEventListener('change', render);
$('#rsBuscar').addEventListener('input', render);
$('#rsCsv').addEventListener('click', exportCsv);
$('#rsReload').addEventListener('click', async () => { if (await load(storedKey() || $('#rsKey').value.trim())) { fillFilters(); render(); } });
$('#rsLogout').addEventListener('click', () => { storeKey(''); location.reload(); });

const saved = storedKey();
if (saved) { $('#rsKey').value = saved; enter(saved); }
