// เซิร์ฟเวอร์ MCP บนเว็บ (Streamable HTTP, JSON-RPC 2.0) สำหรับเชื่อมกับ Claude.ai / แอป Claude ฯลฯ
// URL สำหรับเพิ่มเป็น connector: https://<เว็บ>/mcp/<กุญแจ MCP ของครู>
// (vercel.json เขียนทางให้ /mcp/<key> → /api/mcp?key=<key>; หรือส่ง Authorization: Bearer <key>)
import { sql, cors, readJson, teacherByMcpKey, siteOrigin, rowToResult } from './_lib/core.js';
import { buildWorksheet, THEMES, graphicsIndex } from './_lib/build.js';

const SERVER_INFO = { name: 'thai-worksheets', title: 'ใบงานออนไลน์ภาษาไทย', version: '1.0.0' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `เครื่องมือสำหรับครู: สร้างใบงานออนไลน์ตรวจอัตโนมัติภาษาไทย แล้วดูคะแนนที่นักเรียนส่งแยกตามห้องเรียน
- create_worksheet สร้างใบงานจากรายการคำถาม แล้วคืน "ลิงก์สำหรับนักเรียน" ที่แชร์ได้ทันที คะแนนจะกลับมาที่บัญชีครูอัตโนมัติ
- list_worksheets / get_scores / class_summary ใช้ดูคะแนน
เขียนเนื้อหาใบงานเป็นภาษาไทย เว้นแต่ครูขอภาษาอื่น`;

const ITEM_DOC = `Each item is one of (use exactly these keys):
{ "type": "label", "text": "Title or instruction (Markdown: **bold**, # heading; LaTeX between \\\\( and \\\\))" }
{ "type": "text", "prompt": "Question", "answers": ["accepted answer", "synonym"] }
{ "type": "number", "prompt": "Question", "answer": 42, "tolerance": 0 }
{ "type": "formula", "prompt": "Question", "answers": ["\\\\frac{1}{2}"] }
{ "type": "truefalse", "prompt": "Statement", "correct": true }
{ "type": "single", "prompt": "Question", "options": ["A", "B", "C"], "correct": 0 }
{ "type": "multi", "prompt": "Question", "options": ["A", "B", "C"], "correct": [0, 2] }
{ "type": "select", "prompt": "Question", "options": ["A", "B"], "correct": 1 }
{ "type": "essay", "prompt": "Long-answer task (graded by the teacher)", "maxWords": 0 }
{ "type": "gaps", "text": "Water boils at [100] degrees and freezes at [0|zero]." }
{ "type": "table", "prompt": "optional", "colHeaders": ["C1", "C2"], "rowHeaders": ["R1", "R2"], "rows": [["ans|alt", "c12"], ["c21", "c22"]] }
{ "type": "match", "prompt": "Question", "pairs": [{ "left": "A", "right": "1" }], "distractors": ["extra"] }
{ "type": "order", "prompt": "Question", "items": ["first", "second", "third"] }
Rules: "correct" indexes start at 0; in "multi" it is always a list; in "gaps" every blank is in [ ] with alternatives separated by |; "order" items are given in the CORRECT order (they are shuffled for students). Do NOT repeat the title as a label and do NOT number prompts: the design adds a header banner and number badges. Group questions into parts with "label" headings. Vary question types, make distractors plausible, keep text answers to 1–3 words, use "essay" at most once or twice. Thai text answers ignore spacing between Thai words automatically.

Pictures: { "type": "image", "src": "<illustration id>" | "lib:<sticker id>", "width": 0.12-0.6, "align": "center" | "left" | "right" }
Draw 1-3 original illustrations in "illustrations" when they help: flat, colorful, child-friendly SVG, viewBox about 400x260, simple shapes, no <text>, no external images or scripts, under 6000 characters each.`;

const THEME_DOC = () => Object.entries(THEMES).map(([id, t]) => `${id} (${t.name})`).join(', ');
const STICKER_DOC = () => graphicsIndex().filter(g => g.category === 'sticker').map(g => g.id).join(', ');

const TOOLS = [
  {
    name: 'create_worksheet',
    title: 'สร้างใบงาน',
    description: 'Create a self-grading online worksheet (Thai by default) and return a student link to share. Scores from students are saved to this teacher\'s account automatically.\n\n' + ITEM_DOC + '\nStickers for lib: ' + STICKER_DOC(),
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Worksheet title' },
        instructions: { type: 'string', description: 'Instructions shown to students before they start (optional)' },
        author: { type: 'string', description: 'Teacher name shown on the worksheet (optional)' },
        classes: { type: 'array', items: { type: 'string' }, description: 'Class list students must pick from, e.g. ["ม.1/1","ม.1/2"] (optional; empty = students type it)' },
        theme: { type: 'string', description: 'Visual theme: ' + THEME_DOC() + '. Pick one that suits the subject and age (default clean).' },
        illustrations: { type: 'array', description: 'Original SVG illustrations referenced by image items: [{ "id": "ill1", "alt": "...", "svg": "<svg ...>" }]', items: { type: 'object', properties: { id: { type: 'string' }, alt: { type: 'string' }, svg: { type: 'string' } }, required: ['id', 'svg'] } },
        items: { type: 'array', items: { type: 'object' }, description: 'Questions and texts, see the item formats in the tool description' }
      },
      required: ['title', 'items']
    }
  },
  {
    name: 'list_worksheets',
    title: 'รายการใบงาน',
    description: 'List this teacher\'s worksheets with submission counts, ids and student links (for worksheets created here).',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_scores',
    title: 'ดูคะแนน',
    description: 'Get student scores for one worksheet, optionally for one class. By default only each student\'s latest attempt.',
    inputSchema: {
      type: 'object',
      properties: {
        worksheet_id: { type: 'string', description: 'Worksheet id from list_worksheets' },
        class_name: { type: 'string', description: 'Class, e.g. "ม.1/1" (optional)' },
        all_attempts: { type: 'boolean', description: 'Include every attempt, not only the latest (default false)' },
        include_answers: { type: 'boolean', description: 'Include per-question answers (default false)' }
      },
      required: ['worksheet_id']
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'class_summary',
    title: 'สรุปรายห้อง',
    description: 'Per-class summary for a worksheet: students, average out of 10, pass rate (>=50%), and the hardest questions.',
    inputSchema: { type: 'object', properties: { worksheet_id: { type: 'string' } }, required: ['worksheet_id'] },
    annotations: { readOnlyHint: true }
  }
];

