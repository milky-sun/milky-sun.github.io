/**
 * main.js — 画面の進行と、指の操作の受け付け。
 *
 * 道具は一度にひとつだけ選べる。選んだ道具によって、舞台の上での
 * 指の意味が変わる（長押し／連打／こする）。
 */

import * as S from './state.js';
import * as doll from './doll.js';
import * as fx from './fx.js';
import * as paint from './paint.js';
import * as photo from './photo.js';
import { audio } from './audio.js';
import {
  drawCurse, chargeLabel, rankFromHold,
  CHARGE_FULL_MS, punchDrain, needleDrain, acidDrain,
  CATEGORY_NAME,
} from './curse.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* 定数                                                                */
/* ------------------------------------------------------------------ */

/** 呪をかけるとき、これより短い押しは「溜め損ね」として発動しない */
const CURSE_MIN_HOLD = 400;
/** 針が根元まで入りきるまで */
const NEEDLE_FULL_MS = 1400;
/** 火が点くまで */
const BURN_HOLD_MS = 3000;
/** 連打がコンボとして繋がる猶予 */
const COMBO_GRACE = 1100;
/** 酸の跡をひとつ置く最小間隔（SVG 座標での距離） */
const ACID_STEP = 6;
/** 保存する溶け跡の上限 */
const MAX_ACID_MARKS = 170;

const TOOL_TIP = {
  curse:  '藁人形を押し込み続ける。長いほど、重い凶が出る。',
  needle: '刺す場所を押し込む。深く入るほど効く。',
  punch:  'とにかく叩く。続けて当てるほど効く。',
  acid:   '指でこする。こすった分だけ溶ける。',
  burn:   '三秒押し込むと火が点く。もう元には戻らない。',
};

/* ------------------------------------------------------------------ */
/* 画面の要素                                                          */
/* ------------------------------------------------------------------ */

const el = {};
let activeTool = 'curse';
let gesture = null;       // 進行中の指の操作
let combo = 0;
let comboTimer = 0;
let drainAccum = 0;       // 酸のポップアップをまとめるための溜め
let drainAccumTimer = 0;
let stopAshFall = null;
let burning = false;

/* ================================================================== */
/* 起動                                                                */
/* ================================================================== */

function boot() {
  cache();
  bindSound();
  bindSetup();
  bindMain();
  bindAshes();

  doll.mount(el.dollHost);
  fx.init({ host: el.dollHost, acidCanvas: el.acidCanvas, fxCanvas: el.fxCanvas });

  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(onResize, 260));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) S.saveNow();
  });
  // iOS のダブルタップ拡大よけ
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // 遊びかけの藁人形があれば、支度を飛ばして呪詛之間へ戻る
  if (S.hasLivingDoll()) {
    restoreDoll();
    showScene('main');
  } else if (S.state.burned) {
    showAshes();
  } else {
    showScene('setup');
  }
}

