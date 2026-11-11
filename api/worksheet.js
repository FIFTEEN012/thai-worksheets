// ใบงานของครู
//   GET  /api/worksheet?id=<id>&pkg=1    → ไฟล์ .owpkg ที่เก็บไว้ในระบบ (สาธารณะ สำหรับลิงก์นักเรียน)
//   POST /api/worksheet { action: 'register', id, title, classes }   (ต้องเข้าสู่ระบบ: ตัวแก้ไขเรียกตอนบันทึกตั้งค่า)
import { sql, send, cors, readJson, currentTeacher } from './_lib/core.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  try {
    if (req.method === 'GET') {
      const id = String(req.query?.id || '');
      const rows = await sql`SELECT encode(pkg, 'base64') AS b64 FROM worksheets WHERE id = ${id} AND pkg IS NOT NULL`;
      if (!rows.length) return send(res, 404, { ok: false, error: 'ไม่พบใบงาน' });
      const buf = Buffer.from(rows[0].b64, 'base64');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.setHeader('Content-Disposition', `inline; filename="worksheet-${id}.owpkg"`);
      return res.end(buf);
    }
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' });
    const teacher = await currentTeacher(req);
    if (!teacher) return send(res, 401, { ok: false, error: 'กรุณาเข้าสู่ระบบ' });
    const body = await readJson(req);
    // เปิด/ปิดตารางผู้นำให้นักเรียนเห็น (จากห้องครู)
    if (body && body.action === 'setLeaderboard' && body.id) {
      const r = await sql`UPDATE worksheets SET public_leaderboard = ${Boolean(body.enabled)} WHERE id = ${String(body.id)} AND teacher_id = ${teacher.id} RETURNING id`;
      return send(res, 200, { ok: r.length > 0 });
    }
    if (!body || body.action !== 'register' || !body.id) return send(res, 400, { ok: false, error: 'ไม่รู้จักคำสั่ง' });
    const classes = (Array.isArray(body.classes) ? body.classes : []).map(c => String(c).trim().slice(0, 60)).filter(Boolean).slice(0, 100);
    const rows = await sql`
      INSERT INTO worksheets (id, teacher_id, title, classes, public_leaderboard) VALUES (${String(body.id).slice(0, 80)}, ${teacher.id}, ${String(body.title || '').slice(0, 300)}, ${classes}, ${Boolean(body.leaderboard)})
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, classes = EXCLUDED.classes, public_leaderboard = EXCLUDED.public_leaderboard, updated_at = now()
      WHERE worksheets.teacher_id = EXCLUDED.teacher_id
      RETURNING id`;
    if (!rows.length) return send(res, 409, { ok: false, error: 'ใบงานนี้เป็นของครูคนอื่น' });
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return send(res, 500, { ok: false, error: 'เซิร์ฟเวอร์ขัดข้อง' });
  }
}
