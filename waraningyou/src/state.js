/**
 * state.js — 藁人形の状態。sessionStorage に保存する。
 *
 * 「HP」ではなく「余命（日数）」で持つ。マイナスまで削れる。
 * 内部は常に日数。表示するときだけ 年/ヶ月/日 に整形する。
 */

const KEY = 'jusono-ma/v1';
const DAYS_PER_YEAR = 365;
const DAYS_PER_MONTH = 30;

/** 藁人形ごとに初期寿命を変える（38〜52年）。同じ相手でも引きが違う。 */
function rollInitialLife() {
  const years = 38 + Math.floor(Math.random() * 15);
  return years * DAYS_PER_YEAR;
}

function blank() {
  const life = rollInitialLife();
  return {
    /** 相手の名。空なら「名も無き者」 */
    targetName: '',
    /** 'none' | 'draw' | 'photo' */
    faceMode: 'none',
    /** 顔画像の dataURL（縮小済み）。none のときは null */
    faceImage: null,

    /** 初期寿命（日） */
    lifeInitial: life,
    /** 残り寿命（日）。0 未満まで下がる */
    lifeLeft: life,

    /** 刺さった針 [{ x, y, angle, part }] — x,y は 0〜1 の相対座標 */
    needles: [],
    /** 酸で溶けた跡 [{ x, y, r }] — 同じく相対座標 */
    acidMarks: [],
    /** 部位ごとの命中数。呪いの抽選重みになる */
    partHits: { head: 0, chest: 0, limbs: 0 },

    /** 呪詛帳 [{ rank, category, text, at }] */
    curseLog: [],

    /** 通算 */
    stats: {
      curses: 0,      // 呪をかけた回数
      punches: 0,     // 殴った回数
      needles: 0,     // 刺した針
      acidMs: 0,      // 酸をかけた時間（ミリ秒）
      maxCombo: 0,    // 最大コンボ
      bornAt: Date.now(),
    },

    /** 魂を入れた（＝支度を終えた）か */
    created: false,
    /** 余命が 0 を下回った瞬間の演出を出したか */
    expiredShown: false,
    /** 儀式が済んだ（燃やした）か */
    burned: false,
  };
}

/** 現在の状態。main.js から直接読んでよい（書き換えは下の関数経由で） */
export let state = load();

function load() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return blank();
    const saved = JSON.parse(raw);
    // 壊れた／古い形式は捨てる
    if (typeof saved?.lifeInitial !== 'number') return blank();
    return { ...blank(), ...saved, stats: { ...blank().stats, ...saved.stats } };
  } catch {
    return blank();
  }
}

let saveTimer = 0;

/** 保存。連打で潰れないよう 400ms デバウンス。 */
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

/** 即座に保存（画面遷移やページ離脱の直前に使う） */
export function saveNow() {
  clearTimeout(saveTimer);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    // 写真が大きすぎて容量超過した場合は、顔だけ諦めて残りを保存する
    console.warn('[state] 保存に失敗。顔画像を外して再試行します。', e);
    const fallback = { ...state, faceImage: null };
    try { sessionStorage.setItem(KEY, JSON.stringify(fallback)); } catch { /* 諦める */ }
  }
}

/** 藁人形を作り直す */
export function reset() {
  state = blank();
  saveNow();
  return state;
}

/**
 * 支度画面を飛ばして呪詛之間へ戻れるか。
 * 「まだ何もしていない」かどうかではなく「魂を入れたか」で見る。
 * 作った直後にリロードして名前と顔を失う、ということが起きないように。
 */
export function hasLivingDoll() {
  return state.created && !state.burned;
}

/* ------------------------------------------------------------------ */
/* 寿命                                                                */
/* ------------------------------------------------------------------ */

/**
 * 寿命を削る。
 * @param {number} days 削る日数（正の数）
 * @returns {{ days:number, justExpired:boolean }}
 */
export function drainLife(days) {
  const d = Math.max(0, Math.round(days));
  const wasAlive = state.lifeLeft > 0;
  state.lifeLeft -= d;
  const justExpired = wasAlive && state.lifeLeft <= 0 && !state.expiredShown;
  if (justExpired) state.expiredShown = true;
  save();
  return { days: d, justExpired };
}

/** これまでに削った累計日数 */
export function drainedDays() {
  return state.lifeInitial - state.lifeLeft;
}

/**
 * 藁人形の傷み具合 0〜1。
 * 削った量 ÷ 初期寿命。マイナス域に入っても 1 で頭打ち。
 */
export function damageRatio() {
  return Math.min(1, Math.max(0, drainedDays() / state.lifeInitial));
}

/** 余命が尽きているか */
export function isExpired() {
  return state.lifeLeft <= 0;
}

/* ------------------------------------------------------------------ */
/* 日数の整形                                                          */
/* ------------------------------------------------------------------ */

/**
 * 日数を「43年 5ヶ月」のような文字列にする。
 * 負の値は先頭に − を付ける。
 * @param {number} days
 * @param {{ compact?: boolean }} [opt] compact だと最大2単位まで
 */
export function formatDays(days, opt = {}) {
  const sign = days < 0 ? '−' : '';
  let n = Math.abs(Math.round(days));

  const y = Math.floor(n / DAYS_PER_YEAR);
  n -= y * DAYS_PER_YEAR;
  const m = Math.floor(n / DAYS_PER_MONTH);
  const d = n - m * DAYS_PER_MONTH;

  const parts = [];
  if (y > 0) parts.push(`${y}年`);
  if (m > 0) parts.push(`${m}ヶ月`);
  // 年が出ているときに日まで出すと細かすぎるので省く
  if (d > 0 && y === 0) parts.push(`${d}日`);

  if (parts.length === 0) return `${sign}0日`;
  const limit = opt.compact === false ? 3 : 2;
  return sign + parts.slice(0, limit).join(' ');
}

/** 減少量の表示（「−2ヶ月」など）。0日でも「−1日」とは書かない。 */
export function formatDrain(days) {
  return '−' + formatDays(days).replace(/^−/, '');
}