function cache() {
  const ids = [
    'sound-toggle', 'scene-setup', 'scene-main', 'scene-ashes',
    'input-name', 'pane-draw', 'pane-photo', 'paint-canvas', 'paint-palette',
    'paint-erase', 'paint-clear', 'photo-canvas', 'photo-empty', 'input-photo',
    'photo-zoom', 'btn-create',
    'hud-target', 'life-left', 'life-drained', 'stage-inner', 'doll-host',
    'acid-canvas', 'fx-canvas', 'combo', 'combo-n', 'drain-layer',
    'mode-tip', 'btn-log', 'charge', 'charge-arc', 'charge-rank',
    'result', 'result-rank', 'result-lead', 'result-body', 'result-close',
    'logbook', 'logbook-list', 'logbook-empty', 'logbook-close',
    'expire', 'ash-canvas', 'ashes-name', 'ashes-stats', 'btn-restart',
  ];
  for (const id of ids) {
    el[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = $(id);
  }
  el.tools = [...document.querySelectorAll('.tool')];
  el.facemodeBtns = [...document.querySelectorAll('.facemode__btn')];
  el.sizeBtns = [...document.querySelectorAll('.size__btn')];
  el.life = document.querySelector('.life');
}

function onResize() {
  fx.resize();
  fx.redrawAcid(S.state.acidMarks);
}

/* ================================================================== */
/* 音                                                                  */
/* ================================================================== */

function bindSound() {
  el.soundToggle.addEventListener('click', async () => {
    const on = el.soundToggle.getAttribute('aria-pressed') !== 'true';
    el.soundToggle.setAttribute('aria-pressed', String(on));
    el.soundToggle.setAttribute('aria-label', on ? '音を消す' : '音を出す');
    el.soundToggle.querySelector('.sound-toggle__icon').textContent = on ? '🔊' : '🔇';
    await audio.setEnabled(on);
    if (on) audio.play('ui');
  });
}

/* ================================================================== */
/* 画面1: 支度                                                         */
/* ================================================================== */

let faceMode = 'none';

function bindSetup() {
  paint.init({
    canvas: el.paintCanvas,
    paletteHost: el.paintPalette,
    sizeBtns: el.sizeBtns,
    eraseBtn: el.paintErase,
    clearBtn: el.paintClear,
  });

  photo.init({
    canvas: el.photoCanvas,
    emptyEl: el.photoEmpty,
    fileInput: el.inputPhoto,
    zoomInput: el.photoZoom,
  });

  el.facemodeBtns.forEach((b) => {
    b.addEventListener('click', () => {
      faceMode = b.dataset.facemode;
      el.facemodeBtns.forEach((x) => {
        const on = x === b;
        x.classList.toggle('facemode__btn--on', on);
        x.setAttribute('aria-checked', String(on));
      });
      el.paneDraw.hidden = faceMode !== 'draw';
      el.panePhoto.hidden = faceMode !== 'photo';
      audio.play('ui');
    });
  });

  el.btnCreate.addEventListener('click', createDoll);
}

function createDoll() {
  const st = S.reset();
  st.targetName = el.inputName.value.trim().slice(0, 24);
  st.faceMode = faceMode;
  st.faceImage =
    faceMode === 'draw'  ? paint.toDataURL()  :
    faceMode === 'photo' ? photo.toDataURL()  : null;
  if (!st.faceImage) st.faceMode = 'none';
  st.created = true;
  S.saveNow();

  doll.resetVisual();
  fx.clearAcid();
  fx.clearParticles();
  restoreDoll();
  showScene('main');
  audio.play('bell', undefined, 0.2);
}

/* ================================================================== */
/* 画面2: 呪詛之間                                                     */
/* ================================================================== */

function restoreDoll() {
  const st = S.state;
  el.hudTarget.textContent = st.targetName || '名も無き者';
  doll.setFace(st.faceImage);
  doll.render(S.damageRatio());
  doll.clearNeedles();
  for (const n of st.needles) doll.addNeedle(n.x, n.y, { angle: n.a });
  fx.resize();
  fx.redrawAcid(st.acidMarks);
  updateLife();
  setTool(activeTool);
}

function bindMain() {
  el.tools.forEach((b) => {
    b.addEventListener('click', () => {
      setTool(b.dataset.tool);
      audio.play('ui');
    });
  });

  const stage = el.stageInner;
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  el.resultClose.addEventListener('click', () => { el.result.hidden = true; audio.play('ui'); });
  el.btnLog.addEventListener('click', openLogbook);
  el.logbookClose.addEventListener('click', () => { el.logbook.hidden = true; audio.play('ui'); });
}

function setTool(tool) {
  activeTool = tool;
  el.tools.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  el.modeTip.textContent = TOOL_TIP[tool] || '';
}

/* ------------------------------------------------------------------ */
/* 指の受け付け                                                        */
/* ------------------------------------------------------------------ */

function onDown(e) {
  if (burning) return;
  e.preventDefault();
  el.stageInner.setPointerCapture(e.pointerId);
  const p = doll.clientToSvg(e.clientX, e.clientY);

  if (activeTool === 'curse')  return startCurse();
  if (activeTool === 'needle') return startNeedle(p);
  if (activeTool === 'punch')  return doPunch(p);
  if (activeTool === 'acid')   return startAcid(p);
  if (activeTool === 'burn')   return startBurn();
}

function onMove(e) {
  if (!gesture) return;
  e.preventDefault();
  const p = doll.clientToSvg(e.clientX, e.clientY);
  if (gesture.kind === 'acid') moveAcid(p);
}

function onUp(e) {
  try { el.stageInner.releasePointerCapture(e.pointerId); } catch { /* 済んでいる */ }
  if (!gesture) return;
  const g = gesture;
  gesture = null;
  if (g.raf) cancelAnimationFrame(g.raf);

  if (g.kind === 'curse')  return endCurse(g);
  if (g.kind === 'needle') return endNeedle(g);
  if (g.kind === 'acid')   return endAcid(g);
  if (g.kind === 'burn')   return endBurn(g);
}

/* ------------------------------------------------------------------ */
/* 呪をかける（長押しで溜める）                                        */
/* ------------------------------------------------------------------ */

const ARC_LEN = 553;   // 2πr, r=88

function startCurse() {
  el.charge.hidden = false;
  el.charge.classList.remove('charge--fire');
  audio.charge.start();

  gesture = { kind: 'curse', t0: performance.now(), raf: 0 };
  const loop = () => {
    if (!gesture) return;
    const held = performance.now() - gesture.t0;
    const p = Math.min(1, held / CHARGE_FULL_MS);
    el.chargeArc.style.strokeDashoffset = String(ARC_LEN * (1 - p));
    el.chargeArc.style.stroke = p >= 0.69 ? '#c9a227' : p >= 0.31 ? '#7fa8d8' : '#4a6fa5';
    el.chargeRank.textContent = chargeLabel(held);
    audio.charge.set(p);
    gesture.raf = requestAnimationFrame(loop);
  };
  loop();
}

function endCurse(g) {
  const held = performance.now() - g.t0;
  el.charge.hidden = true;
  el.chargeArc.style.strokeDashoffset = String(ARC_LEN);
  audio.charge.stop();

  if (held < CURSE_MIN_HOLD) {
    el.modeTip.textContent = '気が散った。もっと長く押し込む。';
    setTimeout(() => { el.modeTip.textContent = TOOL_TIP.curse; }, 1800);
    return;
  }

  const rank = rankFromHold(held);
  const curse = drawCurse(held, S.state.partHits);

  audio.play('release', rank);
  fx.curseBurst(rank);

  // 相手が苦しむ間。三度よろけてから、結果が出る。
  let n = 0;
  const writhe = setInterval(() => {
    doll.flinch(n === 1);
    if (++n >= 3) clearInterval(writhe);
  }, 260);

  const res = S.drainLife(curse.drainDays);
  S.state.stats.curses++;
  S.state.curseLog.push({
    rank: curse.rank, category: curse.category,
    text: curse.text, days: curse.drainDays, at: Date.now(),
  });
  if (S.state.curseLog.length > 60) S.state.curseLog.shift();
  S.save();

  setTimeout(() => {
    popDrain(150, 170, curse.drainDays, true);
    updateLife();
    refreshDoll();
  }, 620);

  setTimeout(() => showResult(curse), 1250);
  if (res.justExpired) setTimeout(showExpire, 2400);
}

function showResult(curse) {
  el.resultRank.textContent = curse.rankName;
  el.resultRank.dataset.rank = String(curse.rank);
  const name = S.state.targetName || '名も無き者';
  el.resultLead.textContent = `${name} に、${curse.categoryName}の厄`;
  el.resultBody.textContent = curse.text;
  el.result.hidden = false;
}

/* ------------------------------------------------------------------ */
/* 針で刺す（部位を狙って押し込む）                                    */
/* ------------------------------------------------------------------ */

function startNeedle(p) {
  const part = doll.partAt(p.x, p.y);
  const n = doll.addNeedle(p.x, p.y, { animate: true });
  gesture = { kind: 'needle', t0: performance.now(), p, part, needle: n, depth: 0, raf: 0, lastSound: 0 };

  const loop = () => {
    if (!gesture) return;
    const held = performance.now() - gesture.t0;
    const d = Math.min(1, held / NEEDLE_FULL_MS);
    gesture.depth = d;
    // 9（触れただけ）→ −10（根元まで）
    n.inner.setAttribute('transform', `translate(${(9 - d * 19).toFixed(2)},0)`);
    if (held - gesture.lastSound > 130) {
      gesture.lastSound = held;
      audio.play('needlePush', d);
    }
    gesture.raf = requestAnimationFrame(loop);
  };
  loop();
}

function endNeedle(g) {
  const { p, part, depth, needle } = g;
  needle.inner.setAttribute('transform', `translate(${(9 - depth * 19).toFixed(2)},0)`);

  audio.play('needle', depth);
  fx.needleSpark(p.x, p.y);
  doll.flinch(depth > 0.6);

  const days = needleDrain(depth);
  const res = S.drainLife(days);
  S.state.stats.needles++;
  S.state.partHits[part] = (S.state.partHits[part] || 0) + 1;
  S.state.needles.push({ x: Math.round(p.x), y: Math.round(p.y), a: Math.round(needle.angle) });
  while (S.state.needles.length > doll.MAX_NEEDLES) S.state.needles.shift();
  S.save();

  popDrain(p.x, p.y, days, depth > 0.75);
  updateLife();
  refreshDoll();
  if (res.justExpired) setTimeout(showExpire, 500);
}

/* ------------------------------------------------------------------ */
/* ボコボコする（連打）                                                */
/* ------------------------------------------------------------------ */

function doPunch(p) {
  gesture = { kind: 'punch' };   // 押した瞬間に完結する

  combo++;
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => {
    combo = 0;
    el.combo.hidden = true;
  }, COMBO_GRACE);

  const heavy = combo > 0 && combo % 10 === 0;
  const power = heavy ? 1.8 : 1;

  el.combo.hidden = combo < 2;
  el.comboN.textContent = String(combo);
  el.combo.classList.remove('is-pop');
  void el.combo.offsetWidth;
  el.combo.classList.add('is-pop');

  audio.play('punch', power);
  fx.burstStraw(p.x, p.y, power);
  doll.flinch(heavy);
  shakeStage(heavy);

  const days = Math.round(punchDrain(combo) * power);
  const res = S.drainLife(days);
  S.state.stats.punches++;
  S.state.stats.maxCombo = Math.max(S.state.stats.maxCombo, combo);
  S.save();

  popDrain(p.x, p.y, days, heavy);
  updateLife();
  refreshDoll();
  if (res.justExpired) setTimeout(showExpire, 400);
}

