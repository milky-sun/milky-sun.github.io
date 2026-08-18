/**
 * fx.js — 舞台に重ねる2枚のキャンバス。
 *
 *   acid-canvas … 酸で溶けた跡。消えないので、状態から描き直せるようにしてある。
 *   fx-canvas   … 飛び散る藁、煙、火の粉。動いている粒がゼロになったら
 *                 requestAnimationFrame を止める（電池とメモリのため）。
 *
 * どちらのキャンバスも「SVG の座標系（300×420）でそのまま描ける」ように
 * 変換をかけてある。doll.js と座標を共有できる。
 */

import * as doll from './doll.js';

const MAX_DPR = 2;
/** 粒の上限。これを超えたら古いものから捨てる。 */
const MAX_PARTICLES = 260;

let hostEl = null;
let acid = null;   // { el, ctx }
let fx = null;
let dpr = 1;

let particles = [];
let rafId = 0;
let lastT = 0;

/* ------------------------------------------------------------------ */
/* 初期化とサイズ合わせ                                                */
/* ------------------------------------------------------------------ */

export function init({ host, acidCanvas, fxCanvas }) {
  hostEl = host;
  acid = { el: acidCanvas, ctx: acidCanvas.getContext('2d') };
  fx = { el: fxCanvas, ctx: fxCanvas.getContext('2d') };
  resize();
}

/** SVG 座標でそのまま描けるように変換をセットする */
function applyTransform(c) {
  const f = doll.fit(hostEl);
  c.ctx.setTransform(dpr * f.scale, 0, 0, dpr * f.scale, dpr * f.left, dpr * f.top);
}

export function resize() {
  if (!hostEl) return;
  const r = hostEl.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);

  for (const c of [acid, fx]) {
    c.el.width = Math.round(r.width * dpr);
    c.el.height = Math.round(r.height * dpr);
    applyTransform(c);
  }
}

/** 変換を保ったまま全消し */
function wipe(c) {
  c.ctx.save();
  c.ctx.setTransform(1, 0, 0, 1, 0, 0);
  c.ctx.clearRect(0, 0, c.el.width, c.el.height);
  c.ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 酸で溶けた跡                                                        */
/* ------------------------------------------------------------------ */

/** 溶け跡をひとつ描く（SVG 座標） */
function paintMark(x, y, r) {
  const c = acid.ctx;
  c.save();
  c.clip(doll.silhouette());

  // 縁：酸で濡れて色が変わったところ
  const rim = c.createRadialGradient(x, y, r * 0.35, x, y, r * 1.45);
  rim.addColorStop(0, 'rgba(112,124,48,.34)');
  rim.addColorStop(0.5, 'rgba(78,80,38,.2)');
  rim.addColorStop(1, 'rgba(78,80,38,0)');
  c.fillStyle = rim;
  c.beginPath();
  c.arc(x, y, r * 1.45, 0, Math.PI * 2);
  c.fill();

  // 芯：溶けて抜けたところ
  const hole = c.createRadialGradient(x, y, 0, x, y, r);
  hole.addColorStop(0, 'rgba(7,6,7,.97)');
  hole.addColorStop(0.62, 'rgba(18,14,11,.86)');
  hole.addColorStop(1, 'rgba(28,21,15,0)');
  c.fillStyle = hole;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();

  c.restore();
}

/** 溶け跡を足す */
export function addAcidMark(x, y, r) {
  paintMark(x, y, r);
}

/** 保存されていた跡をまとめて描き直す */
export function redrawAcid(marks) {
  wipe(acid);
  for (const m of marks) paintMark(m.x, m.y, m.r);
}

export function clearAcid() {
  wipe(acid);
}

/* ------------------------------------------------------------------ */
/* 粒                                                                  */
/* ------------------------------------------------------------------ */

function push(p) {
  if (particles.length >= MAX_PARTICLES) particles.shift();
  particles.push(p);
  start();
}

function start() {
  if (rafId) return;
  lastT = performance.now();
  rafId = requestAnimationFrame(tick);
}

function tick(t) {
  const dt = Math.min(64, t - lastT) / 1000;
  lastT = t;

  wipe(fx);
  const c = fx.ctx;

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }

    p.vy += p.g * dt;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;

    const k = p.life / p.maxLife;      // 1 → 0

    if (p.type === 'straw') {
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.strokeStyle = p.color;
      c.globalAlpha = Math.min(1, k * 1.6);
      c.lineWidth = 1.5;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(-p.size, 0);
      c.lineTo(p.size, 0);
      c.stroke();
      c.restore();
    } else if (p.type === 'smoke') {
      c.globalAlpha = k * 0.34;
      const rr = p.size * (1 + (1 - k) * 2.6);
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
      g.addColorStop(0, p.color);
      g.addColorStop(1, 'rgba(70,70,66,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(p.x, p.y, rr, 0, Math.PI * 2);
      c.fill();
    } else if (p.type === 'ember') {
      c.globalAlpha = Math.min(1, k * 1.8);
      const rr = p.size * (0.4 + k * 0.9);
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr * 2.4);
      g.addColorStop(0, '#fff0c0');
      g.addColorStop(0.3, p.color);
      g.addColorStop(1, 'rgba(180,40,0,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(p.x, p.y, rr * 2.4, 0, Math.PI * 2);
      c.fill();
    } else if (p.type === 'spark') {
      c.globalAlpha = k;
      c.strokeStyle = p.color;
      c.lineWidth = 1.1;
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
      c.stroke();
    }
  }
  c.globalAlpha = 1;

  if (particles.length === 0) { rafId = 0; return; }
  rafId = requestAnimationFrame(tick);
}

