#!/usr/bin/env node
// Generates the bundled example sprites and app icons (CC0 — see assets/README.md).
//   node scripts/build-example-assets.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../models/reference-server/png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function hex(h) {
  const v = h.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), 255];
}

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data.set(c, (y * this.w + x) * 4);
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    return Array.from(this.data.subarray((y * this.w + x) * 4, (y * this.w + x) * 4 + 4));
  }
  opaque(x, y) {
    return this.get(x, y)[3] > 0;
  }
  rect(x0, y0, x1, y1, c) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
  /** Rectangle with the four corner pixels left out (a rounded look). */
  round(x0, y0, x1, y1, c) {
    this.rect(x0, y0, x1, y1, c);
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) this.data.fill(0, (y * this.w + x) * 4, (y * this.w + x) * 4 + 4);
  }
  line(x0, y0, x1, y1, c, thick = 1) {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      for (let t = 0; t < thick; t++) this.set(x + t, y, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
  /** 1px outline around every opaque area (4-neighbourhood). */
  outline(c) {
    const copy = new Canvas(this.w, this.h);
    copy.data.set(this.data);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (copy.opaque(x, y)) continue;
        if (copy.opaque(x - 1, y) || copy.opaque(x + 1, y) || copy.opaque(x, y - 1) || copy.opaque(x, y + 1)) this.set(x, y, c);
      }
    }
  }
  /** Copy cropped to the opaque bounds plus `pad` transparent pixels. */
  trimmed(pad = 0) {
    let x0 = this.w;
    let y0 = this.h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!this.opaque(x, y)) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    const out = new Canvas(x1 - x0 + 1 + pad * 2, y1 - y0 + 1 + pad * 2);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.set(x - x0 + pad, y - y0 + pad, this.get(x, y));
    return out;
  }
  scaled(k, bg) {
    const out = new Canvas(this.w * k, this.h * k);
    for (let y = 0; y < out.h; y++) {
      for (let x = 0; x < out.w; x++) {
        const c = this.get(Math.floor(x / k), Math.floor(y / k));
        out.set(x, y, c[3] === 0 && bg ? bg : c);
      }
    }
    return out;
  }
  png() {
    return encodePng(this.w, this.h, this.data);
  }
}

function save(rel, canvas) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canvas.png());
  console.log(`wrote ${rel} (${canvas.w}×${canvas.h})`);
}

/* ------------------------------------------------------------------ hockey */
// Front view (facing the viewer = S). Right-handed shot: the stick blade is
// on the character's RIGHT side, which is the viewer's LEFT. The jersey
// number "9" makes any accidental mirroring obvious.
function hockeyPlayer() {
  const P = {
    outline: hex('#1d1b2b'),
    helmet: hex('#2f3548'),
    helmetHi: hex('#4b5675'),
    skin: hex('#f2c48d'),
    skinSh: hex('#d39a64'),
    eye: hex('#1d1b2b'),
    red: hex('#d23b3b'),
    redSh: hex('#9b2433'),
    white: hex('#f4f4f6'),
    whiteSh: hex('#c9ccd8'),
    glove: hex('#6b3f2a'),
    gloveHi: hex('#93573a'),
    pants: hex('#2b2f40'),
    pantsHi: hex('#434a63'),
    boot: hex('#24242c'),
    blade: hex('#c7ced9'),
    wood: hex('#c69a5b'),
    woodSh: hex('#946c3a'),
    tape: hex('#2a2a33'),
  };
  const c = new Canvas(44, 58);
  // Skates
  c.rect(14, 49, 19, 51, P.boot);
  c.rect(24, 49, 29, 51, P.boot);
  c.rect(13, 52, 20, 52, P.blade);
  c.rect(23, 52, 30, 52, P.blade);
  // Socks with stripes
  c.rect(15, 40, 19, 48, P.red);
  c.rect(24, 40, 28, 48, P.red);
  c.rect(15, 43, 19, 44, P.white);
  c.rect(24, 43, 28, 44, P.white);
  c.rect(19, 40, 19, 48, P.redSh);
  c.rect(28, 40, 28, 48, P.redSh);
  // Pants (breezers) with a leg split
  c.rect(14, 32, 29, 39, P.pants);
  c.rect(15, 33, 17, 37, P.pantsHi);
  c.rect(21, 37, 22, 39, [0, 0, 0, 0]);
  // Jersey torso with shoulder pads and hem stripe
  c.rect(13, 17, 30, 31, P.red);
  c.rect(11, 17, 32, 21, P.red);
  c.rect(13, 29, 30, 30, P.white);
  c.rect(13, 31, 30, 31, P.redSh);
  c.rect(28, 22, 30, 28, P.redSh);
  // Number 9 on the chest (3×5)
  for (const [x, y] of [[20, 21], [21, 21], [22, 21], [20, 22], [22, 22], [20, 23], [21, 23], [22, 23], [22, 24], [20, 25], [21, 25], [22, 25]]) c.set(x, y, P.white);
  // Right arm (viewer's left) reaches down to the stick near the knee
  c.rect(9, 18, 12, 30, P.red);
  c.rect(9, 25, 12, 26, P.white);
  c.rect(10, 31, 12, 38, P.redSh);
  // Left arm (viewer's right) bent, holding the top of the stick
  c.rect(31, 18, 34, 26, P.red);
  c.rect(31, 23, 34, 24, P.white);
  // Gloves
  c.round(8, 38, 13, 42, P.glove);
  c.rect(9, 39, 11, 40, P.gloveHi);
  c.round(30, 26, 35, 30, P.glove);
  c.rect(31, 27, 33, 28, P.gloveHi);
  // Neck & head
  c.rect(19, 14, 24, 16, P.skinSh);
  c.round(16, 7, 27, 14, P.skin);
  c.rect(16, 13, 27, 14, P.skinSh);
  c.set(19, 10, P.eye);
  c.set(19, 11, P.eye);
  c.set(24, 10, P.eye);
  c.set(24, 11, P.eye);
  c.rect(20, 13, 23, 13, P.skinSh);
  // Helmet with ear guards
  c.round(15, 1, 28, 7, P.helmet);
  c.rect(15, 7, 16, 11, P.helmet);
  c.rect(27, 7, 28, 11, P.helmet);
  c.rect(18, 2, 22, 3, P.helmetHi);
  // Stick: from the top hand (viewer's right) diagonally to the blade on the viewer's left
  c.line(32, 28, 7, 51, P.wood, 2);
  c.line(33, 29, 8, 52, P.woodSh, 1);
  c.rect(31, 27, 33, 29, P.glove); // top hand over the shaft
  c.round(8, 38, 13, 42, P.glove); // bottom hand over the shaft
  c.rect(9, 39, 11, 40, P.gloveHi);
  // Blade on the ice
  c.rect(1, 50, 8, 52, P.tape);
  c.rect(1, 50, 3, 50, [0, 0, 0, 0]);
  c.outline(P.outline);
  return c.trimmed(0);
}

