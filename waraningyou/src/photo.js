/**
 * photo.js — 相手の写真を顔として使う。
 *
 * 端末の中だけで完結する。読み込んだ画像はどこにも送らないし、
 * 元の解像度のまま抱え続けもしない（スマホのメモリ対策で、読み込んだ直後に
 * 長辺 768px まで縮めて、元データは捨てる）。
 */

/** 作業用に保持する画像の最大辺 */
const WORK_MAX = 768;
/** 書き出しサイズ */
const OUT = 320;

const RES = 512;

let canvas = null;
let ctx = null;
let img = null;          // 縮小済みの作業用画像（HTMLCanvasElement）
let zoom = 1.3;
let panX = 0;            // −1〜1 の相対量
let panY = 0;
let dragging = false;
let dragFrom = null;
let onChange = () => {};
let emptyEl = null;

export function init(opts) {
  canvas = opts.canvas;
  emptyEl = opts.emptyEl;
  onChange = opts.onChange || (() => {});

  canvas.width = RES;
  canvas.height = RES;
  ctx = canvas.getContext('2d');

  opts.fileInput.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
    e.target.value = '';   // 同じ写真を選び直せるように
  });

  opts.zoomInput.addEventListener('input', (e) => {
    zoom = Number(e.target.value) / 100;
    draw();
    onChange();
  });

  bindDrag();
  draw();
}

/* ------------------------------------------------------------------ */

async function loadFile(file) {
  try {
    const bmp = await readImage(file);
    // 作業用に縮める。ここで元データへの参照を切る。
    const scale = Math.min(1, WORK_MAX / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);

    const work = document.createElement('canvas');
    work.width = w;
    work.height = h;
    work.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();

    img = work;
    panX = 0;
    panY = 0;
    if (emptyEl) emptyEl.hidden = true;
    draw();
    onChange();
  } catch (e) {
    console.warn('[photo] 読み込みに失敗しました', e);
    alert('この写真は読み込めませんでした。別の写真を試してください。');
  }
}

function readImage(file) {
  if (window.createImageBitmap) {
    // EXIF の向きを尊重する
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => viaObjectUrl(file));
  }
  return viaObjectUrl(file);
}

function viaObjectUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
    im.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    im.src = url;
  });
}

/* ------------------------------------------------------------------ */

function draw() {
  ctx.clearRect(0, 0, RES, RES);
  ctx.fillStyle = '#161315';
  ctx.fillRect(0, 0, RES, RES);
  if (!img) return;

  // 短辺が枠を覆うように合わせてから、拡大率を掛ける
  const cover = Math.max(RES / img.width, RES / img.height) * zoom;
  const w = img.width * cover;
  const h = img.height * cover;
  // はみ出しぶんの範囲で動かせる
  const slackX = Math.max(0, (w - RES) / 2);
  const slackY = Math.max(0, (h - RES) / 2);
  const x = (RES - w) / 2 + panX * slackX;
  const y = (RES - h) / 2 + panY * slackY;

  ctx.save();
  ctx.beginPath();
  ctx.arc(RES / 2, RES / 2, RES / 2 - 1, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

function bindDrag() {
  canvas.addEventListener('pointerdown', (e) => {
    if (!img) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    dragFrom = { x: e.clientX, y: e.clientY, px: panX, py: panY };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    panX = clamp(dragFrom.px + ((e.clientX - dragFrom.x) / r.width) * 2.2, -1, 1);
    panY = clamp(dragFrom.py + ((e.clientY - dragFrom.y) / r.height) * 2.2, -1, 1);
    draw();
  });

  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* 済んでいる */ }
    onChange();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ------------------------------------------------------------------ */

export function hasPhoto() {
  return !!img;
}

/** 320px の JPEG dataURL。写真が無ければ null。 */
export function toDataURL() {
  if (!img) return null;
  const out = document.createElement('canvas');
  out.width = OUT;
  out.height = OUT;
  out.getContext('2d').drawImage(canvas, 0, 0, OUT, OUT);
  return out.toDataURL('image/jpeg', 0.82);
}

/** 保存済みの顔を読み戻す（切り抜き済みなので、そのまま貼るだけ） */
export function load(dataUrl) {
  if (!dataUrl) return;
  const im = new Image();
  im.onload = () => {
    const work = document.createElement('canvas');
    work.width = im.width;
    work.height = im.height;
    work.getContext('2d').drawImage(im, 0, 0);
    img = work;
    zoom = 1;
    panX = 0; panY = 0;
    if (emptyEl) emptyEl.hidden = true;
    draw();
  };
  im.src = dataUrl;
}

/** 写真を手放す（メモリを返す） */
export function dispose() {
  img = null;
  if (emptyEl) emptyEl.hidden = false;
  if (ctx) draw();
}
