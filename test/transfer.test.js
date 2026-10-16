/**
 * transfer.test.js —— 分片切分 / 组装 / CRC32 / NACK 单元测试
 * 运行： node test/transfer.test.js
 */
'use strict';

var T = require('./tinytest.js');
var X = require('../src/utils/transfer.js');

T.test('CRC32 已知向量（123456789 → 0xCBF43926）', function () {
  T.equal(X.crc32('123456789') >>> 0, 0xCBF43926);
  T.equal(X.crcHex(X.crc32('123456789')), 'cbf43926');
});

T.test('UTF-8 编解码往返（含 CJK 与 emoji）', function () {
  var s = '晴天 周杰伦 · 叶惠美 😀♪';
  var dec = X.utf8Decode(X.utf8Encode(s));
  T.equal(dec, s);
});

T.test('Base64 往返（覆盖 0/1/2 字节余数）', function () {
  var cases = [[], [1], [1, 2], [1, 2, 3], [255, 0, 128, 7, 9]];
  cases.forEach(function (arr) {
    var u = new Uint8Array(arr);
    var enc = X.encodeBase64(u);
    var dec = X.decodeBase64(enc);
    T.equal(dec, u, 'roundtrip ' + JSON.stringify(arr));
  });
});

T.test('文本切分：拼接还原 + 每片不超上限（且不切断码点）', function () {
  var text = '这是一段很长的中文歌词，用来验证按 UTF-8 字节切分后可以无损还原。😀♪' .repeat(3);
  var maxBytes = 30;
  var chunks = X.chunkText(text, maxBytes);
  T.equal(chunks.join(''), text, 'reassembled equals original');
  chunks.forEach(function (c) {
    T.ok(X.utf8Encode(c).length <= maxBytes, 'chunk within limit');
  });
});

T.test('buildChunkFrames（文本）+ 组装还原为 JSON', function () {
  var obj = { songId: 's1', start: 5, lines: [] };
  for (var i = 0; i < 40; i++) {
    obj.lines.push({ t: i * 1000, text: '第' + i + '行歌词内容内容内容' });
  }
  var text = JSON.stringify(obj);
  var fr = X.buildChunkFrames('lyric_window', text, { tid: 't-0007', maxBytes: 64 });

  T.ok(fr.total >= 2, 'should split into multiple chunks');
  T.equal(fr.header.phase, 'header');
  T.equal(fr.header.total, fr.total);
  T.equal(fr.header.kind, 'lyric_window');
  T.equal(fr.header.crc32, fr.crc32);

  var asm = new X.ChunkAssembler();
  T.ok(asm.onHeader(fr.header).ok);
  fr.datas.forEach(function (d) { asm.onData(d); });
  var res = asm.onEnd(fr.end);
  T.ok(res.ok, 'assembly ok');
  T.equal(JSON.parse(res.data.text), obj);
});

T.test('缺片 → missingSeqs + nack；补发后成功', function () {
  var text = JSON.stringify({ hello: '世界', n: 12345 });
  var fr = X.buildChunkFrames('search_result', text, { tid: 't-0008', maxBytes: 20 });
  var asm = new X.ChunkAssembler();
  asm.onHeader(fr.header);
  // 故意跳过 seq=1
  fr.datas.forEach(function (d) { if (d.seq !== 1) { asm.onData(d); } });
  var end = asm.onEnd(fr.end);
  T.ok(!end.ok, 'should fail before补发');
  T.equal(end.missing, [1]);
  var nacks = X.buildNack('t-0008', end.missing);
  T.equal(nacks, [{ tid: 't-0008', seq: 1 }]);
  // 补发
  asm.onData(fr.datas[1]);
  var ok = asm.onEnd(fr.end);
  T.ok(ok.ok);
  T.equal(JSON.parse(ok.data.text).hello, '世界');
});

T.test('CRC 不匹配被检出（E_CRC）', function () {
  var text = 'abcdefghij';
  var fr = X.buildChunkFrames('search_result', text, { tid: 't-1', maxBytes: 4 });
  var asm = new X.ChunkAssembler();
  asm.onHeader(fr.header);
  fr.datas.forEach(function (d, i) { asm.onData(i === 0 ? { tid: d.tid, phase: 'data', seq: d.seq, txt: 'XXXX' } : d); });
  var res = asm.onEnd(fr.end);
  T.ok(!res.ok);
  T.equal(res.error, 'E_CRC');
});

T.test('组装上限 → E_TOOLARGE', function () {
  var asm = new X.ChunkAssembler({ maxBytes: 100 });
  var r = asm.onHeader({ tid: 't-2', phase: 'header', kind: 'cover', total: 1, bytes: 200, crc32: '00000000', meta: {} });
  T.ok(!r.ok);
  T.equal(r.error, 'E_TOOLARGE');
});

T.test('二进制（cover）分片往返', function () {
  var bytes = new Uint8Array(500);
  for (var i = 0; i < bytes.length; i++) { bytes[i] = (i * 37) & 0xFF; }
  var fr = X.buildChunkFrames('cover', bytes, { tid: 't-3', maxBytes: 96 });
  T.ok(fr.binary);
  T.ok(fr.datas[0].b64 !== undefined, 'data uses b64');
  var asm = new X.ChunkAssembler();
  asm.onHeader(fr.header);
  fr.datas.forEach(function (d) { asm.onData(d); });
  var res = asm.onEnd(fr.end);
  T.ok(res.ok);
  T.equal(res.data.bytes, bytes);
});

if (require.main === module) {
  T.summary('transfer.test.js');
}
