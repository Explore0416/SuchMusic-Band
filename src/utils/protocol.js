/**
 * protocol.js —— SuchMusic 跨端统一协议（手环侧纯逻辑实现）
 *
 * 严格对齐设计文档 docs/ARCH-手环通信.md §3 与附录 D：
 *   - 统一信封 {v,id,type,method|event,payload,ts}
 *   - 方法清单（§3.5）/ 事件清单（§3.6）/ 错误码（§3.7）/ 能力令牌（§3.3）
 *   - 版本协商、能力协商（§3.3）
 *
 * 本模块**不依赖任何 Vela / Node 运行时专有 API**，可被 `node` 直接 require，
 * 也可被 Vela 快应用打包器以 CommonJS 方式引入。
 *
 * 字段名 / 消息名 / 事件名均来自设计文档，**已冻结，禁止改动**。
 *
 * @module protocol
 */
'use strict';

/** 协议主版本（会话内固定为协商值） */
var PROTO_VERSION = 1;

/** 本端支持的协议版本集合（用于版本协商取交集） */
var PROTO_VERSIONS = [1];

/** 信封类型 */
var TYPES = { REQ: 'req', RES: 'res', EVT: 'evt', ERR: 'err' };
var TYPE_LIST = ['req', 'res', 'evt', 'err'];

/** 能力令牌（§3.3，最终值） */
var CAPS = ['playback', 'queue', 'search', 'lyric', 'playmode', 'volume', 'cover', 'transfer'];

/** 事件清单（§3.6，14 个，最终值） */
var EVENTS = [
  'sys.hello_ack',
  'sys.error',
  'player.state',
  'player.song',
  'player.progress',
  'player.mode',
  'player.volume',
  'player.queue',
  'lyric.line',
  'lyric.meta',
  'search.result',
  'search.preset',
  'xfer.chunk',
  'band.toast'
];

/** 方法 → 所需能力（§3.5；null 表示无能力要求，与方法存在性区分见 methodCap） */
var METHOD_CAP = {
  'sys.hello': null,
  'sys.ping': null,
  'state.get': null,
  'playback.play': 'playback',
  'playback.pause': 'playback',
  'playback.toggle': 'playback',
  'playback.next': 'playback',
  'playback.prev': 'playback',
  'playback.seek': 'playback',
  'playback.setMode': 'playmode',
  'playback.setVolume': 'volume',
  'queue.play': 'queue',
  'queue.clear': 'queue',
  'search.song': 'search',
  'search.suggest': 'search',
  'search.hot': 'search',
  'lyric.window': 'lyric',
  'song.info': null,
  'cover.get': 'cover',
  'xfer.nack': 'transfer'
};

/** 方法清单（§3.5） */
var METHODS = Object.keys(METHOD_CAP);

/** 错误码（§3.7，冻结） */
var ERROR_CODES = [
  'E_BADREQ',
  'E_UNSUPPORTED',
  'E_TIMEOUT',
  'E_NOT_READY',
  'E_EMPTY',
  'E_NOT_FOUND',
  'E_LINK',
  'E_TOOLARGE',
  'E_CRC',
  'E_INTERNAL',
  // §3.3 版本/能力协商补充码
  'E_PROTO',
  'E_CAP'
];

/** 播放状态（§3.5.1，映射 PlayerState） */
var PLAYER_STATES = ['idle', 'loading', 'playing', 'paused', 'error'];

/** 音源 code（§3.5.1 / 附录 D） */
var SONG_SOURCES = ['netease', 'kugou', 'kugou_std', 'local'];

/** 分片 kind（§3.8） */
var CHUNK_KINDS = ['lyric_window', 'search_result', 'cover'];

/** id origin（附录 D） */
var ORIGINS = ['b', 'p', 'w'];

/**
 * 判断方法名是否存在。
 * @param {string} method
 * @returns {boolean}
 */
function hasMethod(method) {
  return typeof method === 'string' &&
    Object.prototype.hasOwnProperty.call(METHOD_CAP, method);
}

/**
 * 返回方法所需能力；方法不存在返回 undefined；无能力要求返回 null。
 * @param {string} method
 * @returns {string|null|undefined}
 */
function methodCap(method) {
  if (!hasMethod(method)) {
    return undefined;
  }
  return METHOD_CAP[method];
}

/**
 * @param {string} event
 * @returns {boolean}
 */
function isEvent(event) {
  return typeof event === 'string' && EVENTS.indexOf(event) !== -1;
}

/**
 * @param {string} code
 * @returns {boolean}
 */
function isErrorCode(code) {
  return typeof code === 'string' && ERROR_CODES.indexOf(code) !== -1;
}

/**
 * 生成 4 位 hex 的 bootId（各端随机）。
 * @param {function():number} [rand] 可注入随机源，默认 Math.random
 * @returns {string}
 */
function genBootId(rand) {
  var r = typeof rand === 'function' ? rand : Math.random;
  var n = Math.floor(r() * 0x10000) & 0xffff;
  return pad4(n);
}

/**
 * 4 位小写 hex 补零。
 * @param {number} n
 * @returns {string}
 */
function pad4(n) {
  var v = (n >>> 0) & 0xffff;
  var s = v.toString(16);
  while (s.length < 4) {
    s = '0' + s;
  }
  return s;
}

/**
 * 构造消息 id：`{origin}-{bootId}-{seq}`（§3.4）。
 * @param {string} origin 'b' | 'p' | 'w'
 * @param {string} bootId 4 位 hex
 * @param {number} seq 递增序号
 * @returns {string}
 */
function makeId(origin, bootId, seq) {
  return String(origin) + '-' + String(bootId) + '-' + pad4(seq);
}

