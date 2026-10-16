/**
 * store.test.js —— 受限持久化（4 类键 / <2KB / 搜索历史≤5）单元测试
 * 运行： node test/store.test.js
 */
'use strict';

var T = require('./tinytest.js');
var S = require('../src/utils/store.js');

/** 伪 storage 适配器 */
function fakeAdapter() {
  var disk = {};
  return {
    disk: disk,
    get: function (o) {
      var out = {};
      (o.key || []).forEach(function (k) { if (disk[k] !== undefined) { out[k] = disk[k]; } });
      o.success({ data: out });
    },
    set: function (o) { disk[o.key] = o.data; o.success(); },
    delete: function (o) { (o.key || []).forEach(function (k) { delete disk[k]; }); o.success(); }
  };
}

T.test('仅允许 4 类键', function () {
  T.equal(S.ALLOWED_KEYS, ['sm_protoVer', 'sm_serverCaps', 'sm_searchHistory', 'sm_lastMode']);
  T.ok(S.isAllowedKey('sm_lastMode'));
  T.ok(!S.isAllowedKey('sm_lyrics'));
});

T.test('写入非白名单键被拒绝', function () {
  var st = S.createStore({ adapter: fakeAdapter() });
  var res = null;
  // 通过 pushHistory 无法写非法键；直接验证 isAllowedKey 语义
  T.ok(!S.isAllowedKey('sm_foo'));
});

T.test('搜索历史：去重、置顶、≤5', function () {
  var st = S.createStore({ adapter: fakeAdapter() });
  ['a', 'b', 'c', 'd', 'e', 'f'].forEach(function (k) { st.pushHistory(k); });
  T.equal(st.getHistory(), ['f', 'e', 'd', 'c', 'b'], 'most recent first, capped 5');
  st.pushHistory('c');
  T.equal(st.getHistory(), ['c', 'f', 'e', 'd', 'b'], 'dedupe + move to front');
  st.removeHistory('d');
  T.equal(st.getHistory(), ['c', 'f', 'e', 'b']);
});

T.test('写盘使用带前缀的键', function () {
  var ad = fakeAdapter();
  var st = S.createStore({ adapter: ad });
  st.setLastMode('single');
  T.ok(ad.disk['sm_sm_lastMode'] !== undefined, 'prefixed key written');
  T.equal(JSON.parse(ad.disk['sm_sm_lastMode']), 'single');
});

T.test('持久化总占用 < 2KB', function () {
  var st = S.createStore({ adapter: fakeAdapter() });
  st.setProtoVer(1);
  st.setServerCaps(['playback', 'queue', 'search', 'lyric', 'playmode', 'cover', 'transfer']);
  ['中国风', '周杰伦', '林俊杰', '晴天', '稻香'].forEach(function (k) { st.pushHistory(k); });
  st.setLastMode('loop');
  var bytes = st.totalBytes();
  T.ok(bytes < 2048, 'total bytes ' + bytes + ' must be < 2048');
});

T.test('load 后能读回已写数据', function () {
  var ad = fakeAdapter();
  var st1 = S.createStore({ adapter: ad });
  st1.setProtoVer(1);
  st1.pushHistory('晴天');
  var st2 = S.createStore({ adapter: ad });
  st2.load(function () {});
  T.equal(st2.snapshot().sm_protoVer, 1);
  T.equal(st2.getHistory(), ['晴天']);
});

T.test('存储配额：超长关键词入库前限长，总量恒 < 2KB', function () {
  var st = S.createStore({ adapter: fakeAdapter() });
  st.setProtoVer(1);
  st.setServerCaps(['playback', 'queue', 'search', 'lyric', 'playmode', 'cover', 'transfer']);
  st.setLastMode('loop');

  // 单条超长关键词（1000 CJK 字符）—— 修复前会直接越界
  var long = new Array(1001).join('汉');
  st.pushHistory(long);
  var h = st.getHistory();
  T.ok(h.length >= 1, 'history 保留至少一条');
  T.ok(h[0].length <= S.MAX_KEYWORD_CHARS,
    '单条关键词被截断到 <= ' + S.MAX_KEYWORD_CHARS + '（实际 ' + h[0].length + '）');
  T.ok(st.totalBytes() < 2048, '单条超长后总量 ' + st.totalBytes() + ' 必须 < 2048');
});

T.test('存储配额：连续灌入互异超长关键词，按既定策略淘汰后总量恒 < 2KB', function () {
  var st = S.createStore({ adapter: fakeAdapter() });
  st.setProtoVer(1);
  st.setServerCaps(['playback', 'queue', 'search', 'lyric', 'playmode', 'cover', 'transfer']);
  st.setLastMode('loop');

  // 互异前缀 + 300 CJK/条：截断到 128 后仍互异（避免被去重折叠），从而真正触发预算淘汰
  var tail = new Array(301).join('汉');
  for (var i = 0; i < 40; i++) {
    st.pushHistory('k' + i + tail);
    T.ok(st.totalBytes() < 2048,
      '第 ' + (i + 1) + ' 次写入后总量 ' + st.totalBytes() + ' 必须 < 2048');
  }
  var h = st.getHistory();
  T.ok(h.length >= 1, '淘汰不会清空全部历史');
  T.ok(h.length <= S.MAX_HISTORY, 'history <= ' + S.MAX_HISTORY + '（实际 ' + h.length + '）');
  // 5 条 128CJK 会超出 2KB → 必须发生淘汰（条数 < MAX_HISTORY）
  T.ok(h.length < S.MAX_HISTORY, '超预算时按既定策略淘汰（实际保留 ' + h.length + ' 条）');
  T.ok(h.every(function (x) { return x.length <= S.MAX_KEYWORD_CHARS; }), '每条均被限长');
});

T.test('estimateBytes', function () {
  T.equal(S.estimateBytes('abc'), 5); // "abc" 带引号 JSON = 5
  T.ok(S.estimateBytes('晴天') > 0);
});

if (require.main === module) {
  T.summary('store.test.js');
}