const rand = (a, b) => a + Math.random() * (b - a);

/* ------------------------------------------------------------------ */
/* それぞれの演出                                                      */
/* ------------------------------------------------------------------ */

const STRAW_COLORS = ['#e3c87d', '#d9b96a', '#c19d4f', '#a8843c'];

/** 殴った瞬間、藁が飛び散る */
export function burstStraw(x, y, power = 1) {
  const n = Math.round(7 + power * 10);
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(60, 230) * (0.6 + power * 0.7);
    push({
      type: 'straw', x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - rand(20, 90),
      g: 520, drag: 0.985,
      size: rand(2.5, 7),
      rot: rand(0, 6.3), spin: rand(-9, 9),
      color: STRAW_COLORS[(Math.random() * STRAW_COLORS.length) | 0],
      life: rand(0.5, 1.0), maxLife: 1,
    });
  }
  // 埃
  for (let i = 0; i < 3; i++) {
    push({
      type: 'smoke', x: x + rand(-6, 6), y: y + rand(-6, 6),
      vx: rand(-18, 18), vy: rand(-26, -6),
      g: -8, drag: 0.97, size: rand(6, 13),
      rot: 0, spin: 0, color: 'rgba(150,138,110,.5)',
      life: rand(0.5, 0.9), maxLife: 0.9,
    });
  }
}

/** 針が刺さった瞬間の細かい火花 */
export function needleSpark(x, y) {
  for (let i = 0; i < 6; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(40, 140);
    push({
      type: 'spark', x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      g: 280, drag: 0.94, size: 1,
      rot: 0, spin: 0, color: '#cfd8e6',
      life: rand(0.14, 0.3), maxLife: 0.3,
    });
  }
  for (let i = 0; i < 4; i++) {
    push({
      type: 'straw', x, y,
      vx: rand(-70, 70), vy: rand(-90, -20),
      g: 480, drag: 0.98, size: rand(2, 4.5),
      rot: rand(0, 6.3), spin: rand(-8, 8),
      color: STRAW_COLORS[(Math.random() * STRAW_COLORS.length) | 0],
      life: rand(0.35, 0.7), maxLife: 0.7,
    });
  }
}

/** 酸をかけている間、じゅうじゅうと煙が立つ */
export function acidSmoke(x, y, intensity = 0.5) {
  push({
    type: 'smoke', x: x + rand(-4, 4), y,
    vx: rand(-12, 12), vy: rand(-52, -22) * (0.6 + intensity),
    g: -16, drag: 0.985,
    size: rand(4, 9) * (0.7 + intensity),
    rot: 0, spin: 0,
    color: `rgba(178,196,120,${0.32 + intensity * 0.24})`,
    life: rand(0.7, 1.4), maxLife: 1.4,
  });
}

