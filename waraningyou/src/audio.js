/**
 * audio.js — 効果音と BGM。
 *
 * 効果音はすべて Web Audio API での合成。音声ファイルを一切読まないので、
 * 素材が揃う前でも完全に動く。差し替えたくなったら SAMPLES に URL を入れる。
 *
 * ・ページを開いた時点では必ず消音。ユーザーが音符ボタンを押すまで音は出ない。
 * ・AudioContext はボタンを押した瞬間に初めて作る（自動再生ブロック対策）。
 */

/**
 * 音声ファイルの差し替え表。
 *
 * null のあいだは Web Audio による合成音が鳴る。パスを入れると、
 * 音符ボタンが押された時点で初めて取りに行き、以降そのファイルが優先される。
 * 読み込みに失敗したものは黙って合成音に戻る（画面は止まらない）。
 *
 * docs/prompts/11〜19 が、それぞれこの表の一行に対応している。
 */
const SAMPLES = {
  bgm:      './assets/audio/bgm.m4a',   // 11
  punch:    null,   // 12  './assets/audio/se-punch.mp3'
  needle:   null,   // 13  './assets/audio/se-needle.mp3'
  acidLoop: null,   // 14  './assets/audio/se-acid-loop.mp3'   ※ループ素材
  release:  null,   // 15  './assets/audio/se-release.mp3'
  heart:    null,   // 16  './assets/audio/se-heart.mp3'
  bell:     null,   // 17  './assets/audio/se-bell.mp3'
  ignite:   null,   // 18  './assets/audio/se-ignite.mp3'
  fireLoop: null,   // 19  './assets/audio/se-fire-loop.mp3'   ※ループ素材
};

/** 読み込み済みの音声。SAMPLES と同じキーで入る。 */
const buffers = {};

/** 素材を鳴らすときの音量。効果音ごとに引数の意味が違うので個別に決める。 */
const SAMPLE_GAIN = {
  punch:   (power = 1)     => Math.min(1, 0.75 * power),
  needle:  (depth = 0.5)   => 0.55 + depth * 0.25,
  release: (rank = 1)      => Math.min(1, 0.58 + rank * 0.12),
  heart:   (strength = .5) => 0.45 + strength * 0.35,
  bell:    (_at, vol = .16) => Math.min(1, vol * 4),
  ignite:  ()              => 0.8,
};

let ctx = null;
let master = null;        // 全体の音量
let bgmGain = null;
let noiseBuf = null;
let enabled = false;
let bgmNodes = [];
let bellTimer = 0;

/* ------------------------------------------------------------------ */
/* 下ごしらえ                                                          */
/* ------------------------------------------------------------------ */

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  bgmGain = ctx.createGain();
  bgmGain.gain.value = 0.16;
  bgmGain.connect(master);

  // ホワイトノイズ（使い回す）
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

  return ctx;
}

const now = () => (ctx ? ctx.currentTime : 0);

function noise() {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  return src;
}

/**
 * SAMPLES に入っているファイルをまとめて取りに行く。
 * 音符ボタンが押されるまでは一度も走らない（通信量への配慮）。
 * 一つ失敗しても他は生かす。失敗したものは合成音のまま。
 */
let samplesRequested = false;
function loadSamples() {
  if (samplesRequested || !ctx) return;
  samplesRequested = true;
  for (const [name, url] of Object.entries(SAMPLES)) {
    if (!url || buffers[name]) continue;
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => { buffers[name] = buf; })
      .catch((e) => console.warn(`[audio] ${name} を読めませんでした。合成音を使います。`, e));
  }
}

/** 読み込み済みの素材を一発鳴らす */
function playSample(buf, gain, when = now()) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(master);
  src.start(when);
  return src;
}

/** 立ち上がり→減衰のエンベロープを持つゲイン */
function env(peak, attack, decay, at = now()) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return g;
}

function stopAt(node, t) {
  try { node.stop(t); } catch { /* 既に止まっている */ }
}

/* ------------------------------------------------------------------ */
/* 効果音                                                              */
/* ------------------------------------------------------------------ */

