/**
 * const.js —— 手环快应用常量
 *
 * @module common/const
 */
'use strict';

/** 路由（与 manifest.router 一致） */
var ROUTES = {
  INDEX: '/pages/index/index',
  CONTROL: '/pages/control/index',
  SEARCH: '/pages/search/index',
  MODE: '/pages/mode/index',
  LYRIC: '/pages/lyric/index'
};

/** 品牌与文案 */
var TEXT = {
  brand: 'SuchMusic',
  connected: '已连接',
  disconnected: '未连接',
  connecting: '连接中',
  liveTitle: '正在播放',
  emptySong: '暂无歌曲',
  emptyArtist: '—',
  search: '搜索',
  mode: '播放模式',
  lyric: '歌词',
  hot: '热搜',
  history: '最近搜索',
  noResult: '暂无结果',
  noLyric: '暂无歌词',
  playList: '播放列表',
  sendToBand: '发送到手环',
  loading: '加载中…'
};

/** 连接状态 → 展示文案 */
var LINK_TEXT = {
  disconnected: TEXT.disconnected,
  connecting: TEXT.connecting,
  handshaking: TEXT.connecting,
  ready: TEXT.connected
};

/** 默认限制 */
var LIMITS = {
  searchLimit: 10,
  suggestLimit: 6,
  historyMax: 5
};

module.exports = {
  ROUTES: ROUTES,
  TEXT: TEXT,
  LINK_TEXT: LINK_TEXT,
  LIMITS: LIMITS
};