function shakeStage(hard) {
  const c = hard ? 'is-shaking--hard' : 'is-shaking';
  el.stageInner.classList.remove('is-shaking', 'is-shaking--hard');
  void el.stageInner.offsetWidth;
  el.stageInner.classList.add(c);
  setTimeout(() => el.stageInner.classList.remove(c), 360);
}

/* ------------------------------------------------------------------ */
/* 酸をかける（ぐりぐり）                                              */
/* ------------------------------------------------------------------ */

function startAcid(p) {
  gesture = { kind: 'acid', last: p, t0: performance.now(), dist: 0, smokeAt: 0 };
  audio.acid.start();
  audio.acid.set(0);
  addAcidAt(p, 0);
}

function moveAcid(p) {
  const g = gesture;
  const d = Math.hypot(p.x - g.last.x, p.y - g.last.y);
  if (d < ACID_STEP) {
    audio.acid.set(0.05);
    return;
  }

  // 途中を埋めながら跡を置く（速く動かしても切れないように）
  const steps = Math.min(8, Math.ceil(d / ACID_STEP));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    addAcidAt({ x: g.last.x + (p.x - g.last.x) * t, y: g.last.y + (p.y - g.last.y) * t }, d);
  }

  g.dist += d;
  g.last = p;

  const speed = Math.min(1, d / 26);
  audio.acid.set(0.25 + speed * 0.75);

  const nowT = performance.now();
  if (nowT - g.smokeAt > 45) {
    g.smokeAt = nowT;
    fx.acidSmoke(p.x, p.y, speed);
  }

  const days = acidDrain(d);
  const res = S.drainLife(days);
  queueDrain(p, days);
  updateLife();
  refreshDoll();
  if (res.justExpired) showExpire();
}

