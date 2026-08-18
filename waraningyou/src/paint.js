/**
 * paint.js — 顔を自分で描く。
 *
 * 円形の限られた枠の中だけ。色は決め打ちのパレット、太さ3段階、消しゴム、全消し。
 * 書き出しは 320px の PNG（sessionStorage に入れるので、これ以上大きくしない）。
 */

const PALETTE = [
  { c: '#241c16', name: '墨' },
  { c: '#b5202a', name: '朱' },
  { c: '#e8ddc8', name: '白' },
  { c: '#3d5f9e', name: '青' },
  { c: '#2f6b3c', name: '緑' },
  { c: '#d8a418', name: '黄' },
  { c: '#7a4b2a', name: '茶' },
  { c: '#a8467f', name: '桃' },
];

/** 描いていない状態の下地 */
const BASE = '#efe4cc';
/** 書き出しサイズ */
const OUT = 320;

let canvas = null;
let ctx = null;
let color = PALETTE[0].c;
let size = 14;
let erasing = false;
let drawing = false;
let dirty = false;
let last = null;
let onChange = () => {};

/** キャンバスの内部解像度（CSS サイズとは別。固定でよい） */
const RES = 512;

export function init(opts) {
  canvas = opts.canvas;
  onChange = opts.onChange || (() => {});

  canvas.width = RES;
  canvas.height = RES;
  ctx = canvas.getContext('2d', { alpha: false });
  clear();

  buildPalette(opts.paletteHost);
  bindTools(opts);
  bindPointer();
}

/* ------------------------------------------------------------------ */

function buildPalette(host) {
  host.innerHTML = '';
  PALETTE.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'palette__sw' + (i === 0 ? ' palette__sw--on' : '');
    b.style.background = p.c;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(i === 0));
    b.setAttribute('aria-label', p.name);
    b.addEventListener('click', () => {
      color = p.c;
      erasing = false;
      host.querySelectorAll('.palette__sw').forEach((el) => {
        el.classList.remove('palette__sw--on');
        el.setAttribute('aria-checked', 'false');
      });
      b.classList.add('palette__sw--on');
      b.setAttribute('aria-checked', 'true');
      document.getElementById('paint-erase')?.setAttribute('aria-pressed', 'false');
    });
    host.appendChild(b);
  });
}

function bindTools(opts) {
  opts.sizeBtns.forEach((b) => {
    b.addEventListener('click', () => {
      size = Number(b.dataset.size);
      opts.sizeBtns.forEach((x) => {
        x.classList.remove('size__btn--on');
        x.setAttribute('aria-checked', 'false');
      });
      b.classList.add('size__btn--on');
      b.setAttribute('aria-checked', 'true');
    });
  });

  opts.eraseBtn.addEventListener('click', () => {
    erasing = !erasing;
    opts.eraseBtn.setAttribute('aria-pressed', String(erasing));
  });

  opts.clearBtn.addEventListener('click', () => {
    clear();
    dirty = false;
    onChange();
  });
}

function clear() {
  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, RES, RES);
}

/* ------------------------------------------------------------------ */
/* 指の追従                                                            */
/* ------------------------------------------------------------------ */

function toLocal(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * RES,
    y: ((e.clientY - r.top) / r.height) * RES,
  };
}

/** 円の外にはみ出さないよう、常に円でクリップして描く */
function withClip(fn) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(RES / 2, RES / 2, RES / 2 - 1, 0, Math.PI * 2);
  ctx.clip();
  fn();
  ctx.restore();
}

function stroke(from, to) {
  withClip(() => {
    ctx.strokeStyle = erasing ? BASE : color;
    ctx.lineWidth = erasing ? size * 1.8 : size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  });
}

function dot(p) {
  withClip(() => {
    ctx.fillStyle = erasing ? BASE : color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (erasing ? size * 1.8 : size) / 2, 0, Math.PI * 2);
    ctx.fill();
  });
}

function bindPointer() {
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    dirty = true;
    last = toLocal(e);
    dot(last);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    e.preventDefault();
    const p = toLocal(e);
    stroke(last, p);
    last = p;
  });

  const end = (e) => {
    if (!drawing) return;
    drawing = false;
    last = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* 済んでいる */ }
    onChange();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

/* ------------------------------------------------------------------ */

/** 何か描かれているか */
export function hasDrawing() {
  return dirty;
}

/** 320px の PNG dataURL。描いていなければ null。 */
export function toDataURL() {
  if (!dirty) return null;
  const out = document.createElement('canvas');
  out.width = OUT;
  out.height = OUT;
  const c = out.getContext('2d');
  c.drawImage(canvas, 0, 0, OUT, OUT);
  return out.toDataURL('image/png');
}

/** 保存済みの顔を読み戻す */
export function load(dataUrl) {
  if (!dataUrl) return;
  const img = new Image();
  img.onload = () => {
    clear();
    withClip(() => ctx.drawImage(img, 0, 0, RES, RES));
    dirty = true;
  };
  img.src = dataUrl;
}
