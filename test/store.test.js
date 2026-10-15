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

T.test('estimateBytes', function () {
  T.equal(S.estimateBytes('abc'), 5); // "abc" 带引号 JSON = 5
  T.ok(S.estimateBytes('晴天') > 0);
});

if (require.main === module) {
  T.summary('store.test.js');
}
