// นักเรียนส่งคะแนน (ไม่ต้องเข้าสู่ระบบ)
//   POST /api/submit  Content-Type: text/plain
//   { action: 'submit', teacher: '<รหัสส่งคะแนนของครู>', data: { …งานที่ส่ง (formato workpdf-entrega)… } }
// ถ้าใบงานไม่มีรหัสครู (ใบงานเก่า) คะแนนจะเข้าบัญชีผู้ดูแลระบบ
import { sql, send, cors, readJson, num } from './_lib/core.js';

const clip = (v, n) => String(v ?? '').slice(0, n);

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' });
  try {
    const body = await readJson(req);
    const d = body && body.data;
    if (!d || d.formato !== 'workpdf-entrega' || !String(d.alumno || '').trim() || !d.fichaId) {
      return send(res, 400, { ok: false, error: 'ข้อมูลงานที่ส่งไม่ครบ' });
    }

    let teachers = [];
    if (body.teacher) teachers = await sql`SELECT id FROM teachers WHERE submit_code = ${String(body.teacher)}`;
    if (!teachers.length) teachers = await sql`SELECT id FROM teachers WHERE is_admin ORDER BY created_at LIMIT 1`;
    if (!teachers.length) return send(res, 503, { ok: false, error: 'ระบบยังไม่มีบัญชีครู' });
    const teacherId = teachers[0].id;

    const score = num(d.nota);
    const total = num(d.total);
    const respuestas = Array.isArray(d.respuestas) ? d.respuestas.slice(0, 500) : [];
    const answers = respuestas.map(r => ({
      p: num(r.pagina), t: clip(r.tipo, 30),
      a: clip(r.respuestaTexto !== undefined ? r.respuestaTexto : (typeof r.respuesta === 'string' ? r.respuesta : ''), 500),
      e: num(r.puntos), m: num(r.maximo), r: clip(r.resultado, 20)
    }));
    const pending = answers.filter(a => a.r === 'pendiente').length;
    const incidents = Math.max(0, Math.floor(num(d.vigilancia && d.vigilancia.count)));
    const fichaId = clip(d.fichaId, 80);
    const title = clip(d.titulo, 300);

    await sql`
      INSERT INTO submissions (teacher_id, worksheet_id, worksheet_title, student_name, class_name,
        score, total, score10, pct, pending, incidents, code, answers)
      VALUES (${teacherId}, ${fichaId}, ${title}, ${clip(d.alumno, 120).trim()}, ${clip(d.grupo, 60).trim()},
        ${score}, ${total}, ${total > 0 ? Math.round(score / total * 1000) / 100 : 0},
        ${total > 0 ? Math.round(score / total * 100) : 0}, ${pending}, ${incidents},
        ${clip(d.codigo, 64)}, ${JSON.stringify(answers)}::jsonb)`;
    // จดใบงานไว้ในรายการของครู (ไม่แย่งใบงานของครูคนอื่น)
    await sql`
      INSERT INTO worksheets (id, teacher_id, title) VALUES (${fichaId}, ${teacherId}, ${title})
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = now()
      WHERE worksheets.teacher_id = EXCLUDED.teacher_id`;
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return send(res, 500, { ok: false, error: 'เซิร์ฟเวอร์ขัดข้อง' });
  }
}
