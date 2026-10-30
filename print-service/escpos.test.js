'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { buildEscPosFromPng, decodeScreenshotPng, MAX_HEIGHT_DOTS } = require('./escpos');

function chunk(name, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length, 0);
  header.write(name, 4, 4, 'ascii');
  return Buffer.concat([header, payload, Buffer.alloc(4)]); // decoder accepts trusted Chromium PNG; CRC not used
}
function png(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(rgb)]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(row)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('ESC/POS raster encoder', () => {
  it('prints black dots and leaves white dots empty', () => {
    const picture = png(8, 1, [
      0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0,
    ]);
    const output = buildEscPosFromPng(picture);
    assert.deepEqual(output.subarray(0, 5), Buffer.from([0x1b, 0x40, 0x1b, 0x61, 1]));
    assert.deepEqual(output.subarray(5, 13), Buffer.from([0x1d, 0x76, 0x30, 0, 1, 0, 1, 0]));
    assert.equal(output[13], 0x81);
    assert.deepEqual(output.subarray(-3), Buffer.from([0x1b, 0x64, 3]));
  });

  it('emits cutter only when enabled', () => {
    const picture = png(1, 1, [0, 0, 0]);
    const output = buildEscPosFromPng(picture, { cut: true });
    assert.deepEqual(output.subarray(-3), Buffer.from([0x1d, 0x56, 0]));
  });

  it('rejects receipts above safe height before attempting to inflate', () => {
    const picture = png(1, 1, [255, 255, 255]);
    picture.writeUInt32BE(MAX_HEIGHT_DOTS + 1, 20);
    assert.throws(() => decodeScreenshotPng(picture), /safe thermal paper dimensions/);
  });

  it('rejects invalid PNG and malformed raster data', () => {
    assert.throws(() => buildEscPosFromPng(Buffer.from('bad')), /Invalid PNG/);
    const picture = png(1, 1, [255, 255, 255]);
    picture[25] = 3; // indexed PNG unsupported
    assert.throws(() => buildEscPosFromPng(picture), /Unsupported PNG/);
  });
});
