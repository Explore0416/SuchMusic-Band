/**
 * protocol.test.js —— protocol 模块单元测试
 * 运行： node test/protocol.test.js
 */
'use strict';

var T = require('./tinytest.js');
// 通过根 utils 入口加载（满足「可在 Node 下直接 require」要求）
var P = require('../src/utils/protocol.js');

T.test('信封编码/解码往返', function () {
  var env = { v: 1, id: 'b-7fa1-0007', type: 'req', method: 'playback.next', payload: {}, ts: 1730000000000 };
  var s = P.encodeEnvelope(env);
  var d = P.decodeEnvelope(s);
  T.ok(d.ok, 'decode ok');
  T.equal(d.value, env);
});

T.test('encode 校验失败抛错', function () {
  T.throws(function () {
    P.encodeEnvelope({ v: 1, id: 'x', type: 'req', method: 'nope.here', payload: {} });
  }, 'unknown method should throw');
});

T.test('未知方法被拒绝', function () {
  var r = P.validateEnvelope({ v: 1, id: 'b-1-0001', type: 'req', method: 'foo.bar', payload: {} });
  T.ok(!r.ok);
});

T.test('未知事件被拒绝', function () {
  var r = P.validateEnvelope({ v: 1, id: 'p-1-0001', type: 'evt', event: 'nope.event', payload: {} });
  T.ok(!r.ok);
});

T.test('payload 必须为对象', function () {
  var r = P.validateEnvelope({ v: 1, id: 'b-1-0001', type: 'req', method: 'sys.ping', payload: null });
  T.ok(!r.ok);
});

T.test('res/err 复用请求 id', function () {
  var res = { v: 1, id: 'b-7fa1-0007', type: 'res', payload: { ok: true } };
  T.ok(P.decodeEnvelope(res).ok);
  var err = { v: 1, id: 'b-7fa1-0007', type: 'err', payload: { code: 'E_TIMEOUT', message: 'x' } };
  T.ok(P.decodeEnvelope(err).ok);
});

T.test('坏 JSON 返回 E_BADREQ', function () {
  var d = P.decodeEnvelope('{not json');
  T.ok(!d.ok);
  T.equal(d.error, 'E_BADREQ');
});

T.test('版本协商取交集最大值', function () {
  T.equal(P.negotiateVersion([1, 2, 3], [2, 3, 4]), 3);
  T.equal(P.negotiateVersion([1], [1]), 1);
  T.equal(P.negotiateVersion([1], [2]), null, '空交集 → null');
});

T.test('能力协商取交集并保持顺序', function () {
  var caps = P.negotiateCaps(['playback', 'queue', 'search', 'lyric'], ['search', 'playback', 'volume']);
  T.equal(caps, ['playback', 'search']);
});

T.test('能力令牌与冻结清单一致', function () {
  T.equal(P.CAPS, ['playback', 'queue', 'search', 'lyric', 'playmode', 'volume', 'cover', 'transfer']);
});

T.test('事件清单为 14 个且含关键事件', function () {
  T.equal(P.EVENTS.length, 14);
  T.ok(P.isEvent('lyric.line'));
  T.ok(P.isEvent('player.progress'));
  T.ok(!P.isEvent('player.progress123'));
});

T.test('方法 → 能力映射', function () {
  T.equal(P.methodCap('playback.setMode'), 'playmode');
  T.equal(P.methodCap('playback.setVolume'), 'volume');
  T.equal(P.methodCap('state.get'), null, '无能力要求');
  T.equal(P.methodCap('unknown.method'), undefined, '方法不存在');
  T.ok(P.hasMethod('lyric.window'));
  T.ok(P.hasMethod('xfer.nack'));
});

T.test('错误码表冻结', function () {
  ['E_BADREQ', 'E_UNSUPPORTED', 'E_TIMEOUT', 'E_NOT_READY', 'E_EMPTY',
    'E_NOT_FOUND', 'E_LINK', 'E_TOOLARGE', 'E_CRC', 'E_INTERNAL'].forEach(function (c) {
    T.ok(P.isErrorCode(c), 'missing ' + c);
  });
});

T.test('id 生成格式 {origin}-{bootId}-{seq}', function () {
  T.equal(P.makeId('b', '7fa1', 7), 'b-7fa1-0007');
  T.equal(P.makeId('w', '0b12', 1), 'w-0b12-0001');
  var boot = P.genBootId(function () { return 0.5; });
  T.equal(boot.length, 4);
});

T.test('能力门控：缺失能力时不允许发', function () {
  var env = { v: 1, id: 'b-1-0001', type: 'req', method: 'playback.setVolume', payload: { volume: 50 } };
  var r = P.checkCapability(env, ['playback', 'lyric']);
  T.ok(!r.ok);
  T.equal(r.missing, 'volume');
  var r2 = P.checkCapability(env, ['volume']);
  T.ok(r2.ok);
});

// 单独运行
if (require.main === module) {
  T.summary('protocol.test.js');
}
