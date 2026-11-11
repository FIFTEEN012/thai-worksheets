// ให้ AI (Claude) สร้างใบงานจากคำสั่งของครูบนเว็บ
//   POST /api/generate { prompt, level, count, classes[], theme, illustrations }
//   → { ok, worksheetId, title, studentLink, editorLink, fields, theme, warnings }
// ต้องเข้าสู่ระบบครู มีโควตาต่อวัน (AI_DAILY_LIMIT, ค่าเริ่มต้น 20 ครั้ง/ครู/วัน)
// ต้องตั้งค่า ANTHROPIC_API_KEY ใน Vercel
import Anthropic from '@anthropic-ai/sdk';
import { sql, send, readJson, currentTeacher, siteOrigin } from './_lib/core.js';
import { buildWorksheet, THEMES, graphicsIndex } from './_lib/build.js';

const MODEL = 'claude-opus-5-5';

const SYSTEM = `You design beautiful, self-grading online worksheets for Thai teachers. Reply with ONE JSON object only (a \`\`\`json code block is fine), no other text.

Shape:
{
  "title": "ชื่อใบงาน (short, Thai)",
  "instructions": "คำชี้แจงสั้น ๆ สำหรับนักเรียน",
  "theme": "<one of the theme ids>",
  "illustrations": [ { "id": "ill1", "alt": "คำอธิบายภาพ", "svg": "<svg ...>...</svg>" } ],
  "items": [ ... ]
}

Item formats (exact keys):
{ "type": "label", "text": "Section heading or instruction (Markdown **bold** ok)" }
{ "type": "image", "src": "ill1" | "lib:<sticker id>", "width": 0.2-0.6, "align": "center" | "left" | "right" }
{ "type": "text", "prompt": "Question", "answers": ["accepted answer", "synonym"] }
{ "type": "number", "prompt": "Question", "answer": 42, "tolerance": 0 }
{ "type": "formula", "prompt": "Question", "answers": ["\\\\frac{1}{2}"] }
{ "type": "truefalse", "prompt": "Statement", "correct": true }
{ "type": "single", "prompt": "Question", "options": ["A", "B", "C", "D"], "correct": 0 }
{ "type": "multi", "prompt": "Question", "options": ["A", "B", "C"], "correct": [0, 2] }
{ "type": "select", "prompt": "Question", "options": ["A", "B"], "correct": 1 }
{ "type": "essay", "prompt": "Long-answer task (graded by the teacher)", "maxWords": 0 }
{ "type": "gaps", "text": "น้ำเดือดที่ [100] องศาเซลเซียส และแข็งตัวที่ [0|ศูนย์] องศา" }
{ "type": "table", "prompt": "optional", "colHeaders": ["C1", "C2"], "rowHeaders": ["R1", "R2"], "rows": [["ans|alt", "c12"], ["c21", "c22"]] }
{ "type": "match", "prompt": "Question", "pairs": [{ "left": "A", "right": "1" }], "distractors": ["extra"] }
{ "type": "order", "prompt": "Question", "items": ["first", "second", "third"] }

Rules:
- "correct" indexes start at 0; in "multi" it is always a list; every gaps blank is in [ ] with alternatives separated by |; "order" items are listed in the CORRECT order (they get shuffled).
- Do NOT number the prompts ("1.", "ข้อ 1"): the design adds number badges itself. Do NOT repeat the title as a label: it goes in the header banner.
- Group questions into 2-3 parts with "label" headings such as "ตอนที่ 1 เลือกคำตอบที่ถูกต้อง".
- Vary the question types to fit the topic; plausible distractors of similar length; one defensible answer per question; text/number answers of 1-3 words; at most one essay.
- Write everything in Thai unless the teacher asks otherwise, at the requested grade level.

Design:
- Pick the theme that suits the subject and age: THEMES_LIST
- Illustrations: when asked for them, draw 1-3 original flat, colorful, child-friendly vector illustrations that actually teach or set the scene (e.g. a labelled-by-shape diagram, the scene of a story, the objects being counted). Each SVG: viewBox about 400x260, simple shapes and paths, rounded friendly style, soft palette that matches the theme, no external images, no fonts or <text> (labels belong in the questions), no scripts, under 6000 characters. Place each with an "image" item near the questions that use it.
- Small decorative stickers from the built-in library can be placed with "src": "lib:<id>" (width 0.12-0.2, align right): STICKERS_LIST. Use at most two.`;