/** 呪詛の解放。青い炎が藁人形から吹き上がる。 */
export function curseBurst(rank) {
  const n = 22 + rank * 16;
  for (let i = 0; i < n; i++) {
    const x = 150 + rand(-46, 46);
    const y = rand(90, 330);
    push({
      type: 'ember', x, y,
      vx: rand(-26, 26), vy: rand(-190, -70),
      g: -30, drag: 0.985,
      size: rand(1.6, 4.4),
      rot: 0, spin: 0,
      color: rank >= 3 ? '#c9a227' : '#4a6fa5',
      life: rand(0.6, 1.5), maxLife: 1.5,
    });
  }
}

/* --- 炎 --- */

let fireTimer = 0;
let fireProgress = 0;

/** 燃やす。0〜1 の進み具合を渡し続ける。 */
export function fireAt(progress) {
  fireProgress = progress;
  // 燃え際は下から上へ上がっていく
  const front = 400 - progress * 380;
  const n = Math.round(2 + progress * 7);
  for (let i = 0; i < n; i++) {
    const x = 150 + rand(-1, 1) * (40 + progress * 60);
    const y = front + rand(-24, 34);
    push({
      type: 'ember', x, y,
      vx: rand(-30, 30), vy: rand(-230, -90),
      g: -50, drag: 0.98,
      size: rand(2, 6.5),
      rot: 0, spin: 0,
      color: Math.random() < 0.75 ? '#e8761a' : '#ffcc55',
      life: rand(0.5, 1.3), maxLife: 1.3,
    });
  }
  if (Math.random() < 0.6) {
    push({
      type: 'smoke', x: 150 + rand(-50, 50), y: front - rand(0, 40),
      vx: rand(-16, 16), vy: rand(-90, -40),
      g: -20, drag: 0.99, size: rand(10, 24),
      rot: 0, spin: 0, color: 'rgba(58,52,48,.5)',
      life: rand(1.2, 2.4), maxLife: 2.4,
    });
  }
}

export function clearParticles() {
  particles = [];
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  if (fx) wipe(fx);
  clearTimeout(fireTimer);
  fireProgress = 0;
}

/* ------------------------------------------------------------------ */
/* 燼の画面：ゆっくり降る灰                                            */
/* ------------------------------------------------------------------ */

export function startAshFall(canvasEl) {
  const c = canvasEl.getContext('2d');
  let w = 0, h = 0, d = 1;
  let flakes = [];
  let id = 0;

  function size() {
    const r = canvasEl.getBoundingClientRect();
    d = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    w = r.width; h = r.height;
    canvasEl.width = Math.round(w * d);
    canvasEl.height = Math.round(h * d);
    c.setTransform(d, 0, 0, d, 0, 0);
    const n = Math.min(70, Math.round((w * h) / 9000));
    flakes = Array.from({ length: n }, () => spawn(true));
  }

  function spawn(anywhere) {
    return {
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : -10,
      vy: rand(6, 22),
      vx: rand(-6, 6),
      r: rand(0.7, 2.3),
      a: rand(0.14, 0.5),
      ph: rand(0, 6.3),
    };
  }

  let prev = performance.now();
  function loop(t) {
    const dt = Math.min(64, t - prev) / 1000;
    prev = t;
    c.clearRect(0, 0, w, h);
    for (let i = 0; i < flakes.length; i++) {
      const f = flakes[i];
      f.ph += dt * 1.4;
      f.y += f.vy * dt;
      f.x += (f.vx + Math.sin(f.ph) * 7) * dt;
      if (f.y > h + 6) flakes[i] = spawn(false);
      c.globalAlpha = f.a;
      c.fillStyle = '#cdc4b4';
      c.beginPath();
      c.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    id = requestAnimationFrame(loop);
  }

  size();
  window.addEventListener('resize', size);
  id = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(id);
    window.removeEventListener('resize', size);
  };
}
