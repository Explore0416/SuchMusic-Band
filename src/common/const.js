/**
 * const.js —— 手环快应用常量
 *
 * @module common/const
 */
'use strict';

/**
 * 路由（**必须与 manifest.router.pages 的 key 逐字一致**）
 *
 * Vela 的 `router.push({uri})` 匹配的是 manifest 中注册的页面 key
 * （`pages/<目录>`），**不是** ux 文件路径（`pages/<目录>/index`）。
 * 写成 `/pages/control/index` 会找不到页面、跳转静默失败。
 * 对照真实 Vela 应用：`router.push({ uri: '/pages/detail' })`。
 */
var ROUTES = {
  INDEX: '/pages/index',
  CONTROL: '/pages/control',
  SEARCH: '/pages/search',
  MODE: '/pages/mode',
  LYRIC: '/pages/lyric'
};

/** 品牌与文案 */
var TEXT = {
  brand: 'SuchMusic',
  connected: '已连接',
  disconnected: '未连接',
  connecting: '连接中',
  appMissing: '手机未装App',
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
  appMissing: TEXT.appMissing,
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
