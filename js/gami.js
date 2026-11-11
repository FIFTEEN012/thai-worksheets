// PRS Worksheet: เกมมิฟิเคชันฝั่งนักเรียน
// ดาว 0–3 ตามคะแนน · XP · ทำต่อเนื่องกี่วัน (streak) · เหรียญรางวัล · พลุกระดาษ · มาสคอตน้องฟ้า
// เก็บสถิติไว้ในเบราว์เซอร์ของนักเรียน (แยกตามชื่อ + ห้อง) ไม่ส่งขึ้นเซิร์ฟเวอร์
import { el } from './util.js';

const STORE = 'prs.gami.v1';
const API = () => (window.OPENWORKSHEETS_CONFIG?.apiBase || '/api').replace(/\/+$/, '');

const BADGES = [
  { id: 'first', ic: '🎉', name: 'ใบงานแรก', test: s => s.count >= 1 },
  { id: 'perfect', ic: '💯', name: 'เต็มร้อย', test: (s, r) => r.pct >= 100 },
  { id: 'streak3', ic: '🔥', name: 'ต่อเนื่อง 3 วัน', test: s => s.streak >= 3 },
  { id: 'streak7', ic: '⚡', name: 'ต่อเนื่อง 7 วัน', test: s => s.streak >= 7 },
  { id: 'five', ic: '📚', name: 'ครบ 5 ใบงาน', test: s => s.count >= 5 },
  { id: 'ten', ic: '🏅', name: 'ครบ 10 ใบงาน', test: s => s.count >= 10 },
  { id: 'xp500', ic: '💎', name: 'สะสม 500 XP', test: s => s.xp >= 500 }
];

const MESSAGES = {
  3: ['สุดยอดไปเลย! 🎉', 'เก่งมาก ๆ เต็มที่เลย!', 'ว้าว! ทำได้ยอดเยี่ยม'],
  2: ['เก่งมาก! อีกนิดเดียวก็เต็มแล้ว', 'ดีมากเลย! ✨', 'ทำได้ดีมาก ไปต่อกัน!'],
  1: ['ดีแล้ว! ลองทวนอีกนิดนะ', 'ไปได้สวย ฝึกอีกหน่อยจะเก่งขึ้น'],
  0: ['ไม่เป็นไรนะ ฝึกอีกนิดเดี๋ยวก็เก่ง 💪', 'เริ่มต้นแล้ว เก่งมาก! ลองอีกครั้งนะ']
};

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD ตามเวลาเครื่อง
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

function load() { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } }
function save(all) { try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* ignore */ } }

export function starsFor(pct) { return pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 40 ? 1 : 0; }

// บันทึกผลหนึ่งครั้ง คืนค่า { xpGained, stats, newBadges }
function record({ alumno, grupo, pct, stars, fichaId }) {
  const all = load();
  const key = (String(grupo || '') + '|' + String(alumno || '').trim().toLowerCase());
  const s = all[key] || { xp: 0, count: 0, streak: 0, lastDay: '', badges: [], done: {} };
  const d = today();
  if (s.lastDay !== d) s.streak = s.lastDay && dayDiff(s.lastDay, d) === 1 ? s.streak + 1 : 1;
  s.lastDay = d;
  const firstTime = !s.done[fichaId];
  const xpGained = 10 + Math.round(pct * 0.5) + stars * 5 + (s.streak > 1 ? Math.min(20, s.streak * 2) : 0);
  s.xp += xpGained;
  if (firstTime) s.count += 1;
  s.done[fichaId] = Math.max(s.done[fichaId] || 0, pct);
  const newBadges = BADGES.filter(b => !s.badges.includes(b.id) && b.test(s, { pct }));
  s.badges.push(...newBadges.map(b => b.id));
  all[key] = s;
  save(all);
  return { xpGained, stats: s, newBadges };
}

// ---------- พลุกระดาษ ----------
export function confetti(ms = 2600) {
  const cv = el('canvas', { class: 'prs-confetti' });
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const W = cv.width = innerWidth, H = cv.height = innerHeight;
  const colors = ['#1E9BF0', '#FFC93C', '#2ED8A3', '#FF6B6B', '#9B7BFF', '#4CC0FF'];
  const parts = Array.from({ length: 160 }, () => ({
    x: W / 2 + (Math.random() - .5) * W * .3, y: H * .35, r: 4 + Math.random() * 6,
    vx: (Math.random() - .5) * 14, vy: -6 - Math.random() * 12, rot: Math.random() * 6, vr: (Math.random() - .5) * .3,
    c: colors[(Math.random() * colors.length) | 0], sq: Math.random() < .5
  }));
  const t0 = performance.now();
  (function frame(t) {
    const k = (t - t0) / ms;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      if (p.sq) ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6); else { ctx.beginPath(); ctx.arc(0, 0, p.r / 2, 0, 7); ctx.fill(); }
      ctx.restore();
    }
    if (k < 1) requestAnimationFrame(frame); else cv.remove();
  })(t0);
}

