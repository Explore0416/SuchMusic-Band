/**
 * tinytest.js —— 极简测试骨架（零依赖）
 *
 * 用法：每个 *.test.js 文件 require 本模块并调用 T.test(name, fn)；
 * 单独运行 `node test/xxx.test.js` 或聚合运行 `node test/run.js`。
 *
 * @module test/tinytest
 */
'use strict';

var state = { pass: 0, fail: 0, lines: [] };

/**
 * 注册并立即执行一个用例。
 * @param {string} name
 * @param {function():void} fn
 */
function test(name, fn) {
  try {
    fn();
    state.pass++;
    state.lines.push({ ok: true, name: name });
  } catch (e) {
    state.fail++;
    state.lines.push({ ok: false, name: name, err: (e && e.message) || String(e) });
  }
}

/**
 * 断言为真。
 * @param {*} cond
 * @param {string} [msg]
 */
function ok(cond, msg) {
  if (!cond) {
    throw new Error(msg || 'expected truthy value');
  }
}

/**
 * 断言相等（深比较）。
 * @param {*} actual
 * @param {*} expected
 * @param {string} [msg]
 */
function equal(actual, expected, msg) {
  if (!deepEqual(actual, expected)) {
    throw new Error((msg ? msg + ': ' : '') +
      'expected ' + stringify(expected) + ' but got ' + stringify(actual));
  }
}

/**
 * 断言抛出异常，返回其 error。
 * @param {function():void} fn
 * @param {string} [msg]
 * @returns {Error}
 */
function throws(fn, msg) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error(msg || 'expected function to throw');
}

function deepEqual(a, b) {
  if (a === b) { return true; }
  if (typeof a !== typeof b) { return false; }
  if (a === null || b === null || typeof a !== 'object') { return false; }
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) { return false; }
    for (var k = 0; k < a.length; k++) { if (a[k] !== b[k]) { return false; } }
    return true;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) { return false; }
    for (var i = 0; i < a.length; i++) { if (!deepEqual(a[i], b[i])) { return false; } }
    return true;
  }
  var ka = Object.keys(a);
  var kb = Object.keys(b);
  if (ka.length !== kb.length) { return false; }
  for (var j = 0; j < ka.length; j++) {
    if (!Object.prototype.hasOwnProperty.call(b, ka[j])) { return false; }
    if (!deepEqual(a[ka[j]], b[ka[j]])) { return false; }
  }
  return true;
}

function stringify(v) {
  try {
    if (v instanceof Uint8Array) { return 'Uint8Array[' + Array.prototype.join.call(v, ',') + ']'; }
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}

/**
 * 打印汇总，返回计数。
 * @param {string} [label]
 * @returns {{pass:number, fail:number, total:number}}
 */
function summary(label) {
  // eslint-disable-next-line no-console
  console.log('\n' + (label ? label + ' ' : '') + '—— 测试结果 ——');
  state.lines.forEach(function (l) {
    // eslint-disable-next-line no-console
    console.log((l.ok ? '  \u2713 PASS ' : '  \u2717 FAIL ') + l.name + (l.ok ? '' : '  →  ' + l.err));
  });
  var total = state.pass + state.fail;
  // eslint-disable-next-line no-console
  console.log('---------------------------------------------');
  // eslint-disable-next-line no-console
  console.log('通过 ' + state.pass + ' / ' + total + '，失败 ' + state.fail);
  return { pass: state.pass, fail: state.fail, total: total };
}

module.exports = {
  test: test,
  ok: ok,
  equal: equal,
  throws: throws,
  deepEqual: deepEqual,
  summary: summary,
  _state: state
};
