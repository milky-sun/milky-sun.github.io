/**
 * doll.js — 藁人形の SVG を組み立てる。
 *
 * ・藁は「細い線の束」で描く。決定的な擬似乱数を使うので、同じ傷み具合なら
 *   毎回まったく同じ形になる（再描画でチラつかない）。
 * ・傷み具合は 0〜12 の 13 段階に丸めて、段が変わったときだけ本体を作り直す。
 *   針は別レイヤーに積むだけなので、何本刺しても本体の再生成は起きない。
 */

/** SVG の座標系。以降の座標はすべてこの単位 */
export const VB = { w: 300, h: 420 };

/** 各部位のだいたいの中心（演出の座標に使う） */
export const ANCHOR = {
  head:  { x: 150, y: 78  },
  chest: { x: 150, y: 190 },
  limbs: { x: 150, y: 320 },
};

const DOLL_CENTER = { x: 150, y: 196 };

/* ------------------------------------------------------------------ */
/* 小道具                                                              */
/* ------------------------------------------------------------------ */

/** 決定的な擬似乱数（mulberry32） */
function rngFrom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** 2色を t で混ぜる */
function mix(c1, c2, t) {
  const p = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const [r1, g1, b1] = p(c1);
  const [r2, g2, b2] = p(c2);
  return '#' + hex(r1 + (r2 - r1) * t) + hex(g1 + (g2 - g1) * t) + hex(b1 + (b2 - b1) * t);
}

const STRAW_TONES = ['#e3c87d', '#d9b96a', '#cdab5b', '#c19d4f', '#b28f45'];
const ROT = '#4e3f27';   // 傷んだ藁の色
const SCORCH = '#2b2018';

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * 藁の束をひと綴り描く。始点側と終点側の幅を変えられる。
 * @returns {string} <path> の連なり
 */
function bundle(x1, y1, x2, y2, w1, w2, count, rng, decay) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // 進行方向に対する垂直
  const nx = -dy / len;
  const ny = dx / len;

  let out = '';
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const spread = t - 0.5;
    const j1 = (rng() - 0.5) * 3;
    const j2 = (rng() - 0.5) * 5;

    const ax = x1 + nx * (spread * w1 * 2 + j1);
    const ay = y1 + ny * (spread * w1 * 2 + j1);
    const bx = x2 + nx * (spread * w2 * 2 + j2);
    const by = y2 + ny * (spread * w2 * 2 + j2);

    // 中点を少しだけ膨らませて、藁のしなりを出す
    const bow = (rng() - 0.5) * 7 + spread * 4;
    const mx = (ax + bx) / 2 + nx * bow;
    const my = (ay + by) / 2 + ny * bow;

    const tone = STRAW_TONES[Math.floor(rng() * STRAW_TONES.length)];
    const col = decay > 0 ? mix(tone, ROT, decay * (0.26 + rng() * 0.44)) : tone;
    const sw = r2(1.1 + rng() * 1.5);

    out += `<path d="M${r2(ax)} ${r2(ay)}Q${r2(mx)} ${r2(my)} ${r2(bx)} ${r2(by)}" `
         + `stroke="${col}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`;
  }
  return out;
}

/** 頭。藁を丸く巻いた玉。 */
function headBall(cx, cy, r, rng, decay) {
  let out = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${mix('#c9a758', ROT, decay * 0.58)}"/>`;
  // 巻き線
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const rr = r * (0.35 + rng() * 0.66);
    const spanA = 0.9 + rng() * 1.5;
    const x1 = cx + Math.cos(a) * rr;
    const y1 = cy + Math.sin(a) * rr * 0.92;
    const x2 = cx + Math.cos(a + spanA) * rr;
    const y2 = cy + Math.sin(a + spanA) * rr * 0.92;
    const mx = cx + Math.cos(a + spanA / 2) * rr * 1.16;
    const my = cy + Math.sin(a + spanA / 2) * rr * 1.08;
    const tone = STRAW_TONES[Math.floor(rng() * STRAW_TONES.length)];
    out += `<path d="M${r2(x1)} ${r2(y1)}Q${r2(mx)} ${r2(my)} ${r2(x2)} ${r2(y2)}" `
         + `stroke="${decay > 0 ? mix(tone, ROT, decay * 0.48) : tone}" `
         + `stroke-width="${r2(1 + rng() * 1.4)}" fill="none" stroke-linecap="round" opacity="${r2(0.55 + rng() * 0.45)}"/>`;
  }
  return out;
}