function addAcidAt(p, speed) {
  const r = 7 + Math.random() * 6 + Math.min(6, speed * 0.25);
  fx.addAcidMark(p.x, p.y, r);
  // 保存ぶんは間引く。全部覚えると容量を食うので。
  const marks = S.state.acidMarks;
  const last = marks[marks.length - 1];
  if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 9) {
    marks.push({ x: Math.round(p.x), y: Math.round(p.y), r: Math.round(r) });
    while (marks.length > MAX_ACID_MARKS) marks.shift();
  }
}

function endAcid(g) {
  audio.acid.stop();
  // かけていた時間は、実際に経った時間で測る
  S.state.stats.acidMs += performance.now() - g.t0;
  flushDrain();
  S.save();
}

/* ------------------------------------------------------------------ */
/* 燃やす（三秒押し込む）                                              */
/* ------------------------------------------------------------------ */

function startBurn() {
  el.charge.hidden = false;
  el.charge.classList.add('charge--fire');
  audio.fire.start();

  gesture = { kind: 'burn', t0: performance.now(), raf: 0 };
  const loop = () => {
    if (!gesture) return;
    const held = performance.now() - gesture.t0;
    const p = Math.min(1, held / BURN_HOLD_MS);
    el.chargeArc.style.strokeDashoffset = String(ARC_LEN * (1 - p));
    el.chargeArc.style.stroke = '#e8761a';
    el.chargeRank.textContent = p >= 1 ? '　放　せ　' : '火を点ける';
    audio.fire.set(p * 0.5);
    if (p > 0.25) fx.fireAt(p * 0.35);
    if (p >= 1) { const gg = gesture; gesture = null; cancelAnimationFrame(gg.raf); return runBurn(); }
    gesture.raf = requestAnimationFrame(loop);
  };
  loop();
}

