// ฉบับภาษาไทย: ส่งคะแนนของนักเรียนให้ครูทางออนไลน์ (API บน Vercel → ฐานข้อมูล Neon)
//
// manifest.settings.onlineSubmit = {
//   enabled: true,                       // ปิดได้ที่ ตั้งค่า → การตรวจ
//   api: 'https://<เว็บ>/api/submit',    // ปลายทาง (บันทึกไว้ตอนครูบันทึกใบงาน)
//   teacher: '<รหัสส่งคะแนนของครู>',     // คะแนนเข้าบัญชีครูคนนี้ (ไม่มี = บัญชีผู้ดูแลระบบ)
//   classes: ['ม.1/1', …]                // รายชื่อห้องให้นักเรียนเลือก
// }

// ปลายทาง API ของเว็บที่เปิดอยู่ (config.js: apiBase) เป็น URL เต็ม
export function siteApiUrl() {
  const base = window.OPENWORKSHEETS_CONFIG?.apiBase;
  if (!base) return '';
  try { return new URL(base.replace(/\/+$/, '') + '/submit', window.location.href).href; } catch { return ''; }
}

export function onlineSubmitConfig(manifest) {
  const cfg = manifest?.settings?.onlineSubmit || {};
  // ใบงานรุ่นทดลองเคยเก็บ URL ของ Google Apps Script ไว้ใน cfg.url: ไม่ใช้แล้ว
  const url = cfg.api || siteApiUrl();
  const enabled = cfg.enabled === undefined ? true : Boolean(cfg.enabled);
  return { enabled: enabled && Boolean(url), url, teacher: cfg.teacher || '', classes: classList(cfg.classes) };
}

export function classList(raw) {
  const arr = Array.isArray(raw) ? raw : String(raw || '').split(/\r?\n|,/);
  const seen = new Set();
  return arr.map(s => String(s).trim()).filter(s => s && !seen.has(s) && seen.add(s));
}

// ตัดข้อมูลที่ใหญ่เกิน (เช่น ไฟล์เสียงที่บันทึก) ออกก่อนส่ง
function slimEntrega(entrega) {
  return {
    ...entrega,
    respuestas: (entrega.respuestas || []).map(r => (r.tipo === 'record'
      ? { ...r, respuesta: r.respuesta ? '[บันทึกเสียง]' : '' }
      : r))
  };
}

// คืนค่า { ok, error? } — ลองใหม่สูงสุด 3 ครั้งเมื่อเครือข่ายขัดข้อง
export async function sendScoreOnline(online, entrega) {
  const body = JSON.stringify({ action: 'submit', teacher: online.teacher, data: slimEntrega(entrega) });
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // text/plain = simple request จึงไม่ต้องมี CORS preflight เมื่อเปิดใบงานจากเว็บอื่น
      const resp = await fetch(online.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
      const data = await resp.json().catch(() => null);
      if (data && data.ok) return { ok: true };
      lastError = (data && data.error) || ('HTTP ' + resp.status);
      if (resp.status >= 400 && resp.status < 500) break; // เซิร์ฟเวอร์ปฏิเสธ: ลองใหม่ก็ไม่ช่วย
    } catch (e) {
      lastError = e.message || String(e);
    }
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
  }
  return { ok: false, error: lastError };
}