/** 縄で縛った帯 */
function binding(cx, cy, halfW, rng, decay) {
  const col = mix('#8a6b3c', ROT, decay * 0.6);
  let out = `<rect x="${cx - halfW}" y="${cy - 5}" width="${halfW * 2}" height="10" rx="3" fill="${col}"/>`;
  for (let i = 0; i < 7; i++) {
    const x = cx - halfW + (halfW * 2 * (i + 0.5)) / 7;
    out += `<path d="M${r2(x - 3)} ${cy - 5}L${r2(x + 3)} ${cy + 5}" stroke="#6a5230" stroke-width="1.4" opacity=".8"/>`;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 傷みの表現                                                          */
/* ------------------------------------------------------------------ */

/** ほつれて突き出た藁 */
function strayStraws(rng, decay) {
  const n = Math.floor(decay * 52);
  let out = '';
  for (let i = 0; i < n; i++) {
    // 本体の輪郭あたりから外へ跳ねさせる
    const zone = rng();
    let ox, oy;
    if (zone < 0.24) {                        // 頭
      const a = rng() * Math.PI * 2;
      ox = 150 + Math.cos(a) * 50;
      oy = 78 + Math.sin(a) * 50;
    } else if (zone < 0.62) {                 // 胴
      ox = 150 + (rng() < 0.5 ? -1 : 1) * (28 + rng() * 8);
      oy = 138 + rng() * 116;
    } else if (zone < 0.82) {                 // 腕
      ox = 150 + (rng() < 0.5 ? -1 : 1) * (60 + rng() * 40);
      oy = 162 + rng() * 28;
    } else {                                  // 脚
      ox = 150 + (rng() < 0.5 ? -1 : 1) * (16 + rng() * 34);
      oy = 260 + rng() * 118;
    }
    const a = Math.atan2(oy - DOLL_CENTER.y, ox - DOLL_CENTER.x) + (rng() - 0.5) * 1.5;
    const len = 7 + rng() * 20 * (0.4 + decay);
    const bx = ox + Math.cos(a) * len;
    const by = oy + Math.sin(a) * len;
    const cxp = ox + Math.cos(a) * len * 0.5 + (rng() - 0.5) * 9;
    const cyp = oy + Math.sin(a) * len * 0.5 + (rng() - 0.5) * 9;
    out += `<path d="M${r2(ox)} ${r2(oy)}Q${r2(cxp)} ${r2(cyp)} ${r2(bx)} ${r2(by)}" `
         + `stroke="${mix('#cdab5b', ROT, 0.2 + rng() * 0.6)}" stroke-width="${r2(0.8 + rng())}" `
         + `fill="none" stroke-linecap="round" opacity="${r2(0.6 + rng() * 0.4)}"/>`;
  }
  return out;
}

/** 焦げ・染み */
function stains(rng, decay) {
  const n = Math.floor(decay * 13);
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = 150 + (rng() - 0.5) * 150;
    const y = 60 + rng() * 320;
    const rx = 8 + rng() * 26 * decay;
    out += `<ellipse cx="${r2(x)}" cy="${r2(y)}" rx="${r2(rx)}" ry="${r2(rx * (0.55 + rng() * 0.6))}" `
         + `fill="${SCORCH}" opacity="${r2(0.1 + rng() * 0.3 * decay)}" `
         + `transform="rotate(${r2(rng() * 180)} ${r2(x)} ${r2(y)})"/>`;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 本体                                                                */
/* ------------------------------------------------------------------ */

/**
 * 藁人形の本体を組み立てる。
 * @param {number} decay 0〜1
 */
function buildBody(decay) {
  const rng = rngFrom(0x9e3779b9);   // 形は常に同じ。傷み具合だけが変わる
  let s = '';

  // --- 脚（先に描いて胴の下に潜らせる） ---
  const legDrop = decay > 0.8 ? (decay - 0.8) * 40 : 0;
  s += `<g transform="rotate(${r2(-legDrop * 0.25)} 150 256)">`;
  s += bundle(136, 244, 110, 388 - legDrop * 0.3, 19, 11, 28, rng, decay);
  s += `</g>`;
  s += `<g transform="rotate(${r2(legDrop * 0.4)} 150 256)">`;
  s += bundle(164, 244, 190, 388, 19, 11, 28, rng, decay);
  s += `</g>`;

  // --- 腕（水平だと棒に見えるので少し下げる。傷むと垂れる） ---
  // 左腕は反時計、右腕は時計。逆にすると腕が上に跳ね上がってしまう。
  const armL = decay > 0.5 ? (decay - 0.5) * 2 : 0;   // 0〜1
  s += `<g transform="rotate(${r2(-armL * 48)} 130 170)">`;
  s += bundle(130, 170, 48, 188, 17, 10, 24, rng, decay);
  s += `</g>`;
  const armR = decay > 0.72 ? (decay - 0.72) * 3.5 : 0;
  s += `<g transform="rotate(${r2(armR * 42)} 170 170)">`;
  s += bundle(170, 170, 252, 188, 17, 10, 24, rng, decay);
  s += `</g>`;

  // --- 胴（ここが薄いと全体が貧相に見えるので、いちばん密に束ねる） ---
  s += bundle(150, 124, 150, 266, 43, 35, 64, rng, decay);
  // 手前に重ねて、束の厚みを出す
  s += bundle(150, 130, 150, 260, 30, 24, 26, rng, decay);

  // --- 縛り ---
  s += binding(150, 166, 41, rng, decay);
  s += binding(150, 244, 34, rng, decay);

  // --- 首 ---
  s += bundle(150, 108, 150, 138, 12, 17, 12, rng, decay);

  // --- 頭 ---
  const headTilt = decay * 13;
  s += `<g transform="rotate(${r2(headTilt)} 150 126)">`;
  s += headBall(150, 78, 52, rng, decay);
  s += `</g>`;

  return s;
}

function buildDamage(decay) {
  if (decay <= 0.001) return '';
  const rng = rngFrom(0x1f2e3d4c);
  return stains(rng, decay) + strayStraws(rng, decay);
}

/* ------------------------------------------------------------------ */
/* 公開 API                                                            */
/* ------------------------------------------------------------------ */

let host = null;
let svg = null;
let gTilt = null;
let gBody = null;
let gFace = null;
let gDamage = null;
let gNeedles = null;
let lastStep = -1;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** ホスト要素に SVG を作る */
export function mount(hostEl) {
  host = hostEl;
  host.innerHTML = `
<svg viewBox="0 0 ${VB.w} ${VB.h}" preserveAspectRatio="xMidYMid meet" role="img"
     aria-label="藁人形">
  <defs>
    <clipPath id="face-clip"><circle cx="150" cy="78" r="45"/></clipPath>
    <radialGradient id="face-vig">
      <stop offset="72%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#1a1108" stop-opacity=".55"/>
    </radialGradient>
  </defs>
  <g id="d-tilt">
    <g id="d-body"></g>
    <g id="d-face"></g>
    <g id="d-damage"></g>
    <g id="d-needles"></g>
  </g>
</svg>`;
  svg      = host.querySelector('svg');
  gTilt    = host.querySelector('#d-tilt');
  gBody    = host.querySelector('#d-body');
  gFace    = host.querySelector('#d-face');
  gDamage  = host.querySelector('#d-damage');
  gNeedles = host.querySelector('#d-needles');
  lastStep = -1;
}

/**
 * 状態を反映する。傷みの段が変わったときだけ本体を作り直す。
 * @param {number} decay 0〜1
 */
export function render(decay) {
  const step = Math.round(decay * 12);
  if (step === lastStep) return;
  lastStep = step;

  const d = step / 12;
  gBody.innerHTML = buildBody(d);
  gDamage.innerHTML = buildDamage(d);
  gTilt.setAttribute('transform', `rotate(${r2(d * 5.5)} 150 380)`);
  // 傷むほど顔も曇る
  const veil = gFace.querySelector('.face-veil');
  if (veil) veil.setAttribute('opacity', r2(d * 0.62));
}

/** 顔を差し込む。dataUrl が null なら のっぺらぼう。 */
export function setFace(dataUrl) {
  if (!dataUrl) { gFace.innerHTML = ''; return; }
  gFace.innerHTML = `
<g clip-path="url(#face-clip)">
  <image href="${dataUrl}" x="105" y="33" width="90" height="90"
         preserveAspectRatio="xMidYMid slice"/>
  <circle cx="150" cy="78" r="45" fill="url(#face-vig)"/>
  <circle class="face-veil" cx="150" cy="78" r="45" fill="#2b2018" opacity="0"/>
</g>
<circle cx="150" cy="78" r="45" fill="none" stroke="rgba(90,70,40,.55)" stroke-width="2"/>`;
}

/**
 * 針を1本足す。
 * @param {number} x SVG 座標
 * @param {number} y SVG 座標
 * @param {{ angle?:number, animate?:boolean }} [opt]
 *   angle を渡すとその角度で刺さる（保存した針を復元するときに使う）。
 * @returns {{ el:SVGGElement, inner:SVGGElement, angle:number }}
 */
export function addNeedle(x, y, opt = {}) {
  let deg = opt.angle;
  if (typeof deg !== 'number') {
    const a = Math.atan2(y - DOLL_CENTER.y, x - DOLL_CENTER.x);
    deg = (a * 180) / Math.PI + (Math.random() - 0.5) * 34;
  }
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('transform', `translate(${r2(x)} ${r2(y)}) rotate(${r2(deg)})`);
  g.innerHTML = `<g class="needle">
  <line x1="0" y1="0" x2="30" y2="0" stroke="#0b0a0a" stroke-width="3.4" opacity=".35"
        transform="translate(1,1.4)"/>
  <line x1="0" y1="0" x2="30" y2="0" stroke="#cfd4dc" stroke-width="1.7"/>
  <line x1="0" y1="0" x2="12" y2="0" stroke="#f2f5f8" stroke-width="1.7"/>
  <circle cx="31" cy="0" r="3.4" fill="#b5202a"/>
  <circle cx="30" cy="-1" r="1.1" fill="#e88" opacity=".9"/>
</g>`;
  gNeedles.appendChild(g);
  const inner = g.firstElementChild;
  if (opt.animate) inner.setAttribute('transform', 'translate(9,0)');
  // 上限。古いものから間引いて、要素が増え続けないようにする。
  while (gNeedles.childElementCount > MAX_NEEDLES) gNeedles.removeChild(gNeedles.firstChild);
  return { el: g, inner, angle: deg };
}

/** 刺さったままにできる針の上限 */
export const MAX_NEEDLES = 80;

/** 針を全部消す */
export function clearNeedles() {
  gNeedles.innerHTML = '';
}

/**
 * 打撃時のよろけ。
 * #d-tilt は傾きを transform 属性で持っているので、CSS アニメーションは
 * <svg> 側に掛ける（同じ要素に両方かけると属性が上書きされてしまう）。
 */
export function flinch(hard = false) {
  const cls = hard ? 'is-flinch--hard' : 'is-flinch';
  svg.classList.remove('is-flinch', 'is-flinch--hard');
  void svg.getBoundingClientRect();
  svg.classList.add(cls);
  clearTimeout(flinch._t);
  flinch._t = setTimeout(() => svg.classList.remove(cls), 420);
}

/** 燃やすときに全体をフェードさせる用 */
export function fadeOut(ms) {
  svg.style.transition = `opacity ${ms}ms ease-in, filter ${ms}ms ease-in`;
  svg.style.opacity = '0';
  svg.style.filter = 'brightness(.2) saturate(.2)';
}

export function resetVisual() {
  if (svg) { svg.style.transition = ''; svg.style.opacity = ''; svg.style.filter = ''; }
  clearNeedles();
  lastStep = -1;
}

/* ------------------------------------------------------------------ */
/* 座標変換 と 当たり判定                                              */
/* ------------------------------------------------------------------ */

/**
 * SVG の viewBox が要素の中でどう配置されているか。
 * preserveAspectRatio="xMidYMid meet" と同じ計算。
 */
export function fit(el = host) {
  const r = el.getBoundingClientRect();
  const scale = Math.min(r.width / VB.w, r.height / VB.h);
  return {
    scale,
    ox: r.left + (r.width - VB.w * scale) / 2,
    oy: r.top + (r.height - VB.h * scale) / 2,
    left: (r.width - VB.w * scale) / 2,
    top: (r.height - VB.h * scale) / 2,
    rect: r,
  };
}

/** 画面座標 → SVG 座標 */
export function clientToSvg(clientX, clientY) {
  const f = fit();
  return { x: (clientX - f.ox) / f.scale, y: (clientY - f.oy) / f.scale };
}

/** SVG 座標 → ホスト要素内の CSS ピクセル座標（ポップアップの配置用） */
export function svgToLocal(x, y) {
  const f = fit();
  return { x: f.left + x * f.scale, y: f.top + y * f.scale };
}

/**
 * SVG 座標がどの部位か。
 * 頭＝仕事、胸＝恋愛、手足＝怪我。
 */
export function partAt(x, y) {
  if (y < 128) return 'head';
  // 腕の高さで胴から外れていれば手足
  if (y < 200 && Math.abs(x - 150) > 46) return 'limbs';
  if (y < 258) return 'chest';
  return 'limbs';
}

/**
 * 藁人形のおおまかな輪郭。酸が体の外へ飛び散らないよう、これでクリップする。
 * 矩形で切ると溶け跡が四角く見えてしまうので、丸みのある形を重ねて union にする。
 */
export function silhouette() {
  const p = new Path2D();

  // 頭
  p.moveTo(204, 78);
  p.arc(150, 78, 54, 0, Math.PI * 2);

  // 首から胴（肩を張らせて、腰をすぼめる）
  p.moveTo(136, 104);
  p.bezierCurveTo(136, 118, 104, 118, 102, 152);
  p.bezierCurveTo(99, 200, 108, 244, 112, 272);
  p.lineTo(188, 272);
  p.bezierCurveTo(192, 244, 201, 200, 198, 152);
  p.bezierCurveTo(196, 118, 164, 118, 164, 104);
  p.closePath();

  // 腕（先を軽く丸める）
  p.moveTo(66, 178);
  p.arc(52, 178, 14, 0, Math.PI * 2);
  p.moveTo(262, 178);
  p.arc(248, 178, 14, 0, Math.PI * 2);
  p.moveTo(52, 156);
  p.lineTo(248, 156);
  p.lineTo(248, 200);
  p.lineTo(52, 200);
  p.closePath();

  // 脚
  p.moveTo(128, 250);
  p.lineTo(172, 250);
  p.lineTo(206, 398);
  p.lineTo(174, 398);
  p.closePath();
  p.moveTo(128, 250);
  p.lineTo(172, 250);
  p.lineTo(126, 398);
  p.lineTo(94, 398);
  p.closePath();

  return p;
}
