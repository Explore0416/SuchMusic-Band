/**
 * store.js —— 手环持久化存储（严格受限）
 *
 * 硬约束（设计文档 §4.1 存储策略）：
 *   手环持久化**仅 4 类键**，合计 **< 2KB**：
 *     - sm_protoVer       (int)
 *     - sm_serverCaps     (str[])
 *     - sm_searchHistory  (str[≤5])
 *     - sm_lastMode       (str)
 *   **不存**歌词全文、封面、歌单（§3.9 / §3.12）。
 *
 * 对 Vela `@system.storage` 的访问经注入式适配器，便于 Node 单测。
 *
 * @module store
 */
'use strict';

/** 允许的键白名单（冻结） */
var ALLOWED_KEYS = ['sm_protoVer', 'sm_serverCaps', 'sm_searchHistory', 'sm_lastMode'];

/** 搜索历史最大条数（§3.10） */
var MAX_HISTORY = 5;

/** 单条关键词硬上限（字符数）——入库前限长，防止单条越长导致总占用越界 */
var MAX_KEYWORD_CHARS = 128;

/** 单条能力令牌 / 模式串的硬上限（防御性限长，正常取值远小于此） */
var MAX_CAP_CHARS = 32;
var MAX_MODE_CHARS = 16;

/** 持久化总占用上限（字节，保守 < 2KB 的硬顶） */
var MAX_TOTAL_BYTES = 2048;

/** Vela 键前缀（storage 需带前缀以防冲突） */
var KEY_PREFIX = 'sm_';

/**
 * 截断字符串到指定字符数（按 UTF-16 码元；对 BMP 内 CJK 即为字符数）。
 * @param {*} value
 * @param {number} max
 * @returns {string}
 */
function truncateStr(value, max) {
  var s = value === undefined || value === null ? '' : String(value);
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * 关键词入库前限长：去空白 + 截断到 MAX_KEYWORD_CHARS。
 * @param {*} keyword
 * @returns {string}
 */
function truncateKeyword(keyword) {
  return truncateStr(keyword, MAX_KEYWORD_CHARS).trim();
}

/**
 * 估算 JSON 序列化后的 UTF-8 字节数（本地实现，不依赖 Buffer）。
 * @param {*} value
 * @returns {number}
 */
function estimateBytes(value) {
  // 与实际落盘一致：一律以 JSON 序列化后的字节计（字符串含引号）
  var str = JSON.stringify(value === undefined ? null : value);
  if (str === undefined || str === null) {
    return 0;
  }
  var bytes = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) { bytes += 1; }
    else if (c < 0x800) { bytes += 2; }
    else if (c >= 0xD800 && c <= 0xDBFF) { bytes += 4; i++; }
    else { bytes += 3; }
  }
  return bytes;
}

/**
 * 是否白名单键。
 * @param {string} key
 * @returns {boolean}
 */
function isAllowedKey(key) {
  return ALLOWED_KEYS.indexOf(key) !== -1;
}

/**
 * 估算给定缓存快照的持久化总字节数（键名 + 值，均按 JSON 序列化计）。
 * @param {object} cache
 * @returns {number}
 */
function computeTotal(cache) {
  var total = 0;
  total += estimateBytes(KEY_PREFIX + 'sm_protoVer') + estimateBytes(String(cache.sm_protoVer));
  total += estimateBytes(KEY_PREFIX + 'sm_serverCaps') + estimateBytes(cache.sm_serverCaps);
  total += estimateBytes(KEY_PREFIX + 'sm_searchHistory') + estimateBytes(cache.sm_searchHistory);
  total += estimateBytes(KEY_PREFIX + 'sm_lastMode') + estimateBytes(cache.sm_lastMode);
  return total;
}

/**
 * 默认适配器：惰性加载 Vela `@system.storage`。
 * @returns {object}
 */
