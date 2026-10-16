/**
 * run.js —— 聚合运行全部 *.test.js
 *
 * 用法： node test/run.js   （等价于 npm test）
 */
'use strict';

var T = require('./tinytest.js');

// 注册并执行全部用例（require 时即执行）
require('./protocol.test.js');
require('./transfer.test.js');
require('./dedupe.test.js');
require('./mode.test.js');
require('./format.test.js');
require('./state.test.js');
require('./store.test.js');
require('./interconnect.test.js');
require('./rpc.test.js');

var r = T.summary('suchmusic-band 全量');
process.exit(r.fail === 0 ? 0 : 1);