function systemPrompt() {
  const themes = Object.entries(THEMES).map(([id, t]) => `${id} (${t.name})`).join(', ');
  const stickers = graphicsIndex().filter(g => g.category === 'sticker').map(g => `${g.id} (${g.name})`).join(', ');
  return SYSTEM.replace('THEMES_LIST', themes).replace('STICKERS_LIST', stickers);
}

function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

// สำหรับทดสอบในเครื่องโดยไม่เรียก API (ใช้ไม่ได้บน production)
function mockResponse(body) {
  return {
    title: 'ใบงานทดสอบ: ' + String(body.prompt).slice(0, 40),
    instructions: 'ตอบคำถามให้ครบทุกข้อ',
    theme: body.theme && body.theme !== 'auto' ? body.theme : 'playful',
    illustrations: body.illustrations === false ? [] : [{ id: 'ill1', alt: 'ภาพทดสอบ', svg: '<svg viewBox="0 0 400 260" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="260" rx="24" fill="#E3F2FD"/><circle cx="120" cy="130" r="60" fill="#FFC83D"/><circle cx="270" cy="140" r="40" fill="#66BB6A"/></svg>' }],
    items: [
      { type: 'label', text: 'ตอนที่ 1 เลือกคำตอบ' },
      { type: 'image', src: 'ill1', width: 0.45 },
      { type: 'single', prompt: 'ข้อใดถูกต้อง', options: ['ก', 'ข', 'ค'], correct: 0 },
      { type: 'truefalse', prompt: 'ข้อความนี้ถูกต้อง', correct: true },
      { type: 'label', text: 'ตอนที่ 2 เขียนคำตอบ' },
      { type: 'image', src: 'lib:star', width: 0.14, align: 'right' },
      { type: 'text', prompt: 'คำตอบคืออะไร', answers: ['คำตอบ'] }
    ]
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' });
  let teacher;
  try {
    teacher = await currentTeacher(req);
  } catch (e) { console.error(e); return send(res, 500, { ok: false, error: 'เซิร์ฟเวอร์ขัดข้อง' }); }
  if (!teacher) return send(res, 401, { ok: false, error: 'กรุณาเข้าสู่ระบบครูก่อน' });

  const body = await readJson(req);
  const prompt = String(body?.prompt || '').trim().slice(0, 4000);
  if (prompt.length < 3) return send(res, 400, { ok: false, error: 'พิมพ์คำสั่งว่าต้องการใบงานเรื่องอะไร' });
  const mock = process.env.AI_MOCK === '1' && process.env.VERCEL_ENV !== 'production';
  if (!mock && !process.env.ANTHROPIC_API_KEY) {
    return send(res, 503, { ok: false, error: 'ผู้ดูแลระบบยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY บน Vercel จึงยังใช้ AI สร้างใบงานไม่ได้' });
  }

  const limit = Math.max(1, Number(process.env.AI_DAILY_LIMIT) || 20);
  const used = await sql`
    SELECT COUNT(*)::int AS n FROM ai_generations
    WHERE teacher_id = ${teacher.id}
      AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')`;
  if (used[0].n >= limit) {
    return send(res, 429, { ok: false, error: `วันนี้ใช้ AI สร้างใบงานครบ ${limit} ครั้งแล้ว ลองใหม่พรุ่งนี้` });
  }

  const level = String(body.level || '').trim().slice(0, 60);
  const count = Math.max(3, Math.min(30, Number(body.count) || 10));
  const classes = (Array.isArray(body.classes) ? body.classes : String(body.classes || '').split(/\r?\n|,/))
    .map(c => String(c).trim()).filter(Boolean).slice(0, 50);
  const theme = THEMES[body.theme] ? body.theme : 'auto';
  const wantIll = body.illustrations !== false;
  const userMsg = [
    `คำสั่งของครู: ${prompt}`,
    level ? `ระดับชั้น: ${level}` : '',
    `จำนวนคำถามโดยประมาณ: ${count} ข้อ`,
    theme === 'auto' ? 'ธีม: เลือกให้เหมาะกับวิชาและวัย' : `ธีม: ${theme} (ใช้ธีมนี้)`,
    wantIll ? 'ภาพประกอบ: วาดภาพประกอบ SVG 1-3 ภาพที่ช่วยการเรียนรู้' : 'ภาพประกอบ: ไม่ต้องวาดภาพประกอบ (ใช้สติกเกอร์ได้)'
  ].filter(Boolean).join('\n');

  let data, usage = { input_tokens: 0, output_tokens: 0 };
  const logRow = async (ok, error, worksheetId) => {
    await sql`INSERT INTO ai_generations (teacher_id, worksheet_id, prompt, model, input_tokens, output_tokens, ok, error)
      VALUES (${teacher.id}, ${worksheetId || null}, ${prompt}, ${mock ? 'mock' : MODEL}, ${usage.input_tokens || 0}, ${usage.output_tokens || 0}, ${ok}, ${error || null})`;
  };

  try {
    if (mock) {
      data = mockResponse(body);
    } else {
      const client = new Anthropic();
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMsg }]
      });
      const msg = await stream.finalMessage();
      usage = msg.usage || usage;
      if (msg.stop_reason === 'refusal') {
        await logRow(false, 'refusal');
        return send(res, 422, { ok: false, error: 'AI ปฏิเสธคำสั่งนี้ ลองเปลี่ยนคำสั่งใหม่' });
      }
      if (msg.stop_reason === 'max_tokens') {
        await logRow(false, 'max_tokens');
        return send(res, 422, { ok: false, error: 'ใบงานยาวเกินไป ลองลดจำนวนข้อหรือภาพประกอบ' });
      }
      const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      data = extractJson(text);
      if (!data) {
        await logRow(false, 'bad json');
        return send(res, 502, { ok: false, error: 'AI ตอบกลับในรูปแบบที่อ่านไม่ได้ ลองกดสร้างอีกครั้ง' });
      }
    }

    if (theme !== 'auto') data.theme = theme;
    if (!THEMES[data.theme]) data.theme = 'clean';
    if (!wantIll) data.illustrations = [];
    const origin = siteOrigin(req);
    let built;
    try {
      built = await buildWorksheet({ ...data, classes, author: teacher.name }, { teacherCode: teacher.submit_code, apiUrl: `${origin}/api/submit` });
    } catch (e) {
      if (!e.userFacing) throw e;
      await logRow(false, e.message.slice(0, 500));
      return send(res, 502, { ok: false, error: 'AI สร้างใบงานไม่สมบูรณ์ ลองกดสร้างอีกครั้ง' });
    }
    await sql`INSERT INTO worksheets (id, teacher_id, title, classes, pkg)
      VALUES (${built.id}, ${teacher.id}, ${built.manifest.title}, ${built.manifest.settings.onlineSubmit.classes}, decode(${built.bytes.toString('base64')}, 'base64'))`;
    await logRow(true, null, built.id);
    const pkgUrl = `${origin}/api/worksheet?id=${built.id}&pkg=1`;
    return send(res, 200, {
      ok: true,
      worksheetId: built.id,
      title: built.manifest.title,
      theme: built.theme,
      fields: built.fields,
      pages: built.manifest.pages.length,
      pkgUrl,
      studentLink: `${origin}/alumno.html?url=${encodeURIComponent(pkgUrl)}`,
      editorLink: `${origin}/editor.html?ejemplo=${encodeURIComponent(`api/worksheet?id=${built.id}&pkg=1`)}`, // ตัวแก้ไขรับเฉพาะ path สัมพัทธ์
      warnings: built.warnings,
      remainingToday: limit - used[0].n - 1
    });
  } catch (e) {
    console.error(e);
    try { await logRow(false, String(e.message || e).slice(0, 500)); } catch { /* ignore */ }
    if (e instanceof Anthropic.RateLimitError) return send(res, 429, { ok: false, error: 'AI มีผู้ใช้มาก ลองใหม่อีกครู่' });
    if (e instanceof Anthropic.AuthenticationError) return send(res, 503, { ok: false, error: 'ANTHROPIC_API_KEY ไม่ถูกต้อง แจ้งผู้ดูแลระบบ' });
    if (e instanceof Anthropic.APIError) return send(res, 502, { ok: false, error: `AI ขัดข้อง (${e.status ?? 'เครือข่าย'}) ลองใหม่อีกครั้ง` });
    return send(res, 500, { ok: false, error: 'เซิร์ฟเวอร์ขัดข้อง' });
  }
}