function defaultAdapter() {
  var mod = null;
  try {
    // eslint-disable-next-line global-require
    mod = require('@system.storage');
  } catch (e) {
    mod = null;
  }
  return {
    available: !!mod,
    get: function get(o) { if (mod && mod.get) { mod.get(o); } else { o.fail && o.fail(); } },
    set: function set(o) { if (mod && mod.set) { mod.set(o); } else { o.fail && o.fail(); } },
    delete: function dele(o) { if (mod && mod.delete) { mod.delete(o); } else { o.fail && o.fail(); } }
  };
}

/**
 * 创建持久化门面。
 * @param {object} [opts]
 * @param {object} [opts.adapter]
 * @returns {object}
 */
function createStore(opts) {
  opts = opts || {};
  var adapter = opts.adapter || defaultAdapter();
  var cache = {
    sm_protoVer: 0,
    sm_serverCaps: [],
    sm_searchHistory: [],
    sm_lastMode: 'loop'
  };

  /**
   * 入库前归一化：对可变长值做限长/限条，防止单键越界。
   * @param {string} key
   * @param {*} value
   * @returns {*}
   */
  function normalizeValue(key, value) {
    if (key === 'sm_protoVer') {
      return Number(value) || 0;
    }
    if (key === 'sm_serverCaps') {
      return (value || []).slice(0, 8).map(function (c) { return truncateStr(c, MAX_CAP_CHARS); });
    }
    if (key === 'sm_lastMode') {
      return truncateStr(value, MAX_MODE_CHARS);
    }
    if (key === 'sm_searchHistory') {
      return (value || []).slice(0, MAX_HISTORY).map(truncateKeyword);
    }
    return value;
  }

  /**
   * 全局兜底：保证持久化总占用恒 < MAX_TOTAL_BYTES。
   * 其它键均已限长，搜索历史是唯一可变长集合；按**既定淘汰策略**
   * （保留最新、从最旧[尾部]开始淘汰）裁剪至预算内。
   */
  function enforceBudget() {
    while (cache.sm_searchHistory.length > 0 && computeTotal(cache) >= MAX_TOTAL_BYTES) {
      cache.sm_searchHistory.pop();
    }
  }

  function write(key, value, cb) {
    if (!isAllowedKey(key)) {
      if (cb) { cb({ ok: false, error: 'E_BADREQ', message: 'key not allowed: ' + key }); }
      return;
    }
    cache[key] = normalizeValue(key, value);
    enforceBudget();
    // 一律 JSON 序列化，保证与 load() 的 JSON.parse 读取对称
    var payload = JSON.stringify(cache[key]);
    adapter.set({
      key: KEY_PREFIX + key,
      data: payload,
      success: function () { if (cb) { cb({ ok: true }); } },
      fail: function () { if (cb) { cb({ ok: false, error: 'E_INTERNAL' }); } }
    });
  }

  var store = {
    KEY_PREFIX: KEY_PREFIX,
    ALLOWED_KEYS: ALLOWED_KEYS,
    MAX_HISTORY: MAX_HISTORY,
    MAX_KEYWORD_CHARS: MAX_KEYWORD_CHARS,
    MAX_TOTAL_BYTES: MAX_TOTAL_BYTES,

    /**
     * 读取全部白名单键到内存缓存。
     * @param {function(object):void} cb
     */
    load: function load(cb) {
      adapter.get({
        key: ALLOWED_KEYS.map(function (k) { return KEY_PREFIX + k; }),
        success: function (res) {
          try {
            var data = res && res.data ? res.data : {};
            ALLOWED_KEYS.forEach(function (k) {
              var raw = data[KEY_PREFIX + k];
              if (raw !== undefined && raw !== null) {
                try {
                  var v = typeof raw === 'string' ? JSON.parse(raw) : raw;
                  // 载入即归一化，防止旧版/异常数据越界
                  cache[k] = normalizeValue(k, v);
                } catch (e) {
                  // 忽略坏数据，保持默认
                }
              }
            });
            enforceBudget();
          } catch (e) {
            // ignore
          }
          if (cb) { cb({ ok: true, data: store.snapshot() }); }
        },
        fail: function () {
          if (cb) { cb({ ok: false, error: 'E_INTERNAL', data: store.snapshot() }); }
        }
      });
    },

    /**
     * 内存快照。
     * @returns {object}
     */
    snapshot: function snapshot() {
      return {
        sm_protoVer: cache.sm_protoVer,
        sm_serverCaps: cache.sm_serverCaps.slice(),
        sm_searchHistory: cache.sm_searchHistory.slice(),
        sm_lastMode: cache.sm_lastMode
      };
    },

    /**
     * 估算当前持久化总字节数。
     * @returns {number}
     */
    totalBytes: function totalBytes() {
      return computeTotal(cache);
    },

    /**
     * 写入协议版本。
     * @param {number} v
     * @param {function(object):void} [cb]
     */
    setProtoVer: function setProtoVer(v, cb) {
      write('sm_protoVer', Number(v) || 0, cb);
    },

    /**
     * 写入服务端能力。
     * @param {string[]} caps
     * @param {function(object):void} [cb]
     */
    setServerCaps: function setServerCaps(caps, cb) {
      write('sm_serverCaps', (caps || []).slice(0, 8), cb);
    },

    /**
     * 写入最近播放模式。
     * @param {string} mode
     * @param {function(object):void} [cb]
     */
    setLastMode: function setLastMode(mode, cb) {
      write('sm_lastMode', mode, cb);
    },

    /**
     * 读取搜索历史（≤5）。
     * @returns {string[]}
     */
    getHistory: function getHistory() {
      return cache.sm_searchHistory.slice();
    },

    /**
     * 追加一条搜索历史（去重、置顶、≤5），返回新列表。
     * @param {string} keyword
     * @param {function(object):void} [cb]
     * @returns {string[]}
     */
    pushHistory: function pushHistory(keyword, cb) {
      var kw = truncateKeyword(keyword);
      if (!kw) {
        if (cb) { cb({ ok: false, error: 'E_BADREQ' }); }
        return cache.sm_searchHistory.slice();
      }
      var list = cache.sm_searchHistory.filter(function (x) { return x !== kw; });
      list.unshift(kw);
      if (list.length > MAX_HISTORY) {
        list = list.slice(0, MAX_HISTORY);
      }
      // write 内部会限长并在超预算时按既定策略淘汰
      write('sm_searchHistory', list, cb);
      return cache.sm_searchHistory.slice();
    },

    /**
     * 删除一条搜索历史，返回新列表。
     * @param {string} keyword
     * @param {function(object):void} [cb]
     * @returns {string[]}
     */
    removeHistory: function removeHistory(keyword, cb) {
      var list = cache.sm_searchHistory.filter(function (x) { return x !== keyword; });
      write('sm_searchHistory', list, cb);
      return list.slice();
    },

    /**
     * 清空全部持久化。
     * @param {function(object):void} [cb]
     */
    clear: function clear(cb) {
      adapter.delete({
        key: ALLOWED_KEYS.map(function (k) { return KEY_PREFIX + k; }),
        success: function () {
          cache.sm_protoVer = 0;
          cache.sm_serverCaps = [];
          cache.sm_searchHistory = [];
          cache.sm_lastMode = 'loop';
          if (cb) { cb({ ok: true }); }
        },
        fail: function () { if (cb) { cb({ ok: false, error: 'E_INTERNAL' }); } }
      });
    }
  };

  return store;
}

/** 单例 */
var singleton = createStore();

module.exports = {
  ALLOWED_KEYS: ALLOWED_KEYS,
  MAX_HISTORY: MAX_HISTORY,
  MAX_KEYWORD_CHARS: MAX_KEYWORD_CHARS,
  MAX_TOTAL_BYTES: MAX_TOTAL_BYTES,
  KEY_PREFIX: KEY_PREFIX,
  estimateBytes: estimateBytes,
  isAllowedKey: isAllowedKey,
  computeTotal: computeTotal,
  defaultAdapter: defaultAdapter,
  createStore: createStore,
  instance: singleton
};
