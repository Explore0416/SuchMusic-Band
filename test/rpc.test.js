/**
 * rpc.test.js —— RPC 层单元测试（握手协商 / 请求响应 / 能力门控 / 分片派发）
 * 使用伪 link + 伪定时器，不触碰 Vela 运行时。
 * 运行： node test/rpc.test.js
 */
'use strict';

var T = require('./tinytest.js');
var rpcMod = require('../src/utils/rpc.js');
var stateMod = require('../src/utils/state.js');
var X = require('../src/utils/transfer.js');

/** 伪 interconnect link */
function fakeLink() {
  return {
    handlers: [],
    statusHandlers: [],
    sent: [],
    onMessage: function (h) { this.handlers.push(h); },
    onStatus: function (h) { this.statusHandlers.push(h); },
    /** 模拟 interconnect 状态回调（emitStatus） */
    emitStatus: function (info) { this.statusHandlers.forEach(function (h) { h(info); }); },
    send: function (text, cb) { this.sent.push(text); if (cb) { cb({ ok: true }); } },
    getState: function () { return 'CONNECTING'; },
    /** 模拟收到一条手环→手机方向的帧（手机发来的） */
    deliver: function (obj) {
      var text = typeof obj === 'string' ? obj : JSON.stringify(obj);
      this.handlers.forEach(function (h) { h(text); });
    }
  };
}

/** 可控伪定时器 */
function fakeTimers() {
  var tasks = [];
  return {
    setTimeout: function (fn, ms) { tasks.push({ fn: fn, ms: ms }); return tasks.length - 1; },
    clearTimeout: function (id) { if (tasks[id]) { tasks[id].fn = null; } },
    _pending: function () { return tasks.filter(function (t) { return t.fn; }); }
  };
}

function lastSent(link) {
  return JSON.parse(link.sent[link.sent.length - 1]);
}

/** 授予全部能力（模拟收到 sys.hello_ack） */
function grantCaps(link) {
  link.deliver({
    v: 1, id: 'p-0001-0002', type: 'evt', event: 'sys.hello_ack',
    payload: { proto: [1], caps: ['playback', 'queue', 'search', 'lyric', 'playmode', 'cover', 'transfer'], server: { app: 'SuchMusic', ver: '0.12.0' }, clock: 1 }
  });
}

T.test('握手：版本与能力协商（取交集）', function () {
  var link = fakeLink();
  var rpc = rpcMod.createRpc({ link: link, state: new stateMod.Store(), timers: fakeTimers(), now: function () { return 1; } });
  rpc.attach();

  var ack = null;
  rpc.handshake(function (r) { ack = r; });

  var hello = lastSent(link);
  T.equal(hello.method, 'sys.hello');
  T.equal(hello.payload.role, 'band');
  T.equal(hello.payload.proto, [1]);

  link.deliver({
    v: 1, id: 'p-0001-0001', type: 'evt', event: 'sys.hello_ack',
    payload: { proto: [1], caps: ['playback', 'search', 'volume', 'lyric'], server: { app: 'SuchMusic', ver: '0.12.0' }, clock: 1 }
  });

  T.ok(ack && ack.ok, 'handshake ack ok');
  T.equal(ack.v, 1);
  T.equal(ack.caps, ['playback', 'search', 'lyric'], 'band.caps ∩ phone.caps');
  T.equal(rpc.isReady(), true);
  T.equal(rpc.getSessionVersion(), 1);
});

T.test('请求/响应按 id 关联', function () {
  var link = fakeLink();
  var rpc = rpcMod.createRpc({ link: link, state: new stateMod.Store(), timers: fakeTimers(), now: function () { return 1; } });
  rpc.attach();

  var out = null;
  rpc.request('state.get', {}, function (r) { out = r; });
  var env = lastSent(link);

  link.deliver({ v: 1, id: env.id, type: 'res', payload: { state: 'playing' } });
  T.ok(out && out.ok);
  T.equal(out.payload, { state: 'playing' });
});

T.test('能力门控：缺失能力不发请求', function () {
  var link = fakeLink();
  var rpc = rpcMod.createRpc({ link: link, state: new stateMod.Store(), timers: fakeTimers(), now: function () { return 1; } });
  rpc.attach();
  // 未握手 → activeCaps 为空，volume 缺失
  var out = null;
  rpc.request('playback.setVolume', { volume: 50 }, function (r) { out = r; });
  T.ok(out && !out.ok && out.error === 'E_UNSUPPORTED');
  T.equal(out.missing, 'volume');
  T.equal(link.sent.length, 0, 'nothing sent');
});

T.test('错误响应回传 code/message', function () {
  var link = fakeLink();
  var rpc = rpcMod.createRpc({ link: link, state: new stateMod.Store(), timers: fakeTimers(), now: function () { return 1; } });
  rpc.attach();
  grantCaps(link);
  var out = null;
  rpc.request('playback.next', {}, function (r) { out = r; });
  var env = lastSent(link);
  link.deliver({ v: 1, id: env.id, type: 'err', payload: { code: 'E_EMPTY', message: 'queue empty' } });
  T.ok(out && !out.ok);
  T.equal(out.error, 'E_EMPTY');
});

