// บัญชีครู: สมัคร เข้าสู่ระบบ ออกจากระบบ และกุญแจเชื่อมต่อ MCP
//   GET  /api/auth                      → { teacher } หรือ { teacher: null }
//   POST /api/auth { action: 'register', email, name, password, signupCode }
//   POST /api/auth { action: 'login', email, password }
//   POST /api/auth { action: 'logout' }
//   POST /api/auth { action: 'mcpKey' }      → { key } (แสดงครั้งเดียว กุญแจเดิมใช้ไม่ได้)
//   POST /api/auth { action: 'mcpKeyRevoke' }
import {
  sql, send, readJson, hashPassword, verifyPassword, sessionCookie, clearSessionCookie,
  currentTeacher, publicTeacher, randomCode, randomToken, sha256
} from './_lib/core.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return send(res, 200, { ok: true, teacher: publicTeacher(await currentTeacher(req)) });
    }
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' });
    const body = await readJson(req);
    if (!body) return send(res, 400, { ok: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง' });

    if (body.action === 'register') {
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim().slice(0, 120);
      const password = String(body.password || '');
      if (!process.env.SIGNUP_CODE || String(body.signupCode || '').trim() !== process.env.SIGNUP_CODE) {
        return send(res, 403, { ok: false, error: 'รหัสสมัครสมาชิกไม่ถูกต้อง (ขอได้จากผู้ดูแลระบบ)' });
      }
      if (!EMAIL_RE.test(email)) return send(res, 400, { ok: false, error: 'อีเมลไม่ถูกต้อง' });
      if (!name) return send(res, 400, { ok: false, error: 'กรอกชื่อครู' });
      if (password.length < 8) return send(res, 400, { ok: false, error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' });
      const exists = await sql`SELECT 1 FROM teachers WHERE email = ${email}`;
      if (exists.length) return send(res, 409, { ok: false, error: 'อีเมลนี้สมัครไว้แล้ว ให้เข้าสู่ระบบแทน' });
      // บัญชีแรกของระบบเป็นผู้ดูแลระบบ
      const rows = await sql`
        INSERT INTO teachers (email, name, password_hash, submit_code, is_admin)
        VALUES (${email}, ${name}, ${hashPassword(password)}, ${randomCode(10)}, NOT EXISTS (SELECT 1 FROM teachers))
        RETURNING id, email, name, submit_code, is_admin`;
      res.setHeader('Set-Cookie', sessionCookie(rows[0].id));
      return send(res, 200, { ok: true, teacher: publicTeacher(rows[0]) });
    }

    if (body.action === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const rows = await sql`SELECT id, email, name, submit_code, is_admin, password_hash, (mcp_key_hash IS NOT NULL) AS has_mcp_key FROM teachers WHERE email = ${email}`;
      // หน่วงเวลาเล็กน้อยเสมอ กันการเดารหัสผ่านแบบรัว ๆ
      await new Promise(r => setTimeout(r, 400));
      if (!rows.length || !verifyPassword(String(body.password || ''), rows[0].password_hash)) {
        return send(res, 401, { ok: false, error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
      }
      res.setHeader('Set-Cookie', sessionCookie(rows[0].id));
      return send(res, 200, { ok: true, teacher: publicTeacher(rows[0]) });
    }

    if (body.action === 'logout') {
      res.setHeader('Set-Cookie', clearSessionCookie);
      return send(res, 200, { ok: true });
    }

    const teacher = await currentTeacher(req);
    if (!teacher) return send(res, 401, { ok: false, error: 'กรุณาเข้าสู่ระบบ' });

    if (body.action === 'mcpKey') {
      const key = 'owsk_' + randomToken(24);
      await sql`UPDATE teachers SET mcp_key_hash = ${sha256(key)} WHERE id = ${teacher.id}`;
      return send(res, 200, { ok: true, key });
    }
    if (body.action === 'mcpKeyRevoke') {
      await sql`UPDATE teachers SET mcp_key_hash = NULL WHERE id = ${teacher.id}`;
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { ok: false, error: 'ไม่รู้จักคำสั่ง' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { ok: false, error: 'เซิร์ฟเวอร์ขัดข้อง' });
  }
}
