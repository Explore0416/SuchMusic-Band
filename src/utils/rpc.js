/**
 * rpc.js —— 信封编解码 + 请求/响应/事件 + 超时重试 + 能力门控 + 分片派发
 *
 * 对齐设计文档 §3.4 / §3.5 / §3.6 / §3.11：
 *   - 统一信封 `{v,id,type,method|event,payload,ts}`
 *   - 请求超时 `reqTimeoutMs = 3000`；超时/E_LINK 时**同 id** 重试 ≤2 次，退避 300ms/900ms
 *   - `E_UNSUPPORTED`/`E_BADREQ` 不重试
 *   - 保活 `sys.ping` 每 10s；`state.get` 兜底重同步每 15s
 *   - 能力门控：缺失能力时**手环不发**该请求
 *   - 大载荷经 header→data→end 分片（transfer 组装 + CRC + xfer.nack）
 *
 * 依赖通过注入：`link`（interconnect 门面）、`state`、`store`、定时器。
 *
 * @module rpc
 */
'use strict';

var protocol = require('./protocol.js');
var transfer = require('./transfer.js');
var stateMod = require('./state.js');

/** 手环侧声明的能力（§3.3 握手示例 + cover；volume 为 Phase 2 暂不请求） */
var BAND_CAPS = ['playback', 'queue', 'search', 'lyric', 'playmode', 'cover', 'transfer'];

/** 常量（§3.11） */
var REQ_TIMEOUT_MS = 3000;
var MAX_RETRY = 2;
var RETRY_BACKOFF = [300, 900];
var PING_INTERVAL_MS = 10000;
var RESYNC_INTERVAL_MS = 15000;

/**
 * @param {object} opts
 * @param {object} opts.link      interconnect 门面（createLink 的返回值）
 * @param {object} [opts.state]   state 模块（默认单例）
 * @param {object} [opts.store]   store 单例（可选）
 * @param {object} [opts.timers]  {setTimeout, clearTimeout}
 * @param {string} [opts.origin='b']
 * @param {function():number} [opts.now]
 * @param {function(string)} [opts.onLog]
 * @returns {object} rpc
 */