const SE = {
  /** 打撃。強いほど低く重く。 */
  punch(power = 1) {
    const t = now();
    // 芯の低音
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150 * (1 + power * 0.2), t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const og = env(0.5 * power, 0.004, 0.17, t);
    osc.connect(og).connect(master);
    osc.start(t); stopAt(osc, t + 0.24);

    // 藁の潰れる音
    const n = noise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.13);
    const ng = env(0.28 * power, 0.003, 0.12, t);
    n.connect(lp).connect(ng).connect(master);
    n.start(t); stopAt(n, t + 0.2);
  },

  /** 針が刺さる。細く鋭い。 */
  needle(depth = 0.5) {
    const t = now();
    const n = noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 5;
    bp.frequency.setValueAtTime(4200, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.1);
    const g = env(0.24, 0.002, 0.1, t);
    n.connect(bp).connect(g).connect(master);
    n.start(t); stopAt(n, t + 0.18);

    // 奥に届いた手応え
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210 - depth * 80, t + 0.03);
    const og = env(0.16 + depth * 0.14, 0.005, 0.12, t + 0.03);
    osc.connect(og).connect(master);
    osc.start(t + 0.03); stopAt(osc, t + 0.22);
  },

  /** 針が深く入っていく最中のきしみ（長押し中に鳴らす） */
  needlePush(depth) {
    const t = now();
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70 + depth * 120, t);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const g = env(0.05, 0.01, 0.08, t);
    osc.connect(lp).connect(g).connect(master);
    osc.start(t); stopAt(osc, t + 0.14);
  },

  /** 呪詛の解放。格が高いほど深く鳴る。 */
  release(rank = 1) {
    const t = now();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120 + rank * 30, t);
    osc.frequency.exponentialRampToValueAtTime(26, t + 0.9 + rank * 0.2);
    const og = env(0.42 + rank * 0.1, 0.01, 1.0 + rank * 0.3, t);
    osc.connect(og).connect(master);
    osc.start(t); stopAt(osc, t + 2.2);

    const n = noise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.7);
    const ng = env(0.22, 0.005, 0.75, t);
    n.connect(lp).connect(ng).connect(master);
    n.start(t); stopAt(n, t + 1.1);

    if (rank >= 3) audio.play('bell', t + 0.12, 0.3);
  },

  /** 鐘 */
  bell(at = now(), vol = 0.16) {
    const base = 320;
    [1, 2.76, 5.4, 8.9].forEach((mult, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * mult;
      const g = ctx.createGain();
      const peak = vol / (i + 1.6);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 2.6 - i * 0.4);
      osc.connect(g).connect(master);
      osc.start(at); stopAt(osc, at + 3);
    });
  },

  /** 心音（チャージ中に繰り返す） */
  heart(strength = 0.5) {
    const t = now();
    [0, 0.15].forEach((off, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(72, t + off);
      osc.frequency.exponentialRampToValueAtTime(38, t + off + 0.1);
      const g = env((i === 0 ? 0.34 : 0.22) * (0.5 + strength), 0.008, 0.13, t + off);
      osc.connect(g).connect(master);
      osc.start(t + off); stopAt(osc, t + off + 0.3);
    });
  },

  /** 軽いクリック（画面操作） */
  ui() {
    const t = now();
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.exponentialRampToValueAtTime(330, t + 0.04);
    const g = env(0.07, 0.002, 0.05, t);
    osc.connect(g).connect(master);
    osc.start(t); stopAt(osc, t + 0.1);
  },

  /** 藁に火が点く瞬間 */
  ignite() {
    const t = now();
    const n = noise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(400, t);
    hp.frequency.exponentialRampToValueAtTime(2600, t + 0.5);
    const g = env(0.3, 0.02, 0.9, t);
    n.connect(hp).connect(g).connect(master);
    n.start(t); stopAt(n, t + 1.1);
  },

  /** 寿命が尽きた瞬間 */
  expire() {
    const t = now();
    SE.bell(t, 0.26);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(58, t);
    osc.frequency.exponentialRampToValueAtTime(21, t + 2.4);
    const g = env(0.4, 0.05, 2.6, t);
    osc.connect(g).connect(master);
    osc.start(t); stopAt(osc, t + 3.2);
  },
};

