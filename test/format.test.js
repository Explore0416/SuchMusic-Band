/**
 * format.test.js —— 时间 / 文本截断工具单元测试
 * 运行： node test/format.test.js
 */
'use strict';

var T = require('./tinytest.js');
var F = require('../src/utils/format.js');

T.test('formatTime', function () {
  T.equal(F.formatTime(0), '00:00');
  T.equal(F.formatTime(42000), '00:42');
  T.equal(F.formatTime(72000), '01:12');
  T.equal(F.formatTime(269000), '04:29');
  T.equal(F.formatTime(-5), '00:00');
  T.equal(F.formatTime(3723000), '01:02:03');
});

T.test('progressRatio 夹取 [0,1]', function () {
  T.equal(F.progressRatio(0, 100), 0);
  T.equal(F.progressRatio(50, 100), 0.5);
  T.equal(F.progressRatio(200, 100), 1);
  T.equal(F.progressRatio(50, 0), 0, 'zero duration');
});

T.test('widthPercent', function () {
  T.equal(F.widthPercent(0.5), '50%');
  T.equal(F.widthPercent(1.234), '100%');
  T.equal(F.widthPercent(0), '0%');
});

T.test('ellipsize 按显示宽度截断（CJK 记 2）', function () {
  T.equal(F.ellipsize('abcdefghij', 5), 'abcde…');
  T.equal(F.ellipsize('晴天周杰伦', 4), '晴天…', 'CJK 每字宽 2，4 宽容纳 2 字');
  T.equal(F.ellipsize('晴天', 10), '晴天');
  T.equal(F.ellipsize('', 5), '');
});

T.test('truncate 按字符数', function () {
  T.equal(F.truncate('abcdef', 3), 'abc…');
  T.equal(F.truncate('ab', 3), 'ab');
});

T.test('artistAlbum 组合', function () {
  T.equal(F.artistAlbum('周杰伦', '叶惠美'), '周杰伦 · 叶惠美');
  T.equal(F.artistAlbum('周杰伦', ''), '周杰伦');
  T.equal(F.artistAlbum('', ''), '');
});

T.test('clamp', function () {
  T.equal(F.clamp(5, 0, 3), 3);
  T.equal(F.clamp(-1, 0, 3), 0);
  T.equal(F.clamp(2, 0, 3), 2);
});

if (require.main === module) {
  T.summary('format.test.js');
}
