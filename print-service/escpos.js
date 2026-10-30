'use strict';

// Dependency-free PNG decoder and ESC/POS raster encoder for the local XP-80 agent.
// Chromium screenshots are 8-bit RGB/RGBA PNGs. Fail closed on other PNG formats.
const zlib = require('node:zlib');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_WIDTH_DOTS = 576;
const MAX_HEIGHT_DOTS = 4800;
const BAND_HEIGHT = 128;

function decodeScreenshotPng(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid PNG screenshot');
  }
  let width = 0;
  let height = 0;
  let channels = 0;
  let offset = 8;
  const idat = [];
  let ended = false;
  while (offset + 12 <= buffer.length) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + size;
    if (end + 4 > buffer.length) throw new Error('Truncated PNG chunk');
    if (type === 'IHDR') {
      if (size !== 13) throw new Error('Invalid PNG header');
      width = buffer.readUInt32BE(start);
      height = buffer.readUInt32BE(start + 4);
      const depth = buffer[start + 8];
      const colorType = buffer[start + 9];
      const interlace = buffer[start + 12];
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new Error('Unsupported PNG format; expected 8-bit RGB/RGBA');
      }
      channels = colorType === 6 ? 4 : 3;
      if (width < 1 || width > MAX_WIDTH_DOTS || height < 1 || height > MAX_HEIGHT_DOTS) {
        const error = new Error('Receipt exceeds safe thermal paper dimensions');
        error.code = 'INVALID_PAYLOAD';
        throw error;
      }
    }
    if (type === 'IDAT') idat.push(buffer.subarray(start, end));
    if (type === 'IEND') { ended = true; break; }
    offset = end + 4;
  }
  if (!ended || !width || !height || !idat.length) throw new Error('Incomplete PNG screenshot');
  const stride = width * channels;
  const data = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height });
  if (data.length !== (stride + 1) * height) throw new Error('Invalid PNG pixel length');
  const pixels = Buffer.allocUnsafe(stride * height);
  let inputOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = data[inputOffset++];
    if (filter > 4) throw new Error('Invalid PNG filter');
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const raw = data[inputOffset++];
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const above = y ? pixels[row + x - stride] : 0;
      const aboveLeft = y && x >= channels ? pixels[row + x - stride - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const p = left + above - aboveLeft;
        const a = Math.abs(p - left), b = Math.abs(p - above), c = Math.abs(p - aboveLeft);
        predictor = a <= b && a <= c ? left : b <= c ? above : aboveLeft;
      }
      pixels[row + x] = (raw + predictor) & 255;
    }
  }
  return { pixels, width, height, channels };
}

function rasterBands({ pixels, width, height, channels }) {
  if (!Number.isInteger(width) || width < 1 || width > MAX_WIDTH_DOTS ||
      !Number.isInteger(height) || height < 1 || height > MAX_HEIGHT_DOTS ||
      (channels !== 3 && channels !== 4) || pixels.length !== width * height * channels) {
    throw new Error('Unsafe raster dimensions');
  }
  const widthBytes = Math.ceil(width / 8);
  const chunks = [];
  for (let top = 0; top < height; top += BAND_HEIGHT) {
    const rows = Math.min(BAND_HEIGHT, height - top);
    const bitmap = Buffer.alloc(widthBytes * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < width; x++) {
        const i = ((top + y) * width + x) * channels;
        const alpha = channels === 4 ? pixels[i + 3] / 255 : 1;
        const gray = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) * alpha + 255 * (1 - alpha);
        if (gray < 170) bitmap[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    chunks.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, widthBytes & 255, widthBytes >> 8, rows & 255, rows >> 8]));
    chunks.push(bitmap);
  }
  return chunks;
}

function buildEscPosFromPng(png, { cut = false } = {}) {
  const decoded = decodeScreenshotPng(png);
  return Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x1b, 0x61, 0x01]), // initialize, center
    ...rasterBands(decoded),
    Buffer.from(cut ? [0x1b, 0x64, 0x03, 0x1d, 0x56, 0x00] : [0x1b, 0x64, 0x03]),
  ]);
}

module.exports = { decodeScreenshotPng, rasterBands, buildEscPosFromPng, MAX_WIDTH_DOTS, MAX_HEIGHT_DOTS };