/* ------------------------------------------------------------------- robot */
// Front view of a symmetric character: every shape is mirrored around x = 22.
function robot() {
  const P = {
    outline: hex('#1a1d26'),
    metal: hex('#a9b3c4'),
    metalHi: hex('#d3dae6'),
    metalSh: hex('#6f7a8e'),
    dark: hex('#3a4152'),
    visor: hex('#3fd6c6'),
    visorHi: hex('#a8f5ec'),
    light: hex('#ff9a3c'),
    lightHi: hex('#ffd29a'),
  };
  const c = new Canvas(44, 52);
  c.rect(21, 1, 22, 4, P.dark);
  c.round(20, 0, 23, 1, P.light);
  c.round(15, 4, 28, 14, P.metal);
  c.rect(16, 5, 27, 5, P.metalHi);
  c.round(17, 7, 26, 10, P.visor);
  c.rect(18, 8, 25, 8, P.visorHi);
  c.rect(15, 13, 28, 14, P.metalSh);
  c.rect(20, 15, 23, 16, P.dark);
  c.round(13, 17, 30, 30, P.metal);
  c.rect(14, 18, 29, 18, P.metalHi);
  c.rect(13, 28, 30, 30, P.metalSh);
  c.round(19, 21, 24, 25, P.dark);
  c.rect(20, 22, 23, 24, P.light);
  c.rect(21, 22, 22, 22, P.lightHi);
  c.rect(8, 18, 11, 28, P.metal);
  c.rect(32, 18, 35, 28, P.metal);
  c.rect(8, 18, 11, 18, P.metalHi);
  c.rect(32, 18, 35, 18, P.metalHi);
  c.round(8, 29, 11, 32, P.dark);
  c.round(32, 29, 35, 32, P.dark);
  c.rect(15, 31, 20, 41, P.metalSh);
  c.rect(23, 31, 28, 41, P.metalSh);
  c.rect(15, 35, 20, 35, P.dark);
  c.rect(23, 35, 28, 35, P.dark);
  c.round(13, 42, 20, 45, P.dark);
  c.round(23, 42, 30, 45, P.dark);
  c.outline(P.outline);
  return c.trimmed(0);
}

/* ------------------------------------------------------------------- icons */
function appIcon() {
  const c = new Canvas(16, 16);
  c.rect(0, 0, 15, 15, hex('#14161b'));
  const accent = hex('#7c9cff');
  const dim = hex('#4a5578');
  c.rect(7, 1, 8, 3, accent);
  c.rect(7, 12, 8, 14, accent);
  c.rect(1, 7, 3, 8, accent);
  c.rect(12, 7, 14, 8, accent);
  for (const [x, y] of [[3, 3], [11, 3], [3, 11], [11, 11]]) c.rect(x, y, x + 1, y + 1, dim);
  c.rect(6, 6, 9, 9, hex('#f4c27a'));
  return c;
}

const hockey = hockeyPlayer();
const bot = robot();
save('assets/examples/hockey-player.png', hockey);
save('assets/examples/robot.png', bot);
// Test fixture: the same sprite upscaled 4× on an opaque white background.
save('tests/fixtures/hockey-player-4x-white.png', hockey.scaled(4, hex('#ffffff')));
save('public/icon-192.png', appIcon().scaled(12));
save('public/icon-512.png', appIcon().scaled(32));
