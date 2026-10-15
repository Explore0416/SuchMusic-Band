/**
 * dedupe.js —— 接收端 req.id 幂等去重（LRU）
 *
 * 对齐设计文档 §3.11：接收端保留**最近 64 个已处理 req.id 的 LRU**；
 * 收到重复 id 直接回放缓存响应，**不重复执行**（保证重复命令不会重复切歌）。
 *
 * 纯逻辑，无运行时依赖，可被 `node` 直接 require。
 *
 * @module dedupe
 */
'use strict';

/** 默认容量（§3.11） */
var DEFAULT_CAPACITY = 64;

/**
 * 通用 LRU（Map 迭代序即「最近使用序」，最旧在头部）。
 * @constructor
 * @param {number} [capacity]
 */
function Lru(capacity) {
  this.capacity = capacity && capacity > 0 ? capacity : DEFAULT_CAPACITY;
  this._map = new Map();
}

/**
 * 是否存在 key（访问会刷新最近使用）。
 * @param {string} key
 * @returns {boolean}
 */
Lru.prototype.has = function has(key) {
  return this._map.has(key);
};

/**
 * 读取并刷新最近使用；不存在返回 undefined。
 * @param {string} key
 * @returns {*}
 */
Lru.prototype.get = function get(key) {
  if (!this._map.has(key)) {
    return undefined;
  }
  var v = this._map.get(key);
  this._map.delete(key);
  this._map.set(key, v);
  return v;
};

/**
 * 写入并刷新最近使用；超容淘汰最旧。
 * @param {string} key
 * @param {*} value
 */
Lru.prototype.set = function set(key, value) {
  if (this._map.has(key)) {
    this._map.delete(key);
  }
  this._map.set(key, value);
  while (this._map.size > this.capacity) {
    var oldest = this._map.keys().next().value;
    this._map.delete(oldest);
  }
};

/**
 * 删除。
 * @param {string} key
 * @returns {boolean}
 */
Lru.prototype.delete = function del(key) {
  return this._map.delete(key);
};

/** @returns {number} */
Object.defineProperty(Lru.prototype, 'size', {
  get: function () { return this._map.size; }
});

/**
 * 返回 key 列表，按「最旧 → 最新」。
 * @returns {string[]}
 */
Lru.prototype.keys = function keys() {
  var out = [];
  this._map.forEach(function (_v, k) { out.push(k); });
  return out;
};

/**
 * 清空。
 */
Lru.prototype.clear = function clear() {
  this._map.clear();
};

/**
 * 请求去重器：缓存已处理请求的响应，重复 id 直接回放。
 * @constructor
 * @param {number} [capacity]
 */
function ReqDedupe(capacity) {
  this.lru = new Lru(capacity || DEFAULT_CAPACITY);
}

/**
 * 检查请求是否已处理。
 * @param {string} id
 * @returns {{hit:boolean, response:*}} hit=true 时 response 为缓存响应（可能为 undefined）
 */
ReqDedupe.prototype.check = function check(id) {
  if (this.lru.has(id)) {
    return { hit: true, response: this.lru.get(id) };
  }
  return { hit: false, response: undefined };
};

/**
 * 记录请求响应，供后续重复 id 回放。
 * @param {string} id
 * @param {*} response
 */
ReqDedupe.prototype.record = function record(id, response) {
  this.lru.set(id, response);
};

/**
 * 尝试执行（若未处理过则执行 fn 并缓存其返回值；命中则直接回放）。
 * @param {string} id
 * @param {function():*} fn
 * @returns {{hit:boolean, response:*}}
 */
ReqDedupe.prototype.run = function run(id, fn) {
  var c = this.check(id);
  if (c.hit) {
    return c;
  }
  var response = fn();
  this.record(id, response);
  return { hit: false, response: response };
};

/** @returns {number} */
Object.defineProperty(ReqDedupe.prototype, 'size', {
  get: function () { return this.lru.size; }
});

module.exports = {
  DEFAULT_CAPACITY: DEFAULT_CAPACITY,
  Lru: Lru,
  ReqDedupe: ReqDedupe
};