T.test('分片响应：res(__chunked) + xfer.chunk 组装后回填请求', function () {
  var link = fakeLink();
  var rpc = rpcMod.createRpc({ link: link, state: new stateMod.Store(), timers: fakeTimers(), now: function () { return 1; } });
  rpc.attach();
  grantCaps(link);

  var out = null;
  rpc.request('lyric.window', { songId: 's1', index: 5 }, function (r) { out = r; });
  var env = lastSent(link);

  var entity = { songId: 's1', start: 5, lines: [{ t: 0, text: '甲' }, { t: 3200, text: '乙' }] };
  var frames = X.buildChunkFrames('lyric_window', JSON.stringify(entity), { tid: 't-0007', maxBytes: 24 });

  // 1) res 通知分片
  link.deliver({ v: 1, id: env.id, type: 'res', payload: { __chunked: true, tid: 't-0007', total: frames.total, bytes: frames.bytes, crc32: frames.crc32 } });
  T.ok(!out, 'not resolved before chunks');

  // 2) header → data* → end
  link.deliver({ v: 1, id: 'p-1-0100', type: 'evt', event: 'xfer.chunk', payload: frames.header });
  frames.datas.forEach(function (d) { link.deliver({ v: 1, id: 'p-1-0101', type: 'evt', event: 'xfer.chunk', payload: d }); });
  link.deliver({ v: 1, id: 'p-1-0109', type: 'evt', event: 'xfer.chunk', payload: frames.end });

  T.ok(out && out.ok, 'request resolved after assembly');
  T.ok(out.chunked);
  T.equal(out.payload.lines.length, 2);
  T.equal(out.payload.start, 5);
});

T.test('事件转发到 state 与监听器', function () {
  var link = fakeLink();
  var st = new stateMod.Store();
  var rpc = rpcMod.createRpc({ link: link, state: st, timers: fakeTimers(), now: function () { return 1; } });
  rpc.attach();

  var seen = [];
  rpc.onEvent(function (name, payload) { seen.push(name); });

  link.deliver({ v: 1, id: 'p-1-0002', type: 'evt', event: 'player.mode', payload: { mode: 'shuffle' } });
  T.equal(st.get().mode, 'shuffle');
  T.ok(seen.indexOf('player.mode') !== -1);
});

T.test('坏信封被丢弃且不抛异常', function () {
  var link = fakeLink();
  var rpc = rpcMod.createRpc({ link: link, state: new stateMod.Store(), timers: fakeTimers(), now: function () { return 1; } });
  rpc.attach();
  link.deliver('{not json');
  link.deliver({ v: 1, id: 'x', type: 'req', method: 'bad.method', payload: {} });
  T.ok(true, 'no throw');
});

/* ------------------------------------------------------------------ */
/* 回归：自动握手（attach 触发时机）                                     */
/* 背景：attach() 曾以 info.state==='READY' || info.connected 为触发条件，*/
/*       而 READY 只能由握手成功（sys.hello_ack）产生 → 自引用死锁，      */
/*       自动握手永不触发。修复后应在物理链路进入 HANDSHAKING 时即握手。  */
/* ------------------------------------------------------------------ */

/** 统计已发出的 sys.hello 条数 */
function countHello(link) {
  return link.sent.filter(function (t) {
    var e = JSON.parse(t);
    return e.method === 'sys.hello';
  }).length;
}

T.test('回归：attach 后链路进入 HANDSHAKING 应自动发出 sys.hello', function () {
  var link = fakeLink();
  var rpc = rpcMod.createRpc({ link: link, state: new stateMod.Store(), timers: fakeTimers(), now: function () { return 1; } });
  rpc.attach();

  // attach 本身不该发帧
  T.equal(link.sent.length, 0, 'attach 本身不发帧');

  // 物理链路连上：FSM open → HANDSHAKING（此时尚未、也不可能已是 READY）
  link.emitStatus({ state: 'HANDSHAKING', connected: false, reconnects: 0 });

  T.ok(link.sent.length >= 1, '进入 HANDSHAKING 后应有出帧');
  var hello = JSON.parse(link.sent[link.sent.length - 1]);
  T.equal(hello.type, 'req', '出帧 type=req');
  T.equal(hello.method, 'sys.hello', '自动握手：sys.hello');
  T.equal(hello.payload.role, 'band', '握手 payload.role=band');
});

T.test('回归：同一轮 HANDSHAKING 只握手一次；重连后重新握手', function () {
  var link = fakeLink();
  var rpc = rpcMod.createRpc({ link: link, state: new stateMod.Store(), timers: fakeTimers(), now: function () { return 1; } });
  rpc.attach();

  link.emitStatus({ state: 'HANDSHAKING', connected: false });
  link.emitStatus({ state: 'HANDSHAKING', connected: false });
  T.equal(countHello(link), 1, '同一轮 HANDSHAKING 只握手一次');

  // 断开 → CONNECTING，再连上进入 HANDSHAKING 应重新握手
  link.emitStatus({ state: 'CONNECTING', connected: false });
  link.emitStatus({ state: 'HANDSHAKING', connected: false });
  T.equal(countHello(link), 2, '断开重连后重新握手');
});

if (require.main === module) {
  T.summary('rpc.test.js');
}
