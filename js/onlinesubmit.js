// ฉบับภาษาไทย: ส่งคะแนนของนักเรียนให้ครูทางออนไลน์ (Google Apps Script → Google Sheets)
//
// ใบงานเปิดใช้ได้ที่ ตั้งค่า → การตรวจ → «ส่งคะแนนให้ครูอัตโนมัติ»
// manifest.settings.onlineSubmit = { enabled: true, url: '<…/exec>', classes: ['ม.1/1', …] }
// ถ้าใบงานไม่ได้เก็บ url ไว้ จะใช้ gasUrl ใน config.js ของเว็บที่เปิดใบงาน

export function onlineSubmitConfig(manifest) {
  const cfg = manifest?.settings?.onlineSubmit || {};
  const url = cfg.url || window.OPENWORKSHEETS_CONFIG?.gasUrl || '';
  return { enabled: Boolean(cfg.enabled) && Boolean(url), url, classes: classList(cfg.classes) };
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
export async function sendScoreOnline(url, entrega) {
  const body = JSON.stringify({ action: 'submit', data: slimEntrega(entrega) });
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // text/plain = simple request จึงไม่ต้องมี CORS preflight (Apps Script ไม่รองรับ)
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' });
      const data = await resp.json();
      if (data && data.ok) return { ok: true };
      lastError = (data && data.error) || ('HTTP ' + resp.status);
      break; // เซิร์ฟเวอร์ปฏิเสธ: ลองใหม่ก็ไม่ช่วย
    } catch (e) {
      lastError = e.message || String(e);
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return { ok: false, error: lastError };
}
