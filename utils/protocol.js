/**
 * utils/protocol.js —— Node 侧入口（转发到快应用单一真源）
 *
 * 快应用运行时只打包 `src/` 内的模块；为满足「纯逻辑模块可在 Node 下直接 require」
 * 的要求，根 `utils/` 提供**薄转发**，避免逻辑重复（DRY）。
 *
 * @module utils/protocol
 */
'use strict';
module.exports = require('../src/utils/protocol.js');
