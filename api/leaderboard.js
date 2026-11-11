// ตารางผู้นำสำหรับนักเรียน (สาธารณะ แต่ตอบเฉพาะใบงานที่ครูเปิดให้เห็น)
//   GET /api/leaderboard?worksheet=<id>&class=<ห้อง>
//   → { ok, enabled, top: [{ name: 'สมชาย ใ.', pct }] }  (10 อันดับ คะแนนดีที่สุดของแต่ละคน)
// แสดงเฉพาะชื่อแรก + อักษรแรกของนามสกุล เพื่อความเป็นส่วนตัว
import { sql, send, cors } from './_lib/core.js';

function shortName(n) {
  const w = String(n || '').trim().split(/\s+/).filter(Boolean);
  return w.length > 1 ? `${w[0]} ${[...w[1]][0]}.` : (w[0] || '');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  try {
    const id = String(req.query?.worksheet || '').slice(0, 80);
    const cls = String(req.query?.class || '').slice(0, 60);
    const ws = await sql`SELECT teacher_id, public_leaderboard FROM worksheets WHERE id = ${id}`;
    if (!ws.length || !ws[0].public_leaderboard) return send(res, 200, { ok: true, enabled: false });
    const rows = await sql`
      SELECT student_name, MAX(pct) AS pct, MIN(created_at) AS first_at
      FROM submissions
      WHERE worksheet_id = ${id} AND teacher_id = ${ws[0].teacher_id} AND class_name = ${cls}
      GROUP BY lower(trim(student_name)), student_name
      ORDER BY MAX(pct) DESC, MIN(created_at) ASC
      LIMIT 10`;
    res.setHeader('Cache-Control', 'public, max-age=20');
    return send(res, 200, { ok: true, enabled: true, top: rows.map(r => ({ name: shortName(r.student_name), pct: Number(r.pct) || 0 })) });
  } catch (e) {
    console.error(e);
    return send(res, 500, { ok: false, error: 'เซิร์ฟเวอร์ขัดข้อง' });
  }
}
