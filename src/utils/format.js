/**
 * format.js —— 时间 / 文本截断 / 数值工具
 *
 * 手环 UI 专用：`<list-item>` 文本不换行（§F10），需预先截断。
 * 纯逻辑，无运行时依赖，可被 `node` 直接 require。
 *
 * @module format
 */
'use strict';

/**
 * 毫秒 → `mm:ss`（≥1 小时时 `hh:mm:ss`）。非法/负值返回 `00:00`。
 * @param {number} ms
 * @returns {string}
 */
function formatTime(ms) {
  var total = Math.floor((Number(ms) || 0) / 1000);
  if (!isFinite(total) || total < 0) {
    total = 0;
  }
  var h = Math.floor(total / 3600);
  var m = Math.floor((total % 3600) / 60);
  var s = total % 60;
  if (h > 0) {
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }
  return pad2(m) + ':' + pad2(s);
}

/**
 * 毫秒 → 播放进度比例 [0,1]。
 * @param {number} positionMs
 * @param {number} durationMs
 * @returns {number}
 */
function progressRatio(positionMs, durationMs) {
  var d = Number(durationMs) || 0;
  if (d <= 0) {
    return 0;
  }
  var r = (Number(positionMs) || 0) / d;
  return clamp(r, 0, 1);
}

/**
 * 比例 → 进度条宽度百分比字符串（保留 1 位小数）。
 * @param {number} ratio
 * @returns {string}
 */
function widthPercent(ratio) {
  var r = clamp(Number(ratio) || 0, 0, 1);
  return (Math.round(r * 1000) / 10) + '%';
}

/**
 * 夹取到 [min,max]。
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(v, min, max) {
  if (!isFinite(v)) {
    return min;
  }
  return Math.min(max, Math.max(min, v));
}

/**
 * 按显示宽度截断文本并加省略号 `…`（不占用额外换行）。
 * 近似宽度：CJK / 全角按 2，其余按 1。
 * @param {string} text
 * @param {number} maxWidth 以「半角字符」为单位的最大宽度
 * @returns {string}
 */
function ellipsize(text, maxWidth) {
  var s = text === null || text === undefined ? '' : String(text);
  if (!maxWidth || maxWidth <= 0) {
    return s;
  }
  var width = 0;
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    var w = c > 0xFF ? 2 : 1;
    if (width + w > maxWidth) {
      return out.length > 0 ? out + '…' : '…';
    }
    out += s.charAt(i);
    width += w;
  }
  return s;
}

/**
 * 按字符数截断（简单模式，CJK 亦按 1）。
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function truncate(text, maxChars) {
  var s = text === null || text === undefined ? '' : String(text);
  if (!maxChars || maxChars <= 0 || s.length <= maxChars) {
    return s;
  }
  return s.slice(0, maxChars) + '…';
}

/**
 * 组合「艺人 · 专辑」，缺省项自动省略。
 * @param {string} artist
 * @param {string} album
 * @returns {string}
 */
function artistAlbum(artist, album) {
  var a = artist || '';
  var b = album || '';
  if (a && b) {
    return a + ' · ' + b;
  }
  return a || b || '';
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

module.exports = {
  formatTime: formatTime,
  progressRatio: progressRatio,
  widthPercent: widthPercent,
  clamp: clamp,
  ellipsize: ellipsize,
  truncate: truncate,
  artistAlbum: artistAlbum
};
