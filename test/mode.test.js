/**
 * mode.test.js —— PlayMode 枚举与手环显示文案双向映射单元测试
 * 运行： node test/mode.test.js
 */
'use strict';

var T = require('./tinytest.js');
var M = require('../src/utils/mode.js');

T.test('枚举值与手机 PlayMode 一致', function () {
  T.equal(M.PlayMode, { LOOP: 'loop', SINGLE: 'single', SHUFFLE: 'shuffle' });
  T.equal(M.MODES, ['loop', 'single', 'shuffle']);
});

T.test('模式 → 文案（完整/短）', function () {
  T.equal(M.label('loop'), '顺序播放');
  T.equal(M.label('single'), '单曲循环');
  T.equal(M.label('shuffle'), '乱序播放');
  T.equal(M.shortLabel('loop'), '顺序');
  T.equal(M.shortLabel('single'), '单曲循环');
  T.equal(M.shortLabel('shuffle'), '乱序');
});

T.test('文案 → 模式（双向映射）', function () {
  T.equal(M.fromLabel('顺序播放'), 'loop');
  T.equal(M.fromLabel('单曲循环'), 'single');
  T.equal(M.fromLabel('乱序播放'), 'shuffle');
  T.equal(M.fromLabel('顺序'), 'loop');
  T.equal(M.fromLabel('不存在'), null);
});

T.test('双向一致性：label→mode→label', function () {
  M.MODES.forEach(function (m) {
    T.equal(M.fromLabel(M.label(m)), m);
    T.equal(M.fromLabel(M.shortLabel(m)), m);
  });
});

T.test('未知值归一化为 loop（§4.4 D1）', function () {
  T.equal(M.normalize('random'), 'loop');
  T.equal(M.normalize(undefined), 'loop');
  T.equal(M.normalize('shuffle'), 'shuffle');
  T.ok(!M.isValid('x'));
});

T.test('cycle：loop→single→shuffle→loop', function () {
  T.equal(M.cycle('loop'), 'single');
  T.equal(M.cycle('single'), 'shuffle');
  T.equal(M.cycle('shuffle'), 'loop');
});

T.test('list 返回三行且仅当前项 selected', function () {
  var rows = M.list('single');
  T.equal(rows.length, 3);
  var sel = rows.filter(function (r) { return r.selected; });
  T.equal(sel.length, 1);
  T.equal(sel[0].mode, 'single');
});

T.test('图标/字形兜底可用', function () {
  T.equal(M.icon('loop'), 'list');
  T.ok(M.glyph('shuffle').length > 0);
});

if (require.main === module) {
  T.summary('mode.test.js');
}
