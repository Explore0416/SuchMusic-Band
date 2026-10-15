/**
 * dedupe.test.js —— req.id LRU 去重单元测试
 * 运行： node test/dedupe.test.js
 */
'use strict';

var T = require('./tinytest.js');
var D = require('../utils/dedupe.js');

T.test('LRU 容量淘汰（默认 64）', function () {
  var lru = new D.Lru(64);
  for (var i = 0; i < 64; i++) { lru.set('k' + i, i); }
  T.equal(lru.size, 64);
  lru.set('k64', 64);
  T.equal(lru.size, 64, 'size capped');
  T.ok(!lru.has('k0'), 'oldest evicted');
  T.ok(lru.has('k64'));
});

T.test('get 刷新最近使用（防止被淘汰）', function () {
  var lru = new D.Lru(3);
  lru.set('a', 1); lru.set('b', 2); lru.set('c', 3);
  T.equal(lru.get('a'), 1); // a 变为最近
  lru.set('d', 4); // 淘汰 b
  T.ok(lru.has('a'));
  T.ok(!lru.has('b'));
  T.equal(lru.keys(), ['c', 'a', 'd']);
});

T.test('ReqDedupe 命中回放，不重复执行', function () {
  var d = new D.ReqDedupe(64);
  var calls = 0;
  var r1 = d.run('b-1-0007', function () { calls++; return { ok: true, song: 'A' }; });
  T.ok(!r1.hit);
  T.equal(calls, 1);

  var r2 = d.run('b-1-0007', function () { calls++; return { ok: true, song: 'B' }; });
  T.ok(r2.hit, 'second should hit');
  T.equal(calls, 1, 'fn not executed again');
  T.equal(r2.response, { ok: true, song: 'A' }, 'replays cached response');
});

T.test('重复命令不会重复切歌（模拟 5 次同 id）', function () {
  var d = new D.ReqDedupe(64);
  var switches = 0;
  for (var i = 0; i < 5; i++) {
    d.run('b-9-0001', function () { switches++; return { ok: true }; });
  }
  T.equal(switches, 1);
});

T.test('超过容量后旧 id 不再命中', function () {
  var d = new D.ReqDedupe(2);
  d.run('id1', function () { return 1; });
  d.run('id2', function () { return 2; });
  d.run('id3', function () { return 3; }); // 淘汰 id1
  var hit1 = d.check('id1');
  T.ok(!hit1.hit);
  T.ok(d.check('id3').hit);
});

if (require.main === module) {
  T.summary('dedupe.test.js');
}
