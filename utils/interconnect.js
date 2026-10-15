/**
 * utils/interconnect.js —— Node 侧入口（转发到快应用单一真源）
 *
 * 依赖 Vela `system.interconnect` 的部分通过注入式适配器访问；
 * Node 下默认适配器不可用，测试时请 `createLink({ adapter: fake })`。
 *
 * @module utils/interconnect
 */
'use strict';
module.exports = require('../src/utils/interconnect.js');