/* ------------------------------------------------------------------ */
/* 押しっぱなしの音（酸・チャージ・炎）                                */
/* ------------------------------------------------------------------ */

/**
 * 押しっぱなしのあいだ鳴り続ける音。
 * @param {string} sampleKey SAMPLES のキー。素材があればそれをループ再生し、
 *                           無ければノイズをフィルタに通した合成音を使う。
 */
function makeLoop(sampleKey) {
  let src = null;
  let gain = null;
  let filt = null;
  let isSample = false;

  return {
    start(freq, q, vol) {
      if (!ctx || src) return;
      const buf = buffers[sampleKey];
      isSample = !!buf;

      if (isSample) {
        src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        filt = null;
      } else {
        src = noise();
        filt = ctx.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.value = freq;
        filt.Q.value = q;
      }

      gain = ctx.createGain();
      gain.gain.value = 0;
      (filt ? src.connect(filt) : src).connect(gain).connect(master);
      src.start();
      gain.gain.linearRampToValueAtTime(vol, now() + 0.08);
    },
    set(vol, freq) {
      if (!gain) return;
      gain.gain.setTargetAtTime(vol, now(), 0.05);
      if (freq && filt) filt.frequency.setTargetAtTime(freq, now(), 0.06);
      // 素材の場合は、勢いを再生速度で表す
      if (isSample && src) src.playbackRate.setTargetAtTime(0.85 + vol * 0.5, now(), 0.1);
    },
    stop() {
      if (!src) return;
      const s = src, g = gain;
      g.gain.setTargetAtTime(0, now(), 0.06);
      setTimeout(() => stopAt(s, now()), 350);
      src = null; gain = null; filt = null; isSample = false;
    },
  };
}

const acidLoop = makeLoop('acidLoop');
const fireLoop = makeLoop('fireLoop');

let chargeDrone = null;
let heartTimer = 0;

/* ------------------------------------------------------------------ */
/* BGM                                                                 */
/* ------------------------------------------------------------------ */

async function startBgm() {
  if (!ctx || bgmNodes.length) return;

  // 音声ファイルが指定されていれば、届き次第そちらに乗り換える
  if (SAMPLES.bgm) {
    try {
      const buf = buffers.bgm
        || await fetch(SAMPLES.bgm).then((r) => {
             if (!r.ok) throw new Error(`HTTP ${r.status}`);
             return r.arrayBuffer();
           }).then((b) => ctx.decodeAudioData(b));
      buffers.bgm = buf;
      if (!enabled) return;          // 待っているあいだに消音されていたら鳴らさない
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(bgmGain);
      src.start();
      bgmNodes.push(src);
      return;
    } catch (e) {
      console.warn('[audio] BGM を読めませんでした。合成音に切り替えます。', e);
    }
  }

  // --- 合成のドローン ---
  // わずかにずらした低音を重ねて、うなりを作る
  const freqs = [55, 55.4, 82.5, 110.7];
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 340;
  lp.Q.value = 1.2;
  lp.connect(bgmGain);

  // フィルタをゆっくり開閉させて、呼吸させる
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.045;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 150;
  lfo.connect(lfoGain).connect(lp.frequency);
  lfo.start();
  bgmNodes.push(lfo);

  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = i < 2 ? 'sawtooth' : 'triangle';
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = i < 2 ? 0.32 : 0.13;
    osc.connect(g).connect(lp);
    osc.start();
    bgmNodes.push(osc);
  });

  // 忘れた頃に遠くで鐘が鳴る
  const scheduleBell = () => {
    bellTimer = setTimeout(() => {
      if (enabled && ctx) SE.bell(now() + 0.1, 0.05);
      scheduleBell();
    }, 18000 + Math.random() * 26000);
  };
  scheduleBell();
}

function stopBgm() {
  clearTimeout(bellTimer);
  bgmNodes.forEach((n) => stopAt(n, now()));
  bgmNodes = [];
}

