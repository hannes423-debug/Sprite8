import type { Rgba } from './raster';

/** Packs RGBA into an unsigned 32-bit integer (useful as a Map/Set key). */
export function packRgba(r: number, g: number, b: number, a: number): number {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

export function unpackRgba(n: number): Rgba {
  return { r: (n >>> 24) & 255, g: (n >>> 16) & 255, b: (n >>> 8) & 255, a: n & 255 };
}

function hex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');
}

/** `#rrggbb`, or `#rrggbbaa` when the colour is not fully opaque. */
export function rgbaToHex(c: Rgba, forceAlpha = false): string {
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return forceAlpha || c.a < 255 ? `${base}${hex2(c.a)}` : base;
}

/** Parses `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`. Returns null for invalid input. */
export function hexToRgba(hex: string): Rgba | null {
  const m = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]+$/i.test(m)) return null;
  if (m.length === 3 || m.length === 4) {
    const v = m.split('').map((ch) => parseInt(ch + ch, 16));
    return { r: v[0], g: v[1], b: v[2], a: v.length === 4 ? v[3] : 255 };
  }
  if (m.length === 6 || m.length === 8) {
    const v = [0, 2, 4, 6].map((i) => (i < m.length ? parseInt(m.slice(i, i + 2), 16) : 255));
    return { r: v[0], g: v[1], b: v[2], a: v[3] };
  }
  return null;
}

export function sameColor(a: Rgba, b: Rgba): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

/** Euclidean RGB distance (0 … ~441). Cheap; used for tolerances. */
export function rgbDistance(a: Rgba, b: Rgba): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Relative luminance (0 … 1) using sRGB coefficients on gamma-encoded values. */
export function luma(c: { r: number; g: number; b: number }): number {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export type Oklab = [number, number, number];

/** Converts sRGB (0…255) to OKLab, a perceptually uniform space. */
export function rgbToOklab(r: number, g: number, b: number): Oklab {
  const lr = SRGB_TO_LINEAR[r & 255];
  const lg = SRGB_TO_LINEAR[g & 255];
  const lb = SRGB_TO_LINEAR[b & 255];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabDistanceSq(a: Oklab, b: Oklab): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

export interface Hsl {
  h: number; // 0…360
  s: number; // 0…1
  l: number; // 0…1
}

export function rgbToHsl(c: { r: number; g: number; b: number }): Hsl {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToRgb(hsl: Hsl): Rgba {
  const { h, s, l } = hsl;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v, a: 255 };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (((h % 360) + 360) % 360) / 360;
  const channel = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(channel(hk + 1 / 3) * 255),
    g: Math.round(channel(hk) * 255),
    b: Math.round(channel(hk - 1 / 3) * 255),
    a: 255,
  };
}

/**
 * A short human-readable colour name ("dark red", "light gray", "skin tone").
 * Used to describe the character in AI prompts and in the analysis panel.
 */
export function describeColor(c: { r: number; g: number; b: number }): string {
  const { h, s, l } = rgbToHsl(c);
  if (l < 0.1) return 'black';
  if (l > 0.93) return 'white';
  if (s < 0.14) {
    if (l < 0.3) return 'dark gray';
    if (l < 0.62) return 'gray';
    return 'light gray';
  }
  // Warm, light, moderately saturated colours read as skin tones.
  if (h >= 10 && h < 45 && l > 0.55 && l < 0.88 && s > 0.2 && s <= 0.9) return 'skin tone';
  if (h >= 8 && h < 48 && l < 0.45) return l < 0.22 ? 'dark brown' : 'brown';
  let name: string;
  if (h < 12 || h >= 345) name = 'red';
  else if (h < 40) name = 'orange';
  else if (h < 66) name = 'yellow';
  else if (h < 95) name = 'yellow-green';
  else if (h < 155) name = 'green';
  else if (h < 185) name = 'teal';
  else if (h < 205) name = 'cyan';
  else if (h < 255) name = 'blue';
  else if (h < 290) name = 'purple';
  else if (h < 330) name = 'magenta';
  else name = 'pink';
  if (l < 0.3) return `dark ${name}`;
  if (l > 0.72) return `light ${name}`;
  return name;
}

/** Picks a background colour that is far away from every colour in `avoid`. */
export function pickContrastingBackground(avoid: Rgba[]): Rgba {
  const candidates: Rgba[] = [
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 200, g: 200, b: 200, a: 255 },
    { r: 0, g: 255, b: 0, a: 255 },
    { r: 255, g: 0, b: 255, a: 255 },
    { r: 0, g: 255, b: 255, a: 255 },
  ];
  let best = candidates[0];
  let bestScore = -1;
  for (const cand of candidates) {
    let minD = Infinity;
    for (const c of avoid) minD = Math.min(minD, Math.hypot(cand.r - c.r, cand.g - c.g, cand.b - c.b));
    if (minD > bestScore) {
      bestScore = minD;
      best = cand;
    }
  }
  return { ...best };
}
