/**
 * interconnect.js —— 连接封装（Vela `system.interconnect` 适配层）
 *
 * 对齐设计文档 §3.1 / §3.2 / F1–F5：
 *   - `interconnect.instance()` 返回单例连接对象
 *   - 监听 `onopen/onclose/onerror/onmessage`
 *   - `getReadyState({success,fail})`：status 1=已连 / 2=未连；fail.code 1006=已断开
 *   - **进入页面直接取状态常得到 DISCONNECTED，须轮询（F3）**
 *   - 发送 `c.send({data, success, fail})`；`data` 为 **String**（待验证 V1）
 *
 * 对 Vela 专有 API 的访问全部经由**注入式适配器**（`opts.adapter`），
 * 便于 Node 单测时替换为桩；默认适配器惰性 require `@system.interconnect`。
 *
 * @module interconnect
 */
'use strict';

/** readyState status */
var READY = 1;
var NOT_READY = 2;

/** 连接状态机取值（§3.2） */
var STATE = { BOOT: 'BOOT', CONNECTING: 'CONNECTING', HANDSHAKING: 'HANDSHAKING', READY: 'READY' };

/* -------------------------------------------------------------------------- */
/* 纯逻辑：退避 & 状态机                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 连接失败退避：1s → 2s → 4s，上限 8s（§3.2）。
 * @param {number} attempt 0-based
 * @returns {number} 毫秒
 */
function backoffDelay(attempt) {
  var a = Math.max(0, Math.floor(attempt || 0));
  var d = 1000 * Math.pow(2, a);
  return Math.min(d, 8000);
}

/**
 * 手环端连接状态机（纯逻辑，便于单测）。
 * @constructor
 */
function ConnectionFsm() {
  this.state = STATE.BOOT;
  this.reconnects = 0;
}

/**
 * 状态迁移。返回是否发生合法迁移。
 * @param {string} event 'connect'|'open'|'helloAck'|'helloTimeout'|'close'|'error'
 * @returns {string} 迁移后的状态
 */
ConnectionFsm.prototype.transition = function transition(event) {
  var s = this.state;
  if (event === 'connect') {
    if (s === STATE.BOOT || s === STATE.CONNECTING || s === STATE.READY) {
      this.state = STATE.CONNECTING;
    }
  } else if (event === 'open') {
    this.state = STATE.HANDSHAKING;
  } else if (event === 'helloAck') {
    if (s === STATE.HANDSHAKING) {
      this.state = STATE.READY;
    }
  } else if (event === 'helloTimeout' || event === 'close' || event === 'error') {
    if (event === 'close' || event === 'error') {
      this.reconnects++;
    }
    this.state = STATE.CONNECTING;
  }
  return this.state;
};

/* -------------------------------------------------------------------------- */
/* 默认适配器（Vela）                                                           */
/* -------------------------------------------------------------------------- */

/**
 * 默认适配器：惰性加载 Vela `@system.interconnect`。
 * 在 Node 环境 require 失败时返回一个会抛错的桩，避免模块加载即崩。
 * @returns {{instance: function():object}}
 */
function defaultAdapter() {
  var mod = null;
  try {
    // eslint-disable-next-line global-require
    mod = require('@system.interconnect');
  } catch (e) {
    mod = null;
  }
  return {
    available: !!mod,
    instance: function instance() {
      if (!mod || typeof mod.instance !== 'function') {
        throw new Error('@system.interconnect unavailable (inject an adapter for tests)');
      }
      return mod.instance();
    }
  };
}

/* -------------------------------------------------------------------------- */
/* 连接门面                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 创建连接门面。
 *
 * @param {object} [opts]
 * @param {object} [opts.adapter] 注入式适配器（默认 Vela 适配器）
 * @param {number} [opts.pollIntervalMs=2000] readyState 轮询间隔（F3）
 * @param {function} [opts.setTimeoutFn] 注入定时器（测试用）
 * @param {function} [opts.clearTimeoutFn]
 * @param {boolean} [opts.sendAsObject=false] 发送时 data 传对象（待验证 V1 的备选）
 * @param {function} [opts.onLog]
 * @returns {object} link
 */