/* ------------------------------------------------------------------ */
/* 公開 API                                                            */
/* ------------------------------------------------------------------ */

export const audio = {
  get enabled() { return enabled; },

  /** 音符ボタンから呼ぶ。true にした瞬間に AudioContext を作る。 */
  async setEnabled(on) {
    enabled = !!on;
    if (!enabled) {
      if (master) master.gain.setTargetAtTime(0, now(), 0.08);
      acidLoop.stop();
      fireLoop.stop();
      audio.charge.stop();
      stopBgm();
      return;
    }
    if (!ensureCtx()) { enabled = false; return; }
    if (ctx.state === 'suspended') await ctx.resume();
    master.gain.setTargetAtTime(0.85, now(), 0.15);
    loadSamples();     // ここで初めて音声ファイルを取りに行く
    startBgm();
  },

  /**
   * 効果音をひとつ鳴らす。
   * 同じ名前の素材が読み込まれていればそちらを、無ければ合成音を使う。
   */
  play(name, ...args) {
    if (!enabled || !ctx) return;
    try {
      const buf = buffers[name];
      if (buf) {
        const gain = SAMPLE_GAIN[name] ? SAMPLE_GAIN[name](...args) : 0.7;
        // 鐘だけは鳴らす時刻を指定できる（呪詛の解放に重ねるため）
        const when = name === 'bell' && typeof args[0] === 'number' ? args[0] : now();
        playSample(buf, gain, when);
        return;
      }
      if (SE[name]) SE[name](...args);
    } catch (e) {
      console.warn('[audio]', name, e);
    }
  },

  /** 酸をかけている間 */
  acid: {
    start() { if (enabled && ctx) acidLoop.start(2400, 1.1, 0.0); },
    /** @param {number} intensity 0〜1（指の動きの速さ） */
    set(intensity) {
      if (enabled) acidLoop.set(0.03 + intensity * 0.2, 1500 + intensity * 2600);
    },
    stop() { acidLoop.stop(); },
  },

  /** 燃やしている間 */
  fire: {
    start() { if (enabled && ctx) fireLoop.start(700, 0.6, 0.05); },
    set(intensity) { if (enabled) fireLoop.set(0.06 + intensity * 0.34, 400 + intensity * 900); },
    stop() { fireLoop.stop(); },
  },

  /** 呪をかける長押し中 */
  charge: {
    start() {
      if (!enabled || !ctx || chargeDrone) return;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 44;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 200;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(lp).connect(g).connect(master);
      osc.start();
      chargeDrone = { osc, lp, g };

      // 心音。溜まるほど速くなる。
      let progress = 0;
      const beat = () => {
        if (!chargeDrone) return;
        SE.heart(progress);
        const interval = 900 - progress * 620;
        heartTimer = setTimeout(beat, Math.max(220, interval));
      };
      chargeDrone.setProgress = (p) => { progress = p; };
      beat();
    },
    /** @param {number} p 0〜1 */
    set(p) {
      if (!chargeDrone) return;
      chargeDrone.setProgress(p);
      chargeDrone.g.gain.setTargetAtTime(0.05 + p * 0.22, now(), 0.1);
      chargeDrone.lp.frequency.setTargetAtTime(200 + p * 700, now(), 0.15);
      chargeDrone.osc.frequency.setTargetAtTime(44 + p * 26, now(), 0.3);
    },
    stop() {
      clearTimeout(heartTimer);
      if (!chargeDrone) return;
      const { osc, g } = chargeDrone;
      g.gain.setTargetAtTime(0, now(), 0.05);
      setTimeout(() => stopAt(osc, now()), 300);
      chargeDrone = null;
    },
  },

  /** BGM だけ止める（燼の画面で静けさを作る） */
  hushBgm() {
    if (bgmGain) bgmGain.gain.setTargetAtTime(0, now(), 1.2);
  },
  unhushBgm() {
    if (bgmGain) bgmGain.gain.setTargetAtTime(0.16, now(), 0.6);
  },
};