const STAR_SVG = () => `<svg class="prs-star" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6l12.9 26.2 28.9 4.2-20.9 20.4 4.9 28.8L50 72.3 24.2 85.6l4.9-28.8L8.2 36.4l28.9-4.2z" stroke-width="5" stroke-linejoin="round"/></svg>`;

// สร้างส่วนฉลองไว้บนสุดของการ์ดผลลัพธ์
// opts = { pct, showScore, alumno, grupo, fichaId, preview }
export function celebrate(card, opts) {
  const pct = Math.max(0, Math.min(100, Math.round(opts.pct || 0)));
  const stars = opts.showScore === false ? 1 : starsFor(pct);
  const msgs = MESSAGES[stars];
  const msg = msgs[(Math.random() * msgs.length) | 0];
  const pose = stars >= 2 ? 'cheer' : stars === 1 ? 'happy' : 'think';
  const res = opts.preview ? { xpGained: 10 + Math.round(pct * .5) + stars * 5, stats: null, newBadges: [] } : record({ ...opts, pct, stars });

  const wrap = el('div', { class: 'prs-celebrate' });
  wrap.appendChild(el('img', { class: 'prs-mascot', src: `graphics/mascot-${pose}.svg`, alt: '' }));
  const starsEl = el('div', { class: 'prs-stars', 'aria-label': `ได้ ${stars} ดาว จาก 3` });
  starsEl.innerHTML = [1, 2, 3].map(() => STAR_SVG()).join('');
  wrap.appendChild(starsEl);
  wrap.appendChild(el('p', { class: 'prs-cheer' }, msg));
  const chips = el('div', { class: 'prs-chips' },
    el('span', { class: 'prs-chip xp' }, `⚡ +${res.xpGained} XP`));
  if (opts.showScore !== false) chips.appendChild(el('span', { class: 'prs-chip acc' }, `🎯 ถูก ${pct}%`));
  if (res.stats) chips.appendChild(el('span', { class: 'prs-chip streak' }, `🔥 ต่อเนื่อง ${res.stats.streak} วัน`));
  wrap.appendChild(chips);
  if (res.stats) wrap.appendChild(el('small', { style: 'color:var(--prs-ink-soft);font-weight:700' }, `สะสมแล้ว ${res.stats.xp} XP · ทำไปแล้ว ${res.stats.count} ใบงาน`));
  if (res.newBadges.length) {
    wrap.appendChild(el('div', { style: 'font-weight:900;margin-top:4px' }, '🎁 ได้เหรียญรางวัลใหม่!'));
    wrap.appendChild(el('div', { class: 'prs-badges' }, ...res.newBadges.map(b =>
      el('div', { class: 'prs-badge new' }, el('span', { class: 'ic' }, b.ic), b.name))));
  }
  card.insertBefore(wrap, card.firstChild);

  // ดาวเด้งขึ้นทีละดวง
  [...starsEl.children].forEach((s, i) => { if (i < stars) setTimeout(() => s.classList.add('on'), 350 + i * 300); });
  if (stars >= 2) setTimeout(() => confetti(), 300 + stars * 300);
  return { stars, xp: res.xpGained };
}

// ---------- ตารางผู้นำ (ถ้าครูเปิดให้นักเรียนเห็น) ----------
// ชื่อย่อแบบเดียวกับเซิร์ฟเวอร์ (api/leaderboard.js): ชื่อแรก + อักษรแรกของนามสกุล
export function shortName(n) {
  const w = String(n || '').trim().split(/s+/).filter(Boolean);
  return w.length > 1 ? `${w[0]} ${[...w[1]][0]}.` : (w[0] || '');
}
export async function showLeaderboard(card, { fichaId, grupo, alumno }) {
  try {
    const q = new URLSearchParams({ worksheet: fichaId, class: grupo || '' });
    const d = await fetch(API() + '/leaderboard?' + q).then(r => r.json());
    if (!d.ok || !d.enabled || !d.top || !d.top.length) return;
    const me = shortName(alumno);
    const medal = i => ['🥇', '🥈', '🥉'][i] || String(i + 1);
    const box = el('div', { class: 'prs-board' },
      el('h3', {}, `🏆 อันดับห้อง ${grupo || 'ทั้งหมด'}`),
      el('ol', {}, ...d.top.map((r, i) => el('li', { class: r.name === me ? 'me' : '' },
        el('span', { class: 'rk' }, medal(i)), el('span', {}, r.name), el('span', { class: 'pt' }, `${r.pct}%`)))));
    card.appendChild(box);
  } catch { /* ไม่แสดงถ้าโหลดไม่ได้ */ }
}
