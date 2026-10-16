/**
 * transfer.js —— 分片传输纯逻辑（header → data → end）
 *
 * 对齐设计文档 §3.8：
 *   - 单包上限 chunkMaxBytes = 900（保守值，真实上限待验证 V2）
 *   - 手环组装上限 assembleMaxBytes = 8192
 *   - 校验：整包 CRC32（IEEE，zlib 同款）
 *   - 帧：header / data(seq) / end；内容字段 `txt`（文本）或 `b64`（二进制）二选一
 *   - 失败 → `xfer.nack{tid,seq}` 只重发缺失分片
 *
 * 本模块为纯函数 + 纯类，不依赖 Node/Vela 专有 API（不使用 Buffer），
 * 可被 `node` 直接 require。
 *
 * @module transfer
 */
'use strict';

/** 单包字节上限（保守默认值；待验证 V2） */
var CHUNK_MAX_BYTES = 900;

/** 手环组装缓存上限 */
var ASSEMBLE_MAX_BYTES = 8192;

/* -------------------------------------------------------------------------- */
/* CRC32（IEEE 802.3 / zlib 同款，多项式 0xEDB88320）                            */
/* -------------------------------------------------------------------------- */

var CRC_TABLE = null;

function ensureCrcTable() {
  if (CRC_TABLE) {
    return CRC_TABLE;
  }
  var table = new Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

/**
 * CRC32 计算。输入可为字符串（按 UTF-8 计）或 Uint8Array / number[]。
 * @param {string|Uint8Array|number[]} input
 * @returns {number} 无符号 32 位整数
 */
function crc32(input) {
  var bytes = toUint8Array(input);
  var table = ensureCrcTable();
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * @param {number} u32
 * @returns {string} 8 位小写 hex
 */
function crcHex(u32) {
  var s = (u32 >>> 0).toString(16);
  while (s.length < 8) {
    s = '0' + s;
  }
  return s;
}

/* -------------------------------------------------------------------------- */
/* UTF-8 编解码（不依赖 TextEncoder / Buffer）                                   */
/* -------------------------------------------------------------------------- */

/**
 * 字符串 → UTF-8 字节。
 * @param {string} str
 * @returns {Uint8Array}
 */
function utf8Encode(str) {
  str = String(str);
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
    } else if (c >= 0xD800 && c <= 0xDBFF) {
      var c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        i++;
        bytes.push(
          0xF0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3F),
          0x80 | ((cp >> 6) & 0x3F),
          0x80 | (cp & 0x3F)
        );
      } else {
        // 孤立高代理 → U+FFFD
        bytes.push(0xEF, 0xBF, 0xBD);
      }
    } else {
      bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
  }
  return new Uint8Array(bytes);
}

/**
 * UTF-8 字节 → 字符串。
 * @param {Uint8Array|number[]} u8
 * @returns {string}
 */
function utf8Decode(u8) {
  var bytes = toUint8Array(u8);
  var out = '';
  var i = 0;
  while (i < bytes.length) {
    var c = bytes[i++];
    if (c < 0x80) {
      out += String.fromCharCode(c);
    } else if (c >= 0xC0 && c < 0xE0) {
      out += String.fromCharCode(((c & 0x1F) << 6) | (bytes[i++] & 0x3F));
    } else if (c >= 0xE0 && c < 0xF0) {
      out += String.fromCharCode(((c & 0x0F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F));
    } else if (c >= 0xF0) {
      var cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F);
      cp -= 0x10000;
      out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
    } else {
      out += '\uFFFD';
    }
  }
  return out;
}

/**
 * 统一转 Uint8Array。
 * @param {string|Uint8Array|number[]} input
 * @returns {Uint8Array}
 */