function createLink(opts) {
  opts = opts || {};
  var adapter = opts.adapter || defaultAdapter();
  var pollIntervalMs = opts.pollIntervalMs || 2000;
  var setT = opts.setTimeoutFn || (typeof setTimeout !== 'undefined' ? setTimeout : null);
  var clearT = opts.clearTimeoutFn || (typeof clearTimeout !== 'undefined' ? clearTimeout : null);
  var sendAsObject = !!opts.sendAsObject;
  var log = opts.onLog || function () {};

  var conn = null;
  var pollTimer = null;
  var fsm = new ConnectionFsm();
  var messageHandlers = [];
  var statusHandlers = [];
  var started = false;
  var lastErrCode = 0;

  function emitStatus() {
    var info = {
      state: fsm.state,
      connected: fsm.state === STATE.READY,
      reconnects: fsm.reconnects,
      errCode: lastErrCode
    };
    statusHandlers.forEach(function (h) { safeCall(h, info); });
  }

  function safeCall(fn, arg) {
    try {
      fn(arg);
    } catch (e) {
      log('handler error: ' + e.message);
    }
  }

  function bind(instance) {
    instance.onopen = function (res) {
      log('onopen reconnected=' + (res && res.isReconnected));
      fsm.transition('open');
      emitStatus();
    };
    instance.onclose = function () {
      log('onclose');
      fsm.transition('close');
      emitStatus();
    };
    instance.onerror = function (err) {
      log('onerror code=' + (err && err.code));
      lastErrCode = (err && err.code) || 0;
      fsm.transition('error');
      emitStatus();
    };
    instance.onmessage = function (res) {
      var data = res && res.data;
      var text = typeof data === 'string' ? data : JSON.stringify(data);
      // 【权威连通证据】能收到手机端数据，说明链路已通。
      // 部分机型/固件 getReadyState 长期返回 2（官方论坛亦提到「进入页面直接取状态
      // 往往是 DISCONNECTED」），只信轮询会永远显示「未连」。以收包作为最高优先级信号。
      if (fsm.state !== STATE.READY) {
        fsm.state = STATE.READY;
        emitStatus();
      }
      messageHandlers.forEach(function (h) { safeCall(h, text); });
    };
  }

  function doPoll() {
    if (!conn || typeof conn.getReadyState !== 'function') {
      return;
    }
    conn.getReadyState({
      success: function (res) {
        if (res && res.status === READY) {
          if (fsm.state === STATE.CONNECTING || fsm.state === STATE.BOOT) {
            fsm.transition('open');
            emitStatus();
          }
        } else {
          if (fsm.state === STATE.READY) {
            fsm.transition('close');
            emitStatus();
          }
        }
      },
      fail: function () {
        if (fsm.state === STATE.READY) {
          fsm.transition('close');
          emitStatus();
        }
      }
    });
  }

  function schedulePoll() {
    if (!setT) {
      return;
    }
    pollTimer = setT(function loop() {
      doPoll();
      if (started) {
        schedulePoll();
      }
    }, pollIntervalMs);
  }

  var link = {
    fsm: fsm,

    /**
     * 启动：取单例连接、绑定事件、开始轮询。
     * @returns {boolean} 是否成功取得连接实例
     */
    start: function start() {
      if (started) {
        return true;
      }
      fsm.transition('connect');
      emitStatus();
      try {
        conn = adapter.instance();
      } catch (e) {
        log('instance() failed: ' + e.message);
        return false;
      }
      bind(conn);
      started = true;
      schedulePoll();
      return true;
    },

    /**
     * 停止轮询。
     */
    stop: function stop() {
      started = false;
      if (pollTimer && clearT) {
        clearT(pollTimer);
        pollTimer = null;
      }
    },

    /**
     * 注册消息回调（收到的是原始字符串）。
     * @param {function(string):void} handler
     */
    onMessage: function onMessage(handler) {
      messageHandlers.push(handler);
    },

    /**
     * 注册状态回调。
     * @param {function(object):void} handler
     */
    onStatus: function onStatus(handler) {
      statusHandlers.push(handler);
    },

    /**
     * 发送一条已序列化字符串。回调 {ok, error?}。
     * @param {string} text
     * @param {function(object):void} [cb]
     */
    send: function send(text, cb) {
      if (!conn || typeof conn.send !== 'function') {
        if (cb) { cb({ ok: false, error: 'E_LINK' }); }
        return;
      }
      conn.send({
        data: sendAsObject ? text : String(text),
        success: function () {
          // 发送成功同样是链路可用的权威证据（见 onmessage 注释）
          if (fsm.state !== STATE.READY) {
            fsm.state = STATE.READY;
            emitStatus();
          }
          if (cb) { cb({ ok: true }); }
        },
        fail: function (err) { if (cb) { cb({ ok: false, error: 'E_LINK', detail: err }); } }
      });
    },

    /**
     * 查询一次连接状态（异步）。
     * @param {function(object):void} cb
     */
    readyState: function readyState(cb) {
      if (!conn || typeof conn.getReadyState !== 'function') {
        cb({ ok: false, status: NOT_READY });
        return;
      }
      conn.getReadyState({
        success: function (res) { cb({ ok: true, status: res.status }); },
        fail: function (err) { cb({ ok: false, status: NOT_READY, code: err && err.code }); }
      });
    },

    /**
     * 诊断能力（§3.1）。
     * @param {function(object):void} cb
     * @param {number} [timeout]
     */
    diagnosis: function diagnosis(cb, timeout) {
      if (!conn || typeof conn.diagnosis !== 'function') {
        cb({ ok: false, code: -1 });
        return;
      }
      conn.diagnosis({
        timeout: timeout || 10000,
        success: function (res) { cb({ ok: true, code: res && res.code }); },
        fail: function (err) { cb({ ok: false, code: err && err.code }); }
      });
    },

    /** @returns {string} 当前状态机状态 */
    getState: function getState() {
      return fsm.state;
    },

    /** @returns {object} 底层连接对象（测试用） */
    getConn: function getConn() {
      return conn;
    }
  };

  return link;
}

module.exports = {
  READY: READY,
  NOT_READY: NOT_READY,
  STATE: STATE,
  backoffDelay: backoffDelay,
  ConnectionFsm: ConnectionFsm,
  defaultAdapter: defaultAdapter,
  createLink: createLink
};
