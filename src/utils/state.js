/**
 * state.js —— 全局播放状态（单一状态源）
 *
 * 对齐设计文档 §4.1 职责边界：
 *   - `pages/*` 只展示 + 触发命令
 *   - `state.js` 为单一状态源，订阅 rpc 事件后更新
 *   - **不发请求**
 *
 * 纯逻辑（无 Vela 依赖），只提供内存态；持久化由 store.js 负责。
 * 歌词**只存当前行/窗口**，离开歌词页即释放（不落盘，§3.9）。
 *
 * @module state
 */
'use strict';

/**
 * 默认状态快照。
 * @returns {object}
 */
function defaultState() {
  return {
    // 连接
    link: 'disconnected', // disconnected | connecting | handshaking | ready
    proto: 0,
    caps: [],
    server: null, // {app, ver}

    // 播放
    state: 'idle', // idle|loading|playing|paused|error
    playing: false,
    song: null, // {id,name,artist,album,durationMs,source,hasCover}
    positionMs: 0,
    durationMs: 0,
    mode: 'loop',
    volume: 0,
    queue: { count: 0, currentIndex: -1 },

    // 歌词
    lyric: { has: false, count: 0, songId: null, index: -1, text: '' },
    lyricWindow: { songId: null, start: 0, lines: [] },

    // 搜索
    searchHot: [],
    searchHistory: [],
    searchResults: [],

    // 兜底
    lastToast: '',
    ts: 0,

    // 启动诊断：app.onCreate 若抛异常，写入此处，首页可见（正常为空串）
    initError: ''
  };
}

/**
 * 状态容器。
 * @constructor
 */
function Store() {
  this._state = defaultState();
  this._listeners = [];
}

/**
 * 读取当前状态（浅引用，UI 只读）。
 * @returns {object}
 */
Store.prototype.get = function get() {
  return this._state;
};

/**
 * 合并式更新 + 广播。
 * @param {object} patch
 */
Store.prototype.set = function set(patch) {
  var self = this;
  Object.keys(patch || {}).forEach(function (k) {
    self._state[k] = patch[k];
  });
  this._emit();
};

/**
 * 订阅状态变化。
 * @param {function(object):void} fn
 * @returns {function():void} 取消订阅
 */
Store.prototype.subscribe = function subscribe(fn) {
  var self = this;
  this._listeners.push(fn);
  return function unsubscribe() {
    var i = self._listeners.indexOf(fn);
    if (i !== -1) {
      self._listeners.splice(i, 1);
    }
  };
};

Store.prototype._emit = function _emit() {
  var s = this._state;
  var ls = this._listeners.slice();
  for (var i = 0; i < ls.length; i++) {
    try {
      ls[i](s);
    } catch (e) {
      // 单个监听器异常不影响其它监听器
    }
  }
};

/**
 * 应用一条服务端事件（§3.6 事件清单）到状态。
 * @param {string} event
 * @param {object} payload
 * @returns {object} 应用后的状态
 */
Store.prototype.applyEvent = function applyEvent(event, payload) {
  var s = this._state;
  payload = payload || {};
  switch (event) {
    case 'sys.hello_ack':
      s.proto = payload.proto && payload.proto.length ? payload.proto[0] : s.proto;
      if (payload.caps) { s.caps = payload.caps.slice(); }
      if (payload.server) { s.server = payload.server; }
      s.link = 'ready';
      break;
    case 'sys.error':
      s.lastToast = payload.message || payload.code || 'error';
      break;
    case 'player.state':
      s.state = payload.state || s.state;
      s.playing = payload.playing !== undefined ? !!payload.playing : (s.state === 'playing');
      break;
    case 'player.song':
      s.song = payload.song || null;
      if (s.song) {
        s.durationMs = s.song.durationMs || s.durationMs;
        s.lyric = { has: false, count: 0, songId: s.song.id, index: -1, text: '' };
        s.lyricWindow = { songId: s.song.id, start: 0, lines: [] };
      }
      break;
    case 'player.progress':
      s.positionMs = typeof payload.positionMs === 'number' ? payload.positionMs : s.positionMs;
      if (typeof payload.durationMs === 'number' && payload.durationMs > 0) {
        s.durationMs = payload.durationMs;
      }
      s.ts = payload.ts || s.ts;
      break;
    case 'player.mode':
      s.mode = payload.mode || s.mode;
      break;
    case 'player.volume':
      s.volume = typeof payload.volume === 'number' ? payload.volume : s.volume;
      break;
    case 'player.queue':
      s.queue = {
        count: payload.count || 0,
        currentIndex: payload.currentIndex === undefined ? -1 : payload.currentIndex
      };
      break;
    case 'lyric.line':
      s.lyric = {
        has: true,
        count: s.lyric.count,
        songId: payload.songId || s.lyric.songId,
        index: typeof payload.index === 'number' ? payload.index : s.lyric.index,
        text: payload.text || '',
        t: payload.t
      };
      break;
    case 'lyric.meta':
      s.lyric = {
        has: !!payload.has,
        count: payload.count || 0,
        songId: payload.songId || s.lyric.songId,
        index: s.lyric.index,
        text: s.lyric.text
      };
      break;
    case 'search.hot':
      s.searchHot = (payload.items || []).slice();
      break;
    case 'search.result':
      if (payload.results) {
        s.searchResults = payload.results.slice();
      }
      break;
    case 'band.toast':
      s.lastToast = payload.text || '';
      break;
    default:
      break;
  }
  this._emit();
  return s;
};

/**
 * 应用 state.get 返回的 StateSnapshot（§3.5.1）。
 * @param {object} snap
 * @returns {object}
 */
Store.prototype.applySnapshot = function applySnapshot(snap) {
  if (!snap || typeof snap !== 'object') {
    return this._state;
  }
  var s = this._state;
  if (snap.state) { s.state = snap.state; }
  if (snap.playing !== undefined) { s.playing = !!snap.playing; }
  if (snap.song !== undefined) { s.song = snap.song; }
  if (typeof snap.positionMs === 'number') { s.positionMs = snap.positionMs; }
  if (typeof snap.durationMs === 'number') { s.durationMs = snap.durationMs; }
  if (snap.mode) { s.mode = snap.mode; }
  if (typeof snap.volume === 'number') { s.volume = snap.volume; }
  if (snap.queue) { s.queue = snap.queue; }
  if (snap.lyric) { s.lyric = { has: !!snap.lyric.has, count: snap.lyric.count || 0, songId: s.song ? s.song.id : null, index: -1, text: '' }; }
  if (snap.ts) { s.ts = snap.ts; }
  this._emit();
  return s;
};

/**
 * 释放歌词窗口（离开歌词页时调用，§3.9）。
 */
Store.prototype.clearLyricWindow = function clearLyricWindow() {
  this._state.lyricWindow = { songId: this._state.song ? this._state.song.id : null, start: 0, lines: [] };
  this._emit();
};

/** 单例 */
var singleton = new Store();

module.exports = {
  Store: Store,
  defaultState: defaultState,
  get: function () { return singleton.get(); },
  set: function (patch) { return singleton.set(patch); },
  subscribe: function (fn) { return singleton.subscribe(fn); },
  applyEvent: function (e, p) { return singleton.applyEvent(e, p); },
  applySnapshot: function (snap) { return singleton.applySnapshot(snap); },
  clearLyricWindow: function () { return singleton.clearLyricWindow(); },
  instance: singleton
};