function endBurn() {
  // 三秒に届かずに離した＝取りやめ
  el.charge.hidden = true;
  el.charge.classList.remove('charge--fire');
  el.chargeArc.style.strokeDashoffset = String(ARC_LEN);
  audio.fire.stop();
  fx.clearParticles();
  el.modeTip.textContent = '手が止まった。';
  setTimeout(() => { if (activeTool === 'burn') el.modeTip.textContent = TOOL_TIP.burn; }, 1600);
}

const BURN_MS = 6200;

function runBurn() {
  burning = true;
  el.charge.hidden = true;
  el.charge.classList.remove('charge--fire');
  el.chargeArc.style.strokeDashoffset = String(ARC_LEN);
  el.combo.hidden = true;
  el.modeTip.textContent = '';

  S.state.burned = true;
  S.saveNow();

  audio.play('ignite');

  const t0 = performance.now();
  const step = () => {
    const p = Math.min(1, (performance.now() - t0) / BURN_MS);
    fx.fireAt(p);
    audio.fire.set(0.3 + Math.sin(p * Math.PI) * 0.7);
    if (p >= 1) return;
    requestAnimationFrame(step);
  };
  step();

  // 藁人形が燃え落ちる
  setTimeout(() => doll.fadeOut(3600), 1400);
  setTimeout(() => {
    audio.fire.set(0.05);
    audio.hushBgm();
  }, BURN_MS - 900);
  setTimeout(() => {
    audio.fire.stop();
    fx.clearParticles();
    fx.clearAcid();
    showAshes();
    burning = false;
  }, BURN_MS + 700);
}

/* ------------------------------------------------------------------ */
/* 余命の表示                                                          */
/* ------------------------------------------------------------------ */

function updateLife() {
  const st = S.state;
  el.lifeLeft.textContent = S.formatDays(st.lifeLeft);
  el.lifeDrained.textContent = `削った寿命 ${S.formatDays(S.drainedDays())}`;

  const ratio = st.lifeLeft / st.lifeInitial;
  el.life.classList.toggle('life--over', st.lifeLeft <= 0);
  el.life.classList.toggle('life--low', st.lifeLeft > 0 && ratio < 0.25);

  // 酸のように毎フレーム呼ばれる経路があるので、点滅は間引く
  const t = performance.now();
  if (t - (updateLife._last || 0) > 220) {
    updateLife._last = t;
    el.life.classList.remove('life--hit');
    void el.life.offsetWidth;
    el.life.classList.add('life--hit');
  }
}

/** 削れた分を、その場に浮かせる */
function popDrain(sx, sy, days, big = false) {
  if (days <= 0) return;
  const local = doll.svgToLocal(sx, sy);
  const s = document.createElement('span');
  s.className = 'drain-pop' + (big ? ' drain-pop--big' : '');
  s.textContent = S.formatDrain(days);
  s.style.left = `${local.x}px`;
  s.style.top = `${local.y}px`;
  el.drainLayer.appendChild(s);
  setTimeout(() => s.remove(), 1050);
}