function toUint8Array(input) {
  if (typeof input === 'string') {
    return utf8Encode(input);
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  if (Array.isArray(input) || (input && typeof input.length === 'number')) {
    return new Uint8Array(input);
  }
  return new Uint8Array(0);
}

/* -------------------------------------------------------------------------- */
/* Base64（不依赖 Buffer，供 cover 二进制使用）                                  */
/* -------------------------------------------------------------------------- */

var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * @param {Uint8Array|number[]} u8
 * @returns {string}
 */
function encodeBase64(u8) {
  var bytes = toUint8Array(u8);
  var out = '';
  var i = 0;
  while (i < bytes.length) {
    var b0 = bytes[i++];
    var hasB1 = i < bytes.length;
    var b1 = hasB1 ? bytes[i++] : 0;
    var hasB2 = i < bytes.length;
    var b2 = hasB2 ? bytes[i++] : 0;
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += hasB1 ? B64_CHARS[((b1 & 0x0F) << 2) | (b2 >> 6)] : '=';
    out += hasB2 ? B64_CHARS[b2 & 0x3F] : '=';
  }
  return out;
}

var B64_LOOKUP = null;

function ensureB64Lookup() {
  if (B64_LOOKUP) {
    return B64_LOOKUP;
  }
  var map = {};
  for (var i = 0; i < B64_CHARS.length; i++) {
    map[B64_CHARS[i]] = i;
  }
  B64_LOOKUP = map;
  return map;
}

/**
 * @param {string} str
 * @returns {Uint8Array}
 */
function decodeBase64(str) {
  var map = ensureB64Lookup();
  var s = String(str).replace(/[^A-Za-z0-9+/]/g, '');
  var out = [];
  var i = 0;
  while (i < s.length) {
    var has1 = i + 1 < s.length;
    var has2 = i + 2 < s.length;
    var has3 = i + 3 < s.length;
    var c0 = map[s[i]];
    var c1 = has1 ? map[s[i + 1]] : 0;
    var c2 = has2 ? map[s[i + 2]] : 0;
    var c3 = has3 ? map[s[i + 3]] : 0;
    out.push(((c0 << 2) | (c1 >> 4)) & 0xFF);
    if (has2) {
      out.push((((c1 & 0x0F) << 4) | (c2 >> 2)) & 0xFF);
    }
    if (has3) {
      out.push((((c2 & 0x03) << 6) | c3) & 0xFF);
    }
    i += 4;
  }
  return new Uint8Array(out);
}

/* -------------------------------------------------------------------------- */
/* 文本切分（按 UTF-8 字节切，且不切断码点）                                     */
/* -------------------------------------------------------------------------- */

/**
 * 将文本按 UTF-8 字节上限切分为若干子串（不切断多字节字符）。
 * @param {string} str
 * @param {number} [maxBytes]
 * @returns {string[]}
 */
function chunkText(str, maxBytes) {
  var limit = maxBytes || CHUNK_MAX_BYTES;
  str = String(str);
  var chunks = [];
  var cur = '';
  var curBytes = 0;
  var i = 0;
  while (i < str.length) {
    var code = str.charCodeAt(i);
    var cpLen = 1;
    var size;
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
      var c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
        size = 4;
        cpLen = 2;
      } else {
        size = 3;
      }
    } else if (code < 0x80) {
      size = 1;
    } else if (code < 0x800) {
      size = 2;
    } else {
      size = 3;
    }
    if (curBytes > 0 && curBytes + size > limit) {
      chunks.push(cur);
      cur = '';
      curBytes = 0;
      continue;
    }
    cur += str.substr(i, cpLen);
    curBytes += size;
    i += cpLen;
  }
  chunks.push(cur);
  return chunks;
}

/**
 * 将二进制按字节上限切分。
 * @param {Uint8Array|number[]} input
 * @param {number} [maxBytes]
 * @returns {Uint8Array[]}
 */
