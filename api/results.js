// ครูอ่านคะแนนของตัวเอง (ต้องเข้าสู่ระบบ)
//   GET  /api/results                     → { worksheets: [...] }
//   GET  /api/results?worksheet=<id>      → { rows: [...] }
//   POST /api/results { action: 'delete', id }   ลบงานที่ส่งหนึ่งรายการ
import { sql, send, readJson, currentTeacher, rowToResult } from './_lib/core.js';

export default async function handler(req, res) {
  try {
    const teacher = await currentTeacher(req);
    if (!teacher) return send(res, 401, { ok: false, error: 'กรุณาเข้าสู่ระบบ' });

    if (req.method === 'POST') {
      const body = await readJson(req);
      if (body && body.action === 'delete' && body.id) {
        const r = await sql`DELETE FROM submissions WHERE id = ${String(body.id)} AND teacher_id = ${teacher.id} RETURNING id`;
        return send(res, 200, { ok: r.length > 0 });
      }
      return send(res, 400, { ok: false, error: 'ไม่รู้จักคำสั่ง' });
    }

    const worksheet = req.query && req.query.worksheet;
    if (worksheet) {
      const rows = await sql`
        SELECT * FROM submissions WHERE teacher_id = ${teacher.id} AND worksheet_id = ${String(worksheet)}
        ORDER BY created_at DESC LIMIT 5000`;
      const meta = await sql`SELECT classes FROM worksheets WHERE id = ${String(worksheet)} AND teacher_id = ${teacher.id}`;
      return send(res, 200, { ok: true, classes: meta[0]?.classes || [], rows: rows.map(rowToResult) });
    }

    const list = await sql`
      SELECT w.id, w.title, w.classes, w.pkg IS NOT NULL AS hosted, w.public_leaderboard, w.updated_at,
             COUNT(s.id)::int AS submissions, MAX(s.created_at) AS last_submission
      FROM worksheets w LEFT JOIN submissions s ON s.worksheet_id = w.id AND s.teacher_id = w.teacher_id
      WHERE w.teacher_id = ${teacher.id}
      GROUP BY w.id ORDER BY COALESCE(MAX(s.created_at), w.updated_at) DESC`;
    return send(res, 200, {
      ok: true,
      worksheets: list.map(w => ({
        id: w.id, title: w.title, classes: w.classes, hosted: w.hosted, publicLeaderboard: w.public_leaderboard, submissions: w.submissions,
        lastSubmission: w.last_submission ? new Date(w.last_submission).toISOString() : null
      }))
    });
  } catch (e) {
    console.error(e);
    return send(res, 500, { ok: false, error: 'เซิร์ฟเวอร์ขัดข้อง' });
  }
}
