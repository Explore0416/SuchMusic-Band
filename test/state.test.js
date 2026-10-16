/**
 * state.test.js —— 全局播放状态单元测试
 * 运行： node test/state.test.js
 */
'use strict';

var T = require('./tinytest.js');
var state = require('../src/utils/state.js');

T.test('默认状态', function () {
  var s = new state.Store();
  T.equal(s.get().state, 'idle');
  T.equal(s.get().mode, 'loop');
  T.equal(s.get().playing, false);
});

T.test('player.song 事件更新曲目并重置歌词', function () {
  var s = new state.Store();
  s.applyEvent('player.song', { song: { id: 'x1', name: '晴天', artist: '周杰伦', durationMs: 269000 } });
  T.equal(s.get().song.name, '晴天');
  T.equal(s.get().durationMs, 269000);
  T.equal(s.get().lyric.has, false);
});

T.test('player.progress 更新进度', function () {
  var s = new state.Store();
  s.applyEvent('player.progress', { positionMs: 42000, durationMs: 269000, ts: 1 });
  T.equal(s.get().positionMs, 42000);
  T.equal(s.get().durationMs, 269000);
});

T.test('player.state / player.mode / player.queue', function () {
  var s = new state.Store();
  s.applyEvent('player.state', { state: 'playing', playing: true });
  T.equal(s.get().playing, true);
  s.applyEvent('player.mode', { mode: 'shuffle' });
  T.equal(s.get().mode, 'shuffle');
  s.applyEvent('player.queue', { count: 24, currentIndex: 3 });
  T.equal(s.get().queue, { count: 24, currentIndex: 3 });
});

T.test('lyric.line / lyric.meta', function () {
  var s = new state.Store();
  s.applyEvent('lyric.meta', { songId: 'x1', has: true, count: 82 });
  s.applyEvent('lyric.line', { songId: 'x1', index: 5, text: '从前从前', t: 3200 });
  T.equal(s.get().lyric.has, true);
  T.equal(s.get().lyric.count, 82);
  T.equal(s.get().lyric.index, 5);
  T.equal(s.get().lyric.text, '从前从前');
});

T.test('applySnapshot（state.get 结果）', function () {
  var s = new state.Store();
  s.applySnapshot({
    state: 'paused', playing: false,
    song: { id: 's', name: 'n' },
    positionMs: 1000, durationMs: 2000, mode: 'single',
    volume: 80, queue: { count: 3, currentIndex: 1 },
    lyric: { has: true, count: 40 }, ts: 9
  });
  var cur = s.get();
  T.equal(cur.state, 'paused');
  T.equal(cur.mode, 'single');
  T.equal(cur.volume, 80);
  T.equal(cur.queue.count, 3);
  T.equal(cur.lyric.count, 40);
});

T.test('subscribe 在变化时触发', function () {
  var s = new state.Store();
  var n = 0;
  var un = s.subscribe(function () { n++; });
  s.applyEvent('player.state', { state: 'playing', playing: true });
  s.set({ mode: 'loop' });
  T.equal(n, 2);
  un();
  s.set({ mode: 'single' });
  T.equal(n, 2, 'unsubscribed no longer fires');
});

T.test('clearLyricWindow 释放窗口', function () {
  var s = new state.Store();
  s.get().lyricWindow = { songId: 'q', start: 5, lines: [{ t: 0, text: 'a' }] };
  s.clearLyricWindow();
  T.equal(s.get().lyricWindow.lines, []);
});

if (require.main === module) {
  T.summary('state.test.js');
}
