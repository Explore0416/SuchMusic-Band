/**
 * mode.js —— PlayMode 枚举与手环显示文案的双向映射
 *
 * 对齐设计文档 §3.5.1 / §5 / 附录 D / §4.4 D1：
 *   播放模式仅 `loop / single / shuffle`，与手机 PlayMode 一一对应。
 *   手环文案：
 *     - 模式页（§5 线框 ④）：顺序播放 / 单曲循环 / 乱序播放
 *     - 控制页快捷（§5 线框 ②）：单曲循环 / 顺序 / 乱序
 *
 * 纯逻辑，无运行时依赖，可被 `node` 直接 require。
 *
 * @module mode
 */
'use strict';

/** 播放模式枚举（与手机 PlayMode 一致，禁止扩展） */
var PlayMode = {
  LOOP: 'loop',
  SINGLE: 'single',
  SHUFFLE: 'shuffle'
};

/** 协议取值列表 */
var MODES = [PlayMode.LOOP, PlayMode.SINGLE, PlayMode.SHUFFLE];

/** 完整文案（模式页） */
var LABELS = {
  loop: '顺序播放',
  single: '单曲循环',
  shuffle: '乱序播放'
};

/** 短文案（控制页快捷切换） */
var SHORT_LABELS = {
  loop: '顺序',
  single: '单曲循环',
  shuffle: '乱序'
};

/** 图标标识（对应 assets，手环侧可用文字字形兜底） */
var ICONS = {
  loop: 'list',
  single: 'single',
  shuffle: 'shuffle'
};

/** 字形兜底（不依赖 PNG 资源） */
var GLYPHS = {
  loop: '≡',
  single: '↻',
  shuffle: '⤨'
};

/**
 * 是否合法模式值。
 * @param {*} mode
 * @returns {boolean}
 */
function isValid(mode) {
  return MODES.indexOf(mode) !== -1;
}

/**
 * 归一化：未知值回退 `loop`（§4.4 D1）。
 * @param {*} mode
 * @returns {string}
 */
function normalize(mode) {
  return isValid(mode) ? mode : PlayMode.LOOP;
}

/**
 * 模式 → 完整文案（模式页）。
 * @param {*} mode
 * @returns {string}
 */
function label(mode) {
  return LABELS[normalize(mode)];
}

/**
 * 模式 → 短文案（控制页）。
 * @param {*} mode
 * @returns {string}
 */
function shortLabel(mode) {
  return SHORT_LABELS[normalize(mode)];
}

/**
 * 模式 → 图标标识。
 * @param {*} mode
 * @returns {string}
 */
function icon(mode) {
  return ICONS[normalize(mode)];
}

/**
 * 模式 → 字形兜底（无资源时使用）。
 * @param {*} mode
 * @returns {string}
 */
function glyph(mode) {
  return GLYPHS[normalize(mode)];
}

/**
 * 文案 → 模式（反向映射，支持完整/短文案，未知返回 null）。
 * @param {string} text
 * @returns {string|null}
 */
function fromLabel(text) {
  if (typeof text !== 'string') {
    return null;
  }
  for (var i = 0; i < MODES.length; i++) {
    var m = MODES[i];
    if (LABELS[m] === text || SHORT_LABELS[m] === text) {
      return m;
    }
  }
  return null;
}

/**
 * 循环切换到下一个模式：loop → single → shuffle → loop。
 * @param {*} mode
 * @returns {string}
 */
function cycle(mode) {
  var idx = MODES.indexOf(normalize(mode));
  return MODES[(idx + 1) % MODES.length];
}

/**
 * 列出全部模式及其展示信息（供模式页渲染）。
 * @param {*} current
 * @returns {Array<{mode:string,label:string,short:string,icon:string,glyph:string,selected:boolean}>}
 */
function list(current) {
  var cur = normalize(current);
  return MODES.map(function (m) {
    return {
      mode: m,
      label: LABELS[m],
      short: SHORT_LABELS[m],
      icon: ICONS[m],
      glyph: GLYPHS[m],
      selected: m === cur
    };
  });
}

module.exports = {
  PlayMode: PlayMode,
  MODES: MODES,
  LABELS: LABELS,
  SHORT_LABELS: SHORT_LABELS,
  ICONS: ICONS,
  GLYPHS: GLYPHS,
  isValid: isValid,
  normalize: normalize,
  label: label,
  shortLabel: shortLabel,
  icon: icon,
  glyph: glyph,
  fromLabel: fromLabel,
  cycle: cycle,
  list: list
};