function chunkBinary(input, maxBytes) {
  var bytes = toUint8Array(input);
  var limit = maxBytes || CHUNK_MAX_BYTES;
  var out = [];
  for (var i = 0; i < bytes.length; i += limit) {
    out.push(bytes.subarray(i, Math.min(i + limit, bytes.length)));
  }
  if (out.length === 0) {
    out.push(new Uint8Array(0));
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* 分片帧构造                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 构造 header/data/end 三段式分片帧载荷（不含信封包装，由 rpc 层包裹）。
 *
 * @param {string} kind 分片类别（lyric_window / search_result / cover）
 * @param {string|Uint8Array|number[]} data 文本或二进制
 * @param {object} [opts]
 * @param {string} [opts.tid] 事务 id，缺省自动生成
 * @param {number} [opts.maxBytes] 单包上限，缺省 900
 * @param {object} [opts.meta] header.meta（如 {songId,start,count}）
 * @param {boolean} [opts.binary] 强制二进制编码（缺省按 kind==='cover' 推断）
 * @returns {{tid:string,kind:string,header:object,datas:object[],end:object,total:number,bytes:number,crc32:string,binary:boolean}}
 */
function buildChunkFrames(kind, data, opts) {
  opts = opts || {};
  var maxBytes = opts.maxBytes || CHUNK_MAX_BYTES;
  var tid = opts.tid || ('t-' + Math.floor(Math.random() * 0x10000).toString(16));
  var binary = opts.binary !== undefined ? !!opts.binary : (kind === 'cover');

  var datas = [];
  var bytesTotal = 0;
  var crc = 0;
  var total = 0;

  if (binary) {
    var full = toUint8Array(data);
    var slices = chunkBinary(full, maxBytes);
    total = slices.length;
    bytesTotal = full.length;
    crc = crc32(full);
    for (var i = 0; i < slices.length; i++) {
      datas.push({ tid: tid, phase: 'data', seq: i, b64: encodeBase64(slices[i]) });
    }
  } else {
    var text = String(data);
    var parts = chunkText(text, maxBytes);
    total = parts.length;
    var fullBytes = utf8Encode(text);
    bytesTotal = fullBytes.length;
    crc = crc32(fullBytes);
    for (var j = 0; j < parts.length; j++) {
      datas.push({ tid: tid, phase: 'data', seq: j, txt: parts[j] });
    }
  }

  var crcStr = crcHex(crc);
  var header = {
    tid: tid,
    phase: 'header',
    kind: kind,
    total: total,
    bytes: bytesTotal,
    crc32: crcStr,
    meta: opts.meta || {}
  };
  var end = { tid: tid, phase: 'end', total: total, crc32: crcStr };

  return {
    tid: tid,
    kind: kind,
    header: header,
    datas: datas,
    end: end,
    total: total,
    bytes: bytesTotal,
    crc32: crcStr,
    binary: binary
  };
}

/* -------------------------------------------------------------------------- */
/* 组装器                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 接收端分片组装器。用法：
 *   var a = new ChunkAssembler();
 *   a.onHeader(payload); a.onData(payload); ... a.onEnd(payload);
 *
 * @constructor
 * @param {object} [opts]
 * @param {number} [opts.maxBytes=8192]
 */
function ChunkAssembler(opts) {
  opts = opts || {};
  this.maxBytes = opts.maxBytes || ASSEMBLE_MAX_BYTES;
  this.reset();
}

/**
 * 复位到初始态。
 */
ChunkAssembler.prototype.reset = function reset() {
  this.tid = null;
  this.kind = null;
  this.total = 0;
  this.expectedBytes = 0;
  this.expectedCrc = null;
  this.meta = null;
  this.binary = false;
  this.parts = [];
  this.receivedCount = 0;
  this.started = false;
  this.done = false;
};

/**
 * 处理 header 帧。
 * @param {object} p payload
 * @returns {{ok:boolean, error?:string}}
 */
ChunkAssembler.prototype.onHeader = function onHeader(p) {
  if (!p || typeof p.tid !== 'string') {
    return { ok: false, error: 'E_BADREQ' };
  }
  if (typeof p.total !== 'number' || p.total < 0 ||
      typeof p.bytes !== 'number' || p.bytes < 0) {
    return { ok: false, error: 'E_BADREQ' };
  }
  if (p.bytes > this.maxBytes) {
    return { ok: false, error: 'E_TOOLARGE' };
  }
  this.reset();
  this.tid = p.tid;
  this.kind = p.kind || null;
  this.total = p.total;
  this.expectedBytes = p.bytes;
  this.expectedCrc = p.crc32 || null;
  this.meta = p.meta || {};
  this.binary = (this.kind === 'cover');
  this.parts = new Array(p.total);
  this.started = true;
  return { ok: true };
};

/**
 * 处理 data 帧。
 * @param {object} p payload
 * @returns {{ok:boolean, error?:string, missing?:number[]}}
 */
ChunkAssembler.prototype.onData = function onData(p) {
  if (!this.started || !p || p.tid !== this.tid) {
    return { ok: false, error: 'E_BADREQ' };
  }
  var seq = p.seq;
  if (typeof seq !== 'number' || seq < 0 || seq >= this.total) {
    return { ok: false, error: 'E_BADREQ' };
  }
  if (this.parts[seq] === undefined) {
    this.receivedCount++;
  }
  if (p.b64 !== undefined) {
    this.parts[seq] = { b64: p.b64 };
  } else if (p.txt !== undefined) {
    this.parts[seq] = { txt: p.txt };
  } else {
    return { ok: false, error: 'E_BADREQ' };
  }
  return { ok: true, missing: this.missingSeqs() };
};

/**
 * 处理 end 帧并校验。校验通过返回组装结果。
 * @param {object} p payload
 * @returns {{ok:boolean, error?:string, missing?:number[], data?:object}}
 */
ChunkAssembler.prototype.onEnd = function onEnd(p) {
  if (!this.started) {
    return { ok: false, error: 'E_BADREQ' };
  }
  if (p && p.tid !== undefined && p.tid !== this.tid) {
    return { ok: false, error: 'E_BADREQ' };
  }
  var missing = this.missingSeqs();
  if (missing.length > 0 || this.receivedCount !== this.total) {
    return { ok: false, error: 'E_CRC', missing: missing };
  }
  var assembled;
  var bytes;
  if (this.binary) {
    var acc = [];
    for (var i = 0; i < this.total; i++) {
      var chunkBytes = decodeBase64(this.parts[i].b64);
      for (var k = 0; k < chunkBytes.length; k++) {
        acc.push(chunkBytes[k]);
      }
    }
    bytes = new Uint8Array(acc);
  } else {
    var text = '';
    for (var j = 0; j < this.total; j++) {
      text += this.parts[j].txt;
    }
    bytes = utf8Encode(text);
    assembled = text;
  }

  var actualCrc = crc32(bytes);
  if (this.expectedCrc && crcHex(actualCrc) !== this.expectedCrc) {
    return { ok: false, error: 'E_CRC', missing: [] };
  }
  if (this.expectedBytes && bytes.length !== this.expectedBytes) {
    return { ok: false, error: 'E_CRC', missing: [] };
  }

  this.done = true;
  return {
    ok: true,
    data: {
      tid: this.tid,
      kind: this.kind,
      meta: this.meta,
      binary: this.binary,
      text: this.binary ? null : assembled,
      bytes: bytes
    }
  };
};

/**
 * 返回尚未收到的分片序号（升序）。
 * @returns {number[]}
 */
ChunkAssembler.prototype.missingSeqs = function missingSeqs() {
  var out = [];
  for (var i = 0; i < this.total; i++) {
    if (this.parts[i] === undefined) {
      out.push(i);
    }
  }
  return out;
};

/**
 * 构造 xfer.nack 的请求载荷（只重发缺失分片）。
 * @param {string} tid
 * @param {number[]} seqs
 * @returns {object[]}
 */
function buildNack(tid, seqs) {
  return (seqs || []).map(function (s) {
    return { tid: tid, seq: s };
  });
}

module.exports = {
  CHUNK_MAX_BYTES: CHUNK_MAX_BYTES,
  ASSEMBLE_MAX_BYTES: ASSEMBLE_MAX_BYTES,
  crc32: crc32,
  crcHex: crcHex,
  utf8Encode: utf8Encode,
  utf8Decode: utf8Decode,
  toUint8Array: toUint8Array,
  encodeBase64: encodeBase64,
  decodeBase64: decodeBase64,
  chunkText: chunkText,
  chunkBinary: chunkBinary,
  buildChunkFrames: buildChunkFrames,
  ChunkAssembler: ChunkAssembler,
  buildNack: buildNack
};
