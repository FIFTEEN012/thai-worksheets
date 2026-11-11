// ส่วนกลางของ API: ฐานข้อมูล Neon, รหัสผ่าน, เซสชันครู และตัวช่วย HTTP
import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

let _sql = null;
export function sql(strings, ...values) {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql(strings, ...values);
}

// ---------- HTTP ----------

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version');
}

// Vercel แปลง body ให้แล้วตาม Content-Type: JSON → object, text/plain → string
export async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!raw && req.readable) {
    raw = await new Promise((resolve, reject) => {
      let s = '';
      req.on('data', c => { s += c; if (s.length > 2e6) reject(new Error('body too large')); });
      req.on('end', () => resolve(s));
      req.on('error', reject);
    });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return null; }
}

export function siteOrigin(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

// ---------- รหัสผ่านและโทเคน ----------

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [kind, saltB64, hashB64] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, got);
}

export const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// รหัสส่งคะแนน (อยู่ในไฟล์ใบงาน): สั้น อ่านง่าย ไม่ใช่ความลับระดับรหัสผ่าน
export function randomCode(n = 10) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(n);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

// ---------- เซสชันครู (คุกกี้ลงลายมือชื่อ HMAC) ----------

const SESSION_COOKIE = 'ows_session';
const SESSION_DAYS = 30;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET is not set');
  return s;
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function sessionCookie(teacherId) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const payload = `${teacherId}.${exp}`;
  const value = `${payload}.${sign(payload)}`;
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export const clearSessionCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// คืนข้อมูลครูที่เข้าสู่ระบบอยู่ หรือ null
export async function currentTeacher(req) {
  const value = parseCookies(req)[SESSION_COOKIE];
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const expected = sign(`${id}.${exp}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  const rows = await sql`SELECT id, email, name, submit_code, is_admin, (mcp_key_hash IS NOT NULL) AS has_mcp_key FROM teachers WHERE id = ${id}`;
  return rows[0] || null;
}

export async function teacherByMcpKey(key) {
  if (!key || key.length < 20) return null;
  const rows = await sql`SELECT id, email, name, submit_code, is_admin FROM teachers WHERE mcp_key_hash = ${sha256(key)}`;
  return rows[0] || null;
}

export const publicTeacher = t => t && ({ email: t.email, name: t.name, submitCode: t.submit_code, isAdmin: t.is_admin, hasMcpKey: Boolean(t.has_mcp_key) });

// ---------- งานที่ส่ง ----------

export const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function rowToResult(r) {
  return {
    id: String(r.id),
    fecha: new Date(r.created_at).toISOString(),
    titulo: r.worksheet_title, fichaId: r.worksheet_id, grupo: r.class_name, alumno: r.student_name,
    nota: num(r.score), total: num(r.total), nota10: num(r.score10), pct: r.pct,
    pendientes: r.pending, vigilancia: r.incidents, codigo: r.code, detalle: r.answers || []
  };
}
