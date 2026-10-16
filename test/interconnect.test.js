/**
 * interconnect.test.js —— 连接封装（注入式适配器）单元测试
 * 运行： node test/interconnect.test.js
 */
'use strict';

var T = require('./tinytest.js');
var I = require('../src/utils/interconnect.js');

/** 伪连接对象（桩），模拟 Vela system.interconnect 的 instance() */
function fakeConn() {
  return {
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    sent: [],
    send: function (o) {
      this.sent.push(o.data);
      if (o.success) { o.success(); }
    },
    getReadyState: function (o) { o.success({ status: 1 }); },
    diagnosis: function (o) { o.success({ code: 0 }); }
  };
}

/** 不真正调度定时器的定时器桩 */
var noopTimer = function () { return 0; };
var noopClear = function () {};

T.test('退避：1s→2s→4s→8s（上限 8s）', function () {
  T.equal(I.backoffDelay(0), 1000);
  T.equal(I.backoffDelay(1), 2000);
  T.equal(I.backoffDelay(2), 4000);
  T.equal(I.backoffDelay(3), 8000);
  T.equal(I.backoffDelay(9), 8000, 'capped at 8s');
});

T.test('状态机迁移（§3.2）', function () {
  var fsm = new I.ConnectionFsm();
  T.equal(fsm.state, 'BOOT');
  T.equal(fsm.transition('connect'), 'CONNECTING');
  T.equal(fsm.transition('open'), 'HANDSHAKING');
  T.equal(fsm.transition('helloAck'), 'READY');
  T.equal(fsm.transition('close'), 'CONNECTING');
  T.equal(fsm.reconnects, 1);
});

T.test('createLink 启动并取得实例、绑定回调', function () {
  var conn = fakeConn();
  var link = I.createLink({
    adapter: { instance: function () { return conn; } },
    setTimeoutFn: noopTimer,
    clearTimeoutFn: noopClear
  });
  T.ok(link.start(), 'start ok');
  T.ok(typeof conn.onmessage === 'function', 'onmessage bound');
  T.equal(link.getState(), 'CONNECTING');
});

T.test('onopen → HANDSHAKING 并回调状态', function () {
  var conn = fakeConn();
  var link = I.createLink({
    adapter: { instance: function () { return conn; } },
    setTimeoutFn: noopTimer,
    clearTimeoutFn: noopClear
  });
  var states = [];
  link.onStatus(function (info) { states.push(info.state); });
  link.start();
  conn.onopen({ isReconnected: false });
  T.equal(link.getState(), 'HANDSHAKING');
  T.ok(states.indexOf('HANDSHAKING') !== -1);
});

T.test('send 传字符串（V1 默认），onmessage 收到文本', function () {
  var conn = fakeConn();
  var link = I.createLink({
    adapter: { instance: function () { return conn; } },
    setTimeoutFn: noopTimer,
    clearTimeoutFn: noopClear
  });
  var got = [];
  link.onMessage(function (text) { got.push(text); });
  link.start();

  var okCalled = false;
  link.send('{"v":1}', function (r) { okCalled = r.ok; });
  T.equal(conn.sent[0], '{"v":1}');
  T.ok(okCalled, 'success callback fired');

  var env = { v: 1, id: 'p-1-0001', type: 'evt', event: 'player.song', payload: {} };
  conn.onmessage({ data: JSON.stringify(env) });
  T.equal(JSON.parse(got[0]), env);
});

T.test('send 在无连接时返回 E_LINK', function () {
  var link = I.createLink({
    adapter: { instance: function () { throw new Error('no device'); } },
    setTimeoutFn: noopTimer,
    clearTimeoutFn: noopClear
  });
  T.ok(!link.start(), 'start failed without instance');
  var res = null;
  link.send('x', function (r) { res = r; });
  T.ok(res && !res.ok && res.error === 'E_LINK');
});

T.test('readyState 查询透传 status', function () {
  var conn = fakeConn();
  var link = I.createLink({
    adapter: { instance: function () { return conn; } },
    setTimeoutFn: noopTimer,
    clearTimeoutFn: noopClear
  });
  link.start();
  var out = null;
  link.readyState(function (r) { out = r; });
  T.ok(out.ok);
  T.equal(out.status, I.READY);
});

if (require.main === module) {
  T.summary('interconnect.test.js');
}
