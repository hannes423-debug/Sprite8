// Minimal PNG encoder/decoder for Node (no dependencies, uses node:zlib).
// Supports 8-bit grayscale, RGB, RGBA, gray+alpha and palette images
// (palette at 1/2/4/8 bits), all five scanline filters, no interlacing.
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Encodes RGBA8 pixels as a PNG.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array | Uint8ClampedArray} rgba
 * @returns {Uint8Array}
 */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error('encodePng: data length does not match size');
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = new Uint8Array(deflateSync(raw));
  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decodes a PNG into RGBA8.
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, data: Uint8ClampedArray }}
 */
export function decodePng(bytes) {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('Not a PNG file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  while (pos < bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (interlace) throw new Error('Interlaced PNGs are not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}`);
  if (colorType !== 3 && depth !== 8) throw new Error(`Unsupported bit depth ${depth}`);
  const compressed = new Uint8Array(idat.reduce((s, d) => s + d.length, 0));
  let o = 0;
  for (const d of idat) {
    compressed.set(d, o);
    o += d.length;
  }
  const raw = new Uint8Array(inflateSync(compressed));
  const bitsPerPixel = depth * channels;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let val = line[x];
      if (filter === 1) val += a;
      else if (filter === 2) val += b;
      else if (filter === 3) val += (a + b) >> 1;
      else if (filter === 4) val += paeth(a, b, c);
      cur[x] = val & 255;
    }
  }
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      const row = y * stride;
      if (colorType === 3) {
        const bit = x * depth;
        const idx = (pixels[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        out[di] = palette[idx * 3];
        out[di + 1] = palette[idx * 3 + 1];
        out[di + 2] = palette[idx * 3 + 2];
        out[di + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else {
        const si = row + x * channels;
        if (colorType === 0 || colorType === 4) {
          out[di] = out[di + 1] = out[di + 2] = pixels[si];
          out[di + 3] = colorType === 4 ? pixels[si + 1] : 255;
        } else {
          out[di] = pixels[si];
          out[di + 1] = pixels[si + 1];
          out[di + 2] = pixels[si + 2];
          out[di + 3] = colorType === 6 ? pixels[si + 3] : 255;
        }
      }
    }
  }
  return { width, height, data: out };
}