/** 酸のように連続で削れるものは、まとめて一回だけ出す */
function queueDrain(p, days) {
  drainAccum += days;
  if (drainAccumTimer) return;
  drainAccumTimer = setTimeout(() => {
    drainAccumTimer = 0;
    flushDrain(p);
  }, 380);
}

function flushDrain(p) {
  clearTimeout(drainAccumTimer);
  drainAccumTimer = 0;
  if (drainAccum <= 0) return;
  const at = p || { x: 150, y: 200 };
  popDrain(at.x, at.y, drainAccum);
  drainAccum = 0;
}

/** 傷み具合を藁人形に反映（段が変わったときだけ描き直される） */
function refreshDoll() {
  doll.render(S.damageRatio());
}

function showExpire() {
  audio.play('expire');
  el.expire.hidden = false;
  clearTimeout(showExpire._t);
  showExpire._t = setTimeout(() => { el.expire.hidden = true; }, 3400);
}

/* ------------------------------------------------------------------ */
/* 呪詛帳                                                              */
/* ------------------------------------------------------------------ */

function openLogbook() {
  audio.play('ui');
  const list = S.state.curseLog;
  el.logbookList.innerHTML = '';
  el.logbookEmpty.hidden = list.length > 0;

  [...list].reverse().forEach((c) => {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.dataset.rank = String(c.rank);
    b.textContent = `${['', '小凶', '凶', '大凶'][c.rank]}・${CATEGORY_NAME[c.category] || ''}`;
    const span = document.createElement('span');
    span.textContent = c.text.split('\n')[0];
    const i = document.createElement('i');
    i.textContent = `寿命 ${S.formatDrain(c.days)}`;
    li.append(b, span, i);
    el.logbookList.appendChild(li);
  });

  el.logbook.hidden = false;
}

/* ================================================================== */
/* 画面3: 燼                                                           */
/* ================================================================== */

function bindAshes() {
  el.btnRestart.addEventListener('click', () => {
    audio.play('ui');
    audio.unhushBgm();
    if (stopAshFall) { stopAshFall(); stopAshFall = null; }
    S.reset();
    doll.resetVisual();
    doll.setFace(null);
    doll.render(0);
    fx.clearAcid();
    fx.clearParticles();
    photo.dispose();
    combo = 0;
    activeTool = 'curse';
    el.inputName.value = '';
    showScene('setup');
  });
}

function showAshes() {
  const st = S.state;
  el.ashesName.textContent = `${st.targetName || '名も無き者'} の藁人形`;

  const rows = [
    ['呪をかけた', `${st.stats.curses}`, '回'],
    ['刺した針', `${st.stats.needles}`, '本'],
    ['殴った', `${st.stats.punches}`, '発'],
    ['最も長く続いた連打', `${st.stats.maxCombo}`, '連'],
    ['酸をかけた', `${Math.round(st.stats.acidMs / 1000)}`, '秒'],
  ];

  el.ashesStats.innerHTML = '';
  for (const [k, v, unit] of rows) {
    el.ashesStats.appendChild(statRow(k, v, unit));
  }
  const total = statRow('削った寿命', S.formatDays(S.drainedDays(), { compact: false }), '');
  total.classList.add('is-total');
  el.ashesStats.appendChild(total);

  showScene('ashes');
  if (stopAshFall) stopAshFall();
  stopAshFall = fx.startAshFall(el.ashCanvas);
  audio.hushBgm();
}

function statRow(label, value, unit) {
  const div = document.createElement('div');
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  if (unit) {
    const em = document.createElement('em');
    em.textContent = unit;
    dd.appendChild(em);
  }
  div.append(dt, dd);
  return div;
}

/* ================================================================== */
/* 画面の切り替え                                                      */
/* ================================================================== */

function showScene(name) {
  const map = { setup: el.sceneSetup, main: el.sceneMain, ashes: el.sceneAshes };
  for (const [k, node] of Object.entries(map)) {
    const on = k === name;
    node.hidden = !on;
    node.classList.toggle('scene--active', on);
  }
  if (name === 'main') {
    // 表示された直後でないと大きさが取れない
    requestAnimationFrame(() => {
      fx.resize();
      fx.redrawAcid(S.state.acidMarks);
    });
  }
}

/* ================================================================== */

boot();