const r2 = n => Math.round(Number(n) * 100) / 100;
const studentLink = (origin, id) => `${origin}/alumno.html?url=${encodeURIComponent(`${origin}/api/worksheet?id=${id}&pkg=1`)}`;

function latestOnly(rows) {
  const seen = new Set();
  return rows.filter(r => { // rows เรียงจากใหม่ไปเก่า
    const k = r.grupo + '\u0000' + r.alumno.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

async function ownedWorksheet(teacher, id) {
  const rows = await sql`SELECT id, title, classes, pkg IS NOT NULL AS hosted FROM worksheets WHERE id = ${String(id || '')} AND teacher_id = ${teacher.id}`;
  return rows[0] || null;
}

const text = (t, structured) => ({ content: [{ type: 'text', text: t }], ...(structured ? { structuredContent: structured } : {}) });
const toolError = t => ({ content: [{ type: 'text', text: t }], isError: true });

async function callTool(name, args, teacher, origin) {
  args = args || {};
  if (name === 'create_worksheet') {
    if (!Array.isArray(args.items) || !args.items.length) return toolError('items ต้องเป็นรายการคำถามอย่างน้อย 1 รายการ');
    let built;
    try {
      built = await buildWorksheet(args, { teacherCode: teacher.submit_code, apiUrl: `${origin}/api/submit` });
    } catch (e) {
      if (e.userFacing) return toolError(e.message);
      throw e;
    }
    const classes = built.manifest.settings.onlineSubmit.classes;
    await sql`INSERT INTO worksheets (id, teacher_id, title, classes, pkg) VALUES (${built.id}, ${teacher.id}, ${built.manifest.title}, ${classes}, decode(${built.bytes.toString('base64')}, 'base64'))`;
    const link = studentLink(origin, built.id);
    const lines = [
      `สร้างใบงาน «${built.manifest.title}» แล้ว (${built.fields} ช่อง, ${built.manifest.pages.length} หน้า)`,
      `ลิงก์สำหรับนักเรียน: ${link}`,
      `แก้ไขในตัวแก้ไข: ${origin}/editor.html?ejemplo=${encodeURIComponent(`api/worksheet?id=${built.id}&pkg=1`)}`,
      `ดูคะแนน: ${origin}/resultados.html`,
      `worksheet_id: ${built.id} · ธีม: ${built.theme}`,
      classes.length ? `ห้องเรียนที่ให้นักเรียนเลือก: ${classes.join(', ')}` : 'นักเรียนจะพิมพ์ห้องเอง (ไม่ได้กำหนดรายชื่อห้อง)'
    ];
    if (built.warnings.length) lines.push('คำเตือน: ' + built.warnings.join(' / '));
    return text(lines.join('\n'), { worksheet_id: built.id, student_link: link, fields: built.fields });
  }

  if (name === 'list_worksheets') {
    const list = await sql`
      SELECT w.id, w.title, w.classes, w.pkg IS NOT NULL AS hosted, COUNT(s.id)::int AS n, MAX(s.created_at) AS last
      FROM worksheets w LEFT JOIN submissions s ON s.worksheet_id = w.id AND s.teacher_id = w.teacher_id
      WHERE w.teacher_id = ${teacher.id} GROUP BY w.id ORDER BY COALESCE(MAX(s.created_at), w.updated_at) DESC LIMIT 100`;
    if (!list.length) return text('ยังไม่มีใบงาน');
    const out = list.map(w => ({ worksheet_id: w.id, title: w.title, submissions: w.n, classes: w.classes, last_submission: w.last, student_link: w.hosted ? studentLink(origin, w.id) : null }));
    return text(out.map(w => `- ${w.title} (worksheet_id: ${w.worksheet_id}) งานที่ส่ง ${w.submissions}${w.student_link ? `\n  ลิงก์นักเรียน: ${w.student_link}` : ''}`).join('\n'), { worksheets: out });
  }

  if (name === 'get_scores' || name === 'class_summary') {
    const ws = await ownedWorksheet(teacher, args.worksheet_id);
    let rows = (await sql`SELECT * FROM submissions WHERE teacher_id = ${teacher.id} AND worksheet_id = ${String(args.worksheet_id || '')} ORDER BY created_at DESC LIMIT 5000`).map(rowToResult);
    if (!ws && !rows.length) return toolError('ไม่พบใบงานนี้ในบัญชีของคุณ ใช้ list_worksheets เพื่อดู worksheet_id');
    const title = ws?.title || rows[0]?.titulo || '';

    if (name === 'class_summary') {
      rows = latestOnly(rows);
      const byClass = new Map();
      for (const r of rows) {
        const c = r.grupo || '(ไม่ระบุห้อง)';
        const o = byClass.get(c) || { class_name: c, students: 0, sum10: 0, passed: 0 };
        o.students++; o.sum10 += r.nota10; if (r.pct >= 50) o.passed++;
        byClass.set(c, o);
      }
      const classes = [...byClass.values()].sort((a, b) => a.class_name.localeCompare(b.class_name, 'th', { numeric: true }))
        .map(o => ({ class_name: o.class_name, students: o.students, average_10: r2(o.sum10 / o.students), pass_rate_pct: Math.round(o.passed / o.students * 100) }));
      // ข้อที่ผิดมากที่สุด
      const qs = new Map();
      for (const r of rows) (r.detalle || []).forEach((d, i) => {
        if (!d.m) return;
        const q = qs.get(i) || { question: i + 1, type: d.t, earned: 0, max: 0 };
        q.earned += Number(d.e) || 0; q.max += Number(d.m) || 0; qs.set(i, q);
      });
      const hardest = [...qs.values()].map(q => ({ question: q.question, type: q.type, correct_pct: q.max ? Math.round(q.earned / q.max * 100) : 0 }))
        .sort((a, b) => a.correct_pct - b.correct_pct).slice(0, 5);
      const t = [`สรุป «${title}» (นักเรียน ${rows.length} คน, นับเฉพาะครั้งล่าสุด)`, '| ห้อง | นักเรียน | เฉลี่ย /10 | ผ่าน (≥50%) |', '|---|---|---|---|',
        ...classes.map(c => `| ${c.class_name} | ${c.students} | ${c.average_10} | ${c.pass_rate_pct}% |`),
        hardest.length ? '\nข้อที่นักเรียนทำได้น้อยที่สุด: ' + hardest.map(h => `ข้อ ${h.question} (${h.correct_pct}%)`).join(', ') : ''].join('\n');
      return text(t, { worksheet_id: args.worksheet_id, title, classes, hardest_questions: hardest });
    }

    if (args.class_name) rows = rows.filter(r => r.grupo === String(args.class_name));
    if (!args.all_attempts) rows = latestOnly(rows);
    rows.sort((a, b) => a.grupo.localeCompare(b.grupo, 'th', { numeric: true }) || a.alumno.localeCompare(b.alumno, 'th'));
    const out = rows.map(r => ({
      student: r.alumno, class_name: r.grupo, score: r.nota, total: r.total, score_10: r.nota10, pct: r.pct,
      pending_manual: r.pendientes, focus_incidents: r.vigilancia, submitted_at: r.fecha,
      ...(args.include_answers ? { answers: r.detalle } : {})
    }));
    const t = [`คะแนน «${title}»${args.class_name ? ` ห้อง ${args.class_name}` : ''} (${out.length} คน)`, '| ชื่อ | ห้อง | คะแนน | /10 | % |', '|---|---|---|---|---|',
      ...out.map(o => `| ${o.student} | ${o.class_name} | ${o.score}/${o.total} | ${o.score_10} | ${o.pct} |`)].join('\n');
    return text(t, { worksheet_id: args.worksheet_id, title, scores: out });
  }
  return null;
}

async function handleMessage(msg, teacher, origin) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;
  const reply = result => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return fail(-32600, 'Invalid Request');
  if (isNotification) return null;
  switch (method) {
    case 'initialize': {
      const requested = params && params.protocolVersion;
      return reply({
        protocolVersion: PROTOCOLS.includes(requested) ? requested : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS
      });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      try {
        const result = await callTool(params && params.name, params && params.arguments, teacher, origin);
        if (!result) return fail(-32602, `Unknown tool: ${params && params.name}`);
        return reply(result);
      } catch (e) {
        console.error(e);
        return reply(toolError('เซิร์ฟเวอร์ขัดข้อง: ' + (e.message || e)));
      }
    }
    case 'resources/list': return reply({ resources: [] });
    case 'prompts/list': return reply({ prompts: [] });
    default: return fail(-32601, `Method not found: ${method}`);
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  const sendJson = (status, data) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(data));
  };
  // ไม่มีการส่งข้อความจากเซิร์ฟเวอร์ (SSE) จึงไม่รองรับ GET
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); return sendJson(405, { error: 'Use POST (MCP Streamable HTTP)' }); }

  const auth = String(req.headers.authorization || '');
  const key = (req.query && req.query.key) || (auth.startsWith('Bearer ') ? auth.slice(7).trim() : '');
  let teacher;
  try { teacher = await teacherByMcpKey(key); } catch (e) { console.error(e); return sendJson(500, { error: 'server error' }); }
  if (!teacher) return sendJson(401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'กุญแจ MCP ไม่ถูกต้อง สร้างกุญแจใหม่ได้ที่หน้า «ดูคะแนน» → การเชื่อมต่อ MCP' } });

  const body = await readJson(req);
  if (body === null) return sendJson(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  const origin = siteOrigin(req);
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(m => handleMessage(m, teacher, origin)))).filter(Boolean);
    if (!out.length) { res.statusCode = 202; return res.end(); }
    return sendJson(200, out);
  }
  const out = await handleMessage(body, teacher, origin);
  if (!out) { res.statusCode = 202; return res.end(); }
  return sendJson(200, out);
}