/**
 * 校验信封结构（§3.4）。不做业务语义校验。
 * @param {object} env
 * @returns {{ok:boolean, errors:string[]}}
 */
function validateEnvelope(env) {
  var errors = [];
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    return { ok: false, errors: ['envelope must be a plain object'] };
  }
  if (typeof env.v !== 'number' || !isFinite(env.v) || env.v <= 0 || env.v !== Math.floor(env.v)) {
    errors.push('v must be a positive integer');
  }
  if (typeof env.type !== 'string' || TYPE_LIST.indexOf(env.type) === -1) {
    errors.push('type must be one of ' + TYPE_LIST.join('/'));
  }
  if (env.payload === null || typeof env.payload !== 'object' || Array.isArray(env.payload)) {
    errors.push('payload must be an object');
  }
  if (env.ts !== undefined && (typeof env.ts !== 'number' || !isFinite(env.ts))) {
    errors.push('ts must be a number when present');
  }

  if (env.type === TYPES.REQ) {
    if (typeof env.id !== 'string' || env.id.length === 0) {
      errors.push('req requires a non-empty id');
    }
    if (typeof env.method !== 'string') {
      errors.push('req requires method');
    } else if (!hasMethod(env.method)) {
      errors.push('unknown method: ' + env.method);
    }
  } else if (env.type === TYPES.EVT) {
    if (typeof env.event !== 'string') {
      errors.push('evt requires event');
    } else if (!isEvent(env.event)) {
      errors.push('unknown event: ' + env.event);
    }
  } else if (env.type === TYPES.RES || env.type === TYPES.ERR) {
    if (typeof env.id !== 'string' || env.id.length === 0) {
      errors.push('res/err requires a non-empty id');
    }
  }

  return { ok: errors.length === 0, errors: errors };
}

/**
 * 信封 → JSON 字符串（UTF-8）。校验失败抛错。
 * @param {object} env
 * @returns {string}
 */
function encodeEnvelope(env) {
  var r = validateEnvelope(env);
  if (!r.ok) {
    throw new Error('invalid envelope: ' + r.errors.join(', '));
  }
  return JSON.stringify(env);
}

/**
 * JSON 字符串 / 对象 → 信封。失败返回结构化错误而非抛异常。
 * @param {string|object} input
 * @returns {{ok:true, value:object} | {ok:false, error:string, message:string}}
 */
function decodeEnvelope(input) {
  var obj;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch (e) {
      return { ok: false, error: 'E_BADREQ', message: 'JSON parse error' };
    }
  } else if (input !== null && typeof input === 'object') {
    obj = input;
  } else {
    return { ok: false, error: 'E_BADREQ', message: 'input must be string or object' };
  }
  var r = validateEnvelope(obj);
  if (!r.ok) {
    return { ok: false, error: 'E_BADREQ', message: r.errors.join(', ') };
  }
  return { ok: true, value: obj };
}

/**
 * 版本协商：取两端版本集合的交集中的最大值（§3.3）。
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number|null} 无交集返回 null
 */
function negotiateVersion(a, b) {
  var setB = {};
  (b || []).forEach(function (v) { setB[v] = true; });
  var common = [];
  (a || []).forEach(function (v) {
    if (setB[v] && common.indexOf(v) === -1) {
      common.push(v);
    }
  });
  if (common.length === 0) {
    return null;
  }
  return Math.max.apply(null, common);
}

/**
 * 能力协商：`band.caps ∩ phone.caps`，保持第一个参数的顺序（§3.3）。
 * @param {string[]} a
 * @param {string[]} b
 * @returns {string[]}
 */
function negotiateCaps(a, b) {
  var setB = {};
  (b || []).forEach(function (c) { setB[c] = true; });
  var out = [];
  (a || []).forEach(function (c) {
    if (setB[c] && out.indexOf(c) === -1) {
      out.push(c);
    }
  });
  return out;
}

/**
 * 过滤 envelope：仅当对端支持所需能力时才允许发送。
 * @param {object} env
 * @param {string[]} activeCaps 会话生效能力
 * @returns {{ok:boolean, missing?:string, error?:string}}
 */
function checkCapability(env, activeCaps) {
  if (env.type !== TYPES.REQ) {
    return { ok: true };
  }
  var cap = methodCap(env.method);
  if (cap === undefined) {
    return { ok: false, error: 'E_UNSUPPORTED' };
  }
  if (cap === null) {
    return { ok: true };
  }
  if ((activeCaps || []).indexOf(cap) !== -1) {
    return { ok: true };
  }
  return { ok: false, missing: cap, error: 'E_UNSUPPORTED' };
}

module.exports = {
  PROTO_VERSION: PROTO_VERSION,
  PROTO_VERSIONS: PROTO_VERSIONS,
  TYPES: TYPES,
  TYPE_LIST: TYPE_LIST,
  CAPS: CAPS,
  EVENTS: EVENTS,
  METHODS: METHODS,
  METHOD_CAP: METHOD_CAP,
  ERROR_CODES: ERROR_CODES,
  PLAYER_STATES: PLAYER_STATES,
  SONG_SOURCES: SONG_SOURCES,
  CHUNK_KINDS: CHUNK_KINDS,
  ORIGINS: ORIGINS,
  hasMethod: hasMethod,
  methodCap: methodCap,
  isEvent: isEvent,
  isErrorCode: isErrorCode,
  genBootId: genBootId,
  pad4: pad4,
  makeId: makeId,
  validateEnvelope: validateEnvelope,
  encodeEnvelope: encodeEnvelope,
  decodeEnvelope: decodeEnvelope,
  negotiateVersion: negotiateVersion,
  negotiateCaps: negotiateCaps,
  checkCapability: checkCapability
};