function createRpc(opts) {
  opts = opts || {};
  var link = opts.link;
  var state = opts.state || stateMod;
  var store = opts.store || null;
  var timers = opts.timers || {
    setTimeout: (typeof setTimeout !== 'undefined' ? setTimeout : null),
    clearTimeout: (typeof clearTimeout !== 'undefined' ? clearTimeout : null)
  };
  var origin = opts.origin || 'b';
  var now = opts.now || function () { return Date.now(); };
  var log = opts.onLog || function () {};

  var bootId = protocol.genBootId();
  var seq = 0;
  var sessionV = protocol.PROTO_VERSION;
  var activeCaps = [];
  var ready = false;

  var pending = {};            // id -> { cb, timer, method, attempt }
  var chunkWaiters = {};       // tid -> { cb }
  var assemblers = {};         // tid -> ChunkAssembler
  var eventListeners = [];
  var handshakeCb = null;
  var pingTimer = null;
  var resyncTimer = null;
  var handshaking = false;     // 本轮 HANDSHAKING 是否已发起握手（防止重复）

  function nextId() {
    seq = (seq + 1) & 0xffff;
    return protocol.makeId(origin, bootId, seq);
  }

  function envelope(type, extra) {
    var env = { v: sessionV, id: nextId(), type: type, payload: {}, ts: now() };
    if (extra) {
      Object.keys(extra).forEach(function (k) { env[k] = extra[k]; });
    }
    return env;
  }

  function sendEnvelope(env, cb) {
    var text;
    try {
      text = protocol.encodeEnvelope(env);
    } catch (e) {
      if (cb) { cb({ ok: false, error: 'E_BADREQ', message: e.message }); }
      return;
    }
    link.send(text, cb || function () {});
  }

  function hasCap(cap) {
    return !cap || activeCaps.indexOf(cap) !== -1;
  }

  /* ------------------------------------------------------------------ */
  /* 请求                                                               */
  /* ------------------------------------------------------------------ */

  function request(method, payload, cb) {
    cb = cb || function () {};
    if (!protocol.hasMethod(method)) {
      cb({ ok: false, error: 'E_BADREQ', message: 'unknown method ' + method });
      return;
    }
    var cap = protocol.methodCap(method);
    if (!hasCap(cap)) {
      cb({ ok: false, error: 'E_UNSUPPORTED', missing: cap });
      return;
    }
    var id = nextId();
    var env = { v: sessionV, id: id, type: 'req', method: method, payload: payload || {}, ts: now() };
    pending[id] = { cb: cb, method: method, attempt: 0, timer: null };
    dispatch(env, id, 0);
  }

  function dispatch(env, id, attempt) {
    var text;
    try {
      text = protocol.encodeEnvelope(env);
    } catch (e) {
      finish(id, { ok: false, error: 'E_BADREQ', message: e.message });
      return;
    }
    var p = pending[id];
    if (!p) { return; }
    if (timers.setTimeout) {
      p.timer = timers.setTimeout(function () { onTimeout(env, id, attempt); }, REQ_TIMEOUT_MS);
    }
    link.send(text, function (res) {
      if (!res || !res.ok) {
        onLinkFail(env, id, attempt);
      }
    });
  }

  function onTimeout(env, id, attempt) {
    if (attempt < MAX_RETRY) {
      retry(env, id, attempt);
    } else {
      finish(id, { ok: false, error: 'E_TIMEOUT' });
    }
  }

  function onLinkFail(env, id, attempt) {
    if (attempt < MAX_RETRY) {
      retry(env, id, attempt);
    } else {
      finish(id, { ok: false, error: 'E_LINK' });
    }
  }

  function retry(env, id, attempt) {
    var p = pending[id];
    if (!p) { return; }
    if (p.timer && timers.clearTimeout) {
      timers.clearTimeout(p.timer);
      p.timer = null;
    }
    var delay = RETRY_BACKOFF[Math.min(attempt, RETRY_BACKOFF.length - 1)];
    if (timers.setTimeout) {
      timers.setTimeout(function () { dispatch(env, id, attempt + 1); }, delay);
    } else {
      dispatch(env, id, attempt + 1);
    }
  }

  function finish(id, result) {
    var p = pending[id];
    if (!p) { return; }
    if (p.timer && timers.clearTimeout) {
      timers.clearTimeout(p.timer);
    }
    delete pending[id];
    p.cb(result);
  }

  /* ------------------------------------------------------------------ */
  /* 接收分发                                                            */
  /* ------------------------------------------------------------------ */

  function onRawMessage(text) {
    var dec = protocol.decodeEnvelope(text);
    if (!dec.ok) {
      log('drop bad envelope: ' + dec.message);
      return;
    }
    var env = dec.value;
    if (env.type === protocol.TYPES.RES || env.type === protocol.TYPES.ERR) {
      onResponse(env);
    } else if (env.type === protocol.TYPES.EVT) {
      onEvent(env);
    } else if (env.type === protocol.TYPES.REQ) {
      onIncomingReq(env);
    }
  }

  function onResponse(env) {
    var payload = env.payload || {};
    if (env.type === protocol.TYPES.ERR) {
      finish(env.id, { ok: false, error: payload.code || 'E_INTERNAL', message: payload.message, missing: payload.missing });
      return;
    }
    if (payload && payload.__chunked) {
      chunkWaiters[payload.tid] = { cb: (pending[env.id] || {}).cb, id: env.id };
      // 保持请求 pending，等分片组装完成后再 resolve
      var p = pending[env.id];
      if (p && p.timer && timers.clearTimeout) {
        timers.clearTimeout(p.timer);
        p.timer = null;
      }
      return;
    }
    finish(env.id, { ok: true, payload: payload });
  }

  function onEvent(env) {
    var name = env.event;
    var payload = env.payload || {};

    if (name === 'sys.hello_ack') {
      onHelloAck(payload);
    }
    if (name === 'xfer.chunk') {
      onChunk(payload);
    }
    if (name === 'player.mode' && store) {
      store.setLastMode(payload.mode);
    }
    // 手机端在节点就绪后主动推送链路状态（对齐官方示例的 pushConnectionState）。
    // 收到 ready=true 即视为链路可用——这是比 getReadyState 更可靠的证据。
    if (name === 'link.state') {
      if (payload.ready) {
        state.set({ link: 'ready' });
      }
    }
    state.applyEvent(name, payload);
    eventListeners.forEach(function (h) {
      try { h(name, payload); } catch (e) { log('listener error ' + e.message); }
    });
  }

  function onIncomingReq(env) {
    var payload = env.payload || {};
    if (env.method === 'sys.ping') {
      var res = { v: sessionV, id: env.id, type: protocol.TYPES.RES, payload: { t: payload.t || now() } };
      sendEnvelope(res);
      return;
    }
    var err = {
      v: sessionV,
      id: env.id,
      type: protocol.TYPES.ERR,
      payload: { code: 'E_UNSUPPORTED', message: 'band does not serve ' + env.method }
    };
    sendEnvelope(err);
  }

  /* ------------------------------------------------------------------ */
  /* 分片接收                                                            */
  /* ------------------------------------------------------------------ */

  function onChunk(payload) {
    var tid = payload.tid;
    if (!tid) { return; }
    if (payload.phase === 'header') {
      var asm = new transfer.ChunkAssembler({ maxBytes: transfer.ASSEMBLE_MAX_BYTES });
      var r = asm.onHeader(payload);
      if (!r.ok) {
        assemblers[tid] = null;
        failChunk(tid, r.error);
        return;
      }
      assemblers[tid] = asm;
      return;
    }
    var a = assemblers[tid];
    if (!a) { return; }
    if (payload.phase === 'data') {
      a.onData(payload);
      return;
    }
    if (payload.phase === 'end') {
      var res = a.onEnd(payload);
      if (res.ok) {
        resolveChunk(tid, res.data);
      } else {
        // 缺片/校验失败 → xfer.nack 只重发缺失
        var missing = res.missing || a.missingSeqs();
        transfer.buildNack(tid, missing).forEach(function (nack) {
          request('xfer.nack', nack, function () {});
        });
        if (res.error === 'E_CRC' && missing.length === 0) {
          // 整包 CRC 失败且无缺失序号 → 无法定位，直接失败
          failChunk(tid, 'E_CRC');
        }
      }
    }
  }

  function resolveChunk(tid, data) {
    var w = chunkWaiters[tid];
    delete chunkWaiters[tid];
    delete assemblers[tid];
    var payload = data;
    if (!data.binary && typeof data.text === 'string') {
      try {
        payload = JSON.parse(data.text);
      } catch (e) {
        payload = { raw: data.text };
      }
    }
    if (w) {
      if (w.id) { delete pending[w.id]; }
      if (w.cb) { w.cb({ ok: true, payload: payload, chunked: true }); }
    }
    eventListeners.forEach(function (h) {
      try { h('xfer.assembled', { tid: tid, payload: payload, kind: data.kind }); } catch (e) { /* noop */ }
    });
  }

  function failChunk(tid, error) {
    var w = chunkWaiters[tid];
    delete chunkWaiters[tid];
    delete assemblers[tid];
    if (w) {
      if (w.id) { delete pending[w.id]; }
      if (w.cb) { w.cb({ ok: false, error: error || 'E_CRC' }); }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 握手与保活                                                          */
  /* ------------------------------------------------------------------ */

  function handshake(cb) {
    handshakeCb = cb || null;
    var env = {
      v: protocol.PROTO_VERSION,
      id: nextId(),
      type: protocol.TYPES.REQ,
      method: 'sys.hello',
      payload: {
        role: 'band',
        proto: protocol.PROTO_VERSIONS,
        caps: BAND_CAPS,
        fw: 'vela',
        model: 'Mi Band 10',
        rpk: 'com.lightningteam.suchmusic@1.0.0'
      },
      ts: now()
    };
    pending[env.id] = { cb: function () {}, method: 'sys.hello', attempt: 0, timer: null };
    dispatch(env, env.id, 0);
    // 3s 握手超时（§3.2）
    if (timers.setTimeout) {
      timers.setTimeout(function () {
        if (!ready && handshakeCb) {
          var cbLocal = handshakeCb;
          handshakeCb = null;
          cbLocal({ ok: false, error: 'E_TIMEOUT' });
        }
      }, 3000);
    }
  }

  function onHelloAck(payload) {
    var v = protocol.negotiateVersion(protocol.PROTO_VERSIONS, payload.proto || []);
    if (v === null) {
      state.applyEvent('sys.error', { code: 'E_PROTO', message: 'no common protocol' });
      if (handshakeCb) { var c = handshakeCb; handshakeCb = null; c({ ok: false, error: 'E_PROTO' }); }
      return;
    }
    sessionV = v;
    activeCaps = protocol.negotiateCaps(BAND_CAPS, payload.caps || []);
    ready = true;
    // 【修复·同源缺陷】握手成功即推动连接状态机完成 open 阶段：
    // helloAck → READY（冻结基线，仅在 interconnect 已实现、此处按约定触发）。
    // 否则 FSM 会永远停在 HANDSHAKING，READY/connected 恒为假，且 readyState
    // 轮询的断连检测（仅 READY 时才迁移 close）将失效。
    if (link && link.fsm && typeof link.fsm.transition === 'function') {
      link.fsm.transition('helloAck');
    }
    if (store) {
      store.setProtoVer(v);
      store.setServerCaps(activeCaps);
    }
    if (handshakeCb) { var c2 = handshakeCb; handshakeCb = null; c2({ ok: true, v: v, caps: activeCaps }); }
  }

  function startPing() {
    if (!timers.setTimeout || pingTimer) { return; }
    pingTimer = timers.setTimeout(function loop() {
      if (ready) { request('sys.ping', {}, function () {}); }
      pingTimer = timers.setTimeout(loop, PING_INTERVAL_MS);
    }, PING_INTERVAL_MS);
  }

  function startResync() {
    if (!timers.setTimeout || resyncTimer) { return; }
    resyncTimer = timers.setTimeout(function loop() {
      if (ready) { stateGet(function () {}); }
      resyncTimer = timers.setTimeout(loop, RESYNC_INTERVAL_MS);
    }, RESYNC_INTERVAL_MS);
  }

  /* ------------------------------------------------------------------ */
  /* 高层命令（§3.5）                                                     */
  /* ------------------------------------------------------------------ */

  function stateGet(cb) {
    request('state.get', {}, function (r) {
      if (r.ok) { state.applySnapshot(r.payload); }
      if (cb) { cb(r); }
    });
  }

  function play(cb) { request('playback.play', {}, cb); }
  function pause(cb) { request('playback.pause', {}, cb); }
  function toggle(cb) { request('playback.toggle', {}, cb); }
  function next(cb) { request('playback.next', {}, cb); }
  function prev(cb) { request('playback.prev', {}, cb); }
  function seek(positionMs, cb) { request('playback.seek', { positionMs: positionMs }, cb); }
  function setMode(mode, cb) { request('playback.setMode', { mode: mode }, cb); }
  function setVolume(volume, cb) { request('playback.setVolume', { volume: volume }, cb); }
  function queuePlay(index, cb) { request('queue.play', { index: index }, cb); }
  function queueClear(cb) { request('queue.clear', {}, cb); }
  function searchSong(keyword, limit, cb) { request('search.song', { keyword: keyword, limit: limit || 10 }, cb); }
  function searchSuggest(keyword, limit, cb) { request('search.suggest', { keyword: keyword, limit: limit || 6 }, cb); }
  function searchHot(cb) { request('search.hot', {}, cb); }
  function lyricWindow(songId, index, before, after, cb) {
    request('lyric.window', {
      songId: songId,
      index: index,
      before: before === undefined ? 3 : before,
      after: after === undefined ? 8 : after
    }, cb);
  }
  function songInfo(cb) { request('song.info', {}, cb); }
  function coverGet(songId, size, cb) { request('cover.get', { songId: songId, size: size || 96 }, cb); }

  /* ------------------------------------------------------------------ */
  /* 生命周期                                                            */
  /* ------------------------------------------------------------------ */

  function attach() {
    link.onMessage(onRawMessage);
    link.onStatus(function (info) {
      info = info || {};
      var st = info.state;
      // 【修复·自引用死锁】握手触发时机应为「物理链路连上」，即状态机进入
      // HANDSHAKING（open → HANDSHAKING），而**不是** READY —— 因为按照冻结的
      // 协议基线，READY 只能由**握手成功**（sys.hello_ack）产生；若在此等待
      // READY，则握手要等 READY、READY 又只能由握手产生，永远无法触发。
      // 进入 HANDSHAKING（或对端已 READY/connected）即发起 sys.hello。
      if (st === 'HANDSHAKING' || st === 'READY' || info.connected) {
        if (!handshaking) {
          handshaking = true;
          ready = false;
          state.set({ link: 'handshaking' });
          handshake(function () { stateGet(function () {}); });
          startPing();
          startResync();
        }
      } else {
        // BOOT / CONNECTING：断开或重连中，允许下一轮 HANDSHAKING 重新握手
        handshaking = false;
        ready = false;
        // 官方错误码 1001 = 手机 APP 未安装（interconnect 文档）；据此给出精确提示
        if (info.errCode === 1001) {
          state.set({ link: 'appMissing' });
        } else {
          state.set({ link: 'connecting' });
        }
      }
    });
    state.set({ link: link.getState ? link.getState() : 'connecting' });
  }

  function onEventRegister(handler) {
    eventListeners.push(handler);
    return function () {
      var i = eventListeners.indexOf(handler);
      if (i !== -1) { eventListeners.splice(i, 1); }
    };
  }

  return {
    BAND_CAPS: BAND_CAPS,
    REQ_TIMEOUT_MS: REQ_TIMEOUT_MS,
    attach: attach,
    onEvent: onEventRegister,
    handshake: handshake,
    request: request,
    // 高层命令
    stateGet: stateGet,
    play: play,
    pause: pause,
    toggle: toggle,
    next: next,
    prev: prev,
    seek: seek,
    setMode: setMode,
    setVolume: setVolume,
    queuePlay: queuePlay,
    queueClear: queueClear,
    searchSong: searchSong,
    searchSuggest: searchSuggest,
    searchHot: searchHot,
    lyricWindow: lyricWindow,
    songInfo: songInfo,
    coverGet: coverGet,
    // 测试/诊断
    _onRawMessage: onRawMessage,
    getSessionVersion: function () { return sessionV; },
    getActiveCaps: function () { return activeCaps.slice(); },
    isReady: function () { return ready; },
    pendingCount: function () { return Object.keys(pending).length; }
  };
}

/* ---------------------------------------------------------------------- */
/* 单例（供 Vela 页面共享同一个 rpc）                                        */
/* ---------------------------------------------------------------------- */

var _singleton = null;

/**
 * 初始化单例。
 * @param {object} opts
 * @returns {object}
 */
function initRpc(opts) {
  _singleton = createRpc(opts);
  return _singleton;
}

/**
 * 取单例。
 * @returns {object|null}
 */
function getRpc() {
  return _singleton;
}

module.exports = {
  BAND_CAPS: BAND_CAPS,
  REQ_TIMEOUT_MS: REQ_TIMEOUT_MS,
  MAX_RETRY: MAX_RETRY,
  RETRY_BACKOFF: RETRY_BACKOFF,
  PING_INTERVAL_MS: PING_INTERVAL_MS,
  RESYNC_INTERVAL_MS: RESYNC_INTERVAL_MS,
  createRpc: createRpc,
  initRpc: initRpc,
  getRpc: getRpc
};
