#!/usr/bin/env node
// Sprite8 reference server — implements the Sprite8 HTTP protocol v1
// (docs/providers.md) with zero dependencies.
//
//   node models/reference-server/server.mjs --backend echo
//   node models/reference-server/server.mjs --backend mock --port 7861
//
// Backends:
//   echo  Returns the source image unchanged. Use it to check that Sprite8 can
//         reach your server (CORS, URLs, payload sizes).
//   mock  A TEST DOUBLE, NOT AN AI MODEL. It fakes "imperfect model output"
//         (random offset/scale, colour noise, a squeezed or flipped silhouette)
//         so the consistency pipeline can be exercised end-to-end. It cannot
//         draw unseen sides of a character — that needs a real image model;
//         see diffusers_server.py for a starting point.
import { createServer } from 'node:http';
import { decodePng, encodePng } from './png.mjs';

const VERSION = '0.1.0';

function parseArgs(argv) {
  const args = { port: 7861, host: '127.0.0.1', backend: 'echo', delay: 0, mirrorBug: [], outScale: 1 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--port') args.port = Number(next());
    else if (a === '--host') args.host = next();
    else if (a === '--backend') args.backend = next();
    else if (a === '--delay') args.delay = Number(next());
    else if (a === '--mirror-bug') args.mirrorBug = next().split(',').filter(Boolean);
    else if (a === '--out-scale') args.outScale = Math.max(1, Math.round(Number(next())));
    else if (a === '--help' || a === '-h') {
      console.log('Usage: server.mjs [--port 7861] [--host 127.0.0.1] [--backend echo|mock] [--delay ms] [--mirror-bug NE,SW] [--out-scale 2]');
      process.exit(0);
    }
  }
  return args;
}

/* ------------------------------------------------------------ image utils */

function fromBase64(b64) {
  const clean = b64.replace(/^data:[^,]*,/, '');
  return decodePng(new Uint8Array(Buffer.from(clean, 'base64')));
}

function toBase64(img) {
  return Buffer.from(encodePng(img.width, img.height, img.data)).toString('base64');
}

function hexColor(hex) {
  const v = (hex || '#ffffff').replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Bounding box of pixels that differ from the background colour. */
function characterBounds(img, bg) {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const d = Math.abs(img.data[i] - bg[0]) + Math.abs(img.data[i + 1] - bg[1]) + Math.abs(img.data[i + 2] - bg[2]);
      if (img.data[i + 3] > 0 && d > 30) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Mock "model output": transformed copy of the character on the same background. */
function mockRender(src, body, opts) {
  const bg = hexColor(body.background);
  const random = rng(Number(body.seed) || 1);
  const bounds = characterBounds(src, bg);
  const outW = src.width * opts.outScale;
  const outH = src.height * opts.outScale;
  const out = { width: outW, height: outH, data: new Uint8ClampedArray(outW * outH * 4) };
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = bg[0];
    out.data[i + 1] = bg[1];
    out.data[i + 2] = bg[2];
    out.data[i + 3] = 255;
  }
  if (!bounds) return out;
  const dir = String(body.direction || 'S');
  // Pretend profile/diagonal views are narrower; back views are flipped.
  const squeeze = { N: 1, S: 1, E: 0.62, W: 0.62, NE: 0.8, NW: 0.8, SE: 0.85, SW: 0.85 }[dir] ?? 1;
  let flip = ['N', 'NE', 'NW'].includes(dir);
  if (opts.mirrorBug.includes(dir)) flip = !flip; // simulate a model swapping hands
  const jitter = 0.9 + random() * 0.2;
  const sx = squeeze * jitter * opts.outScale;
  const sy = jitter * opts.outScale;
  const dw = Math.max(1, Math.round(bounds.w * sx));
  const dh = Math.max(1, Math.round(bounds.h * sy));
  const cx = (bounds.x + bounds.w / 2) * opts.outScale + (random() - 0.5) * 24 * opts.outScale;
  const bottom = (bounds.y + bounds.h) * opts.outScale + (random() - 0.5) * 16 * opts.outScale;
  const ox = Math.round(cx - dw / 2);
  const oy = Math.round(bottom - dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const tx = ox + x;
      const ty = oy + y;
      if (tx < 0 || ty < 0 || tx >= outW || ty >= outH) continue;
      let u = Math.min(bounds.w - 1, Math.floor((x / dw) * bounds.w));
      const v = Math.min(bounds.h - 1, Math.floor((y / dh) * bounds.h));
      if (flip) u = bounds.w - 1 - u;
      const si = ((bounds.y + v) * src.width + bounds.x + u) * 4;
      const d = Math.abs(src.data[si] - bg[0]) + Math.abs(src.data[si + 1] - bg[1]) + Math.abs(src.data[si + 2] - bg[2]);
      if (d <= 30) continue;
      const di = (ty * outW + tx) * 4;
      for (let c = 0; c < 3; c++) out.data[di + c] = Math.max(0, Math.min(255, src.data[si + c] + Math.round((random() - 0.5) * 10)));
    }
  }
  return out;
}

/* ---------------------------------------------------------------- server */

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function readBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function startServer(options = {}) {
  const opts = { ...parseArgs(['', '']), ...options };
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    // Lets public pages (e.g. GitHub Pages) call this local server in Chrome.
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
    try {
      if (req.method === 'GET' && (path === '/health' || path === '/')) {
        send(res, 200, {
          name: 'Sprite8 reference server',
          version: VERSION,
          protocol: 'sprite8/1',
          model: opts.backend === 'mock' ? 'mock (test double — not an AI model)' : 'echo',
          capabilities: ['generate', 'variation', 'analyze'],
        });
        return;
      }
      if (req.method === 'POST' && path === '/generate') {
        const body = JSON.parse(await readBody(req));
        if (body.protocol !== 'sprite8/1') {
          send(res, 400, { error: `Unsupported protocol "${body.protocol}" (expected sprite8/1)` });
          return;
        }
        if (typeof body.sourceImage !== 'string') {
          send(res, 400, { error: 'Missing sourceImage' });
          return;
        }
        if (opts.delay > 0) await new Promise((r) => setTimeout(r, opts.delay));
        const input = fromBase64(body.mode === 'variation' && body.baseImage ? body.baseImage : body.sourceImage);
        if (opts.backend === 'mock') {
          const img = mockRender(input, body, opts);
          send(res, 200, { image: toBase64(img), seed: body.seed, notes: [`mock backend: fake ${body.direction} render (not AI)`] });
        } else {
          send(res, 200, { image: toBase64(input), seed: body.seed, notes: ['echo backend: returned the input unchanged'] });
        }
        return;
      }
      if (req.method === 'POST' && path === '/analyze') {
        const body = JSON.parse(await readBody(req));
        const img = fromBase64(body.image ?? '');
        send(res, 200, {
          notes: [`${opts.backend} backend received a ${img.width}×${img.height} sprite; plug a vision model in here to describe it.`],
        });
        return;
      }
      send(res, 404, { error: `Not found: ${req.method} ${path}` });
    } catch (err) {
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
  return new Promise((resolve) => {
    server.listen(opts.port, opts.host, () => resolve(server));
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.mjs')) {
  const args = parseArgs(process.argv);
  startServer(args).then(() => {
    console.log(`Sprite8 reference server (${args.backend}) listening on http://${args.host}:${args.port}`);
    if (args.backend === 'mock') console.log('NOTE: the mock backend is a test double, not an AI model.');
  });
}
