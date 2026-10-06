import { packRgba, rgbToOklab, oklabDistanceSq, type Oklab } from './color';
import type { RasterImage, Rgba } from './raster';

export interface PaletteEntry {
  color: Rgba;
  count: number;
}

/** Exact opaque colour histogram (alpha ignored, pixels below threshold skipped). */
export function colorHistogram(img: RasterImage, alphaThreshold = 128): Map<number, number> {
  const hist = new Map<number, number>();
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < alphaThreshold) continue;
    const key = packRgba(d[i], d[i + 1], d[i + 2], 255);
    hist.set(key, (hist.get(key) ?? 0) + 1);
  }
  return hist;
}

interface Box {
  entries: PaletteEntry[];
  total: number;
}

function channel(c: Rgba, ch: number): number {
  return ch === 0 ? c.r : ch === 1 ? c.g : c.b;
}

function boxRange(box: Box): { ch: number; range: number } {
  let best = { ch: 0, range: -1 };
  for (let ch = 0; ch < 3; ch++) {
    let lo = 255;
    let hi = 0;
    for (const e of box.entries) {
      const v = channel(e.color, ch);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo > best.range) best = { ch, range: hi - lo };
  }
  return best;
}

/** Weighted median-cut colour reduction. */
export function medianCut(entries: PaletteEntry[], maxColors: number): PaletteEntry[] {
  if (entries.length <= maxColors) return [...entries].sort((a, b) => b.count - a.count);
  const boxes: Box[] = [{ entries: [...entries], total: entries.reduce((s, e) => s + e.count, 0) }];
  while (boxes.length < maxColors) {
    let pick = -1;
    let pickScore = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].entries.length < 2) continue;
      const { range } = boxRange(boxes[i]);
      const score = range * Math.sqrt(boxes[i].total);
      if (score > pickScore) {
        pickScore = score;
        pick = i;
      }
    }
    if (pick < 0) break;
    const box = boxes[pick];
    const { ch } = boxRange(box);
    box.entries.sort((a, b) => channel(a.color, ch) - channel(b.color, ch));
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < box.entries.length - 1; i++) {
      acc += box.entries[i].count;
      if (acc >= box.total / 2) {
        cut = i + 1;
        break;
      }
      cut = i + 1;
    }
    const a = box.entries.slice(0, cut);
    const b = box.entries.slice(cut);
    const sum = (list: PaletteEntry[]) => list.reduce((s, e) => s + e.count, 0);
    boxes.splice(pick, 1, { entries: a, total: sum(a) }, { entries: b, total: sum(b) });
  }
  return boxes
    .map((box) => {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const e of box.entries) {
        r += e.color.r * e.count;
        g += e.color.g * e.count;
        b += e.color.b * e.count;
      }
      return {
        color: {
          r: Math.round(r / box.total),
          g: Math.round(g / box.total),
          b: Math.round(b / box.total),
          a: 255,
        },
        count: box.total,
      };
    })
    .sort((x, y) => y.count - x.count);
}

/**
 * The image's palette: exact colours when there are few of them (pixel art),
 * otherwise a median-cut approximation (painted art).
 */
export function extractPalette(img: RasterImage, maxColors = 32, alphaThreshold = 128): PaletteEntry[] {
  const hist = colorHistogram(img, alphaThreshold);
  const entries: PaletteEntry[] = [];
  for (const [key, count] of hist) {
    entries.push({
      color: { r: (key >>> 24) & 255, g: (key >>> 16) & 255, b: (key >>> 8) & 255, a: 255 },
      count,
    });
  }
  return medianCut(entries, maxColors);
}

/** Maps colours to the perceptually nearest palette entry (OKLab), with caching. */
export class PaletteMapper {
  private readonly lab: Oklab[];
  private readonly cache = new Map<number, number>();
  readonly palette: Rgba[];

  constructor(palette: Rgba[]) {
    if (palette.length === 0) throw new Error('Palette is empty');
    this.palette = palette.map((c) => ({ ...c, a: 255 }));
    this.lab = this.palette.map((c) => rgbToOklab(c.r, c.g, c.b));
  }

  nearestIndex(r: number, g: number, b: number): number {
    const key = (r << 16) | (g << 8) | b;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const lab = rgbToOklab(r, g, b);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.lab.length; i++) {
      const dist = oklabDistanceSq(lab, this.lab[i]);
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    }
    this.cache.set(key, best);
    return best;
  }

  nearest(r: number, g: number, b: number): Rgba {
    return this.palette[this.nearestIndex(r, g, b)];
  }
}

export interface QuantizeOptions {
  /** Snap alpha to 0/255 (pixel art). */
  binarizeAlpha?: boolean;
  alphaThreshold?: number;
}

/** Replaces every opaque colour with its nearest palette colour. */
export function quantizeToPalette(img: RasterImage, palette: Rgba[], opts: QuantizeOptions = {}): RasterImage {
  const mapper = new PaletteMapper(palette);
  const threshold = opts.alphaThreshold ?? 128;
  const out: RasterImage = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 0 || (opts.binarizeAlpha && a < threshold)) {
      d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
      continue;
    }
    const c = mapper.nearest(d[i], d[i + 1], d[i + 2]);
    d[i] = c.r;
    d[i + 1] = c.g;
    d[i + 2] = c.b;
    if (opts.binarizeAlpha) d[i + 3] = 255;
  }
  return out;
}

/** Fraction of opaque pixels whose colour is exactly in `palette`. */
export function paletteCoverage(img: RasterImage, palette: Rgba[], alphaThreshold = 128): number {
  const keys = new Set(palette.map((c) => packRgba(c.r, c.g, c.b, 255)));
  let total = 0;
  let inside = 0;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < alphaThreshold) continue;
    total++;
    if (keys.has(packRgba(d[i], d[i + 1], d[i + 2], 255))) inside++;
  }
  return total === 0 ? 1 : inside / total;
}
