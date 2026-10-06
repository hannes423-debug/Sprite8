import type { BodyPart, AnatomyPart, Proportions } from '../character/model';
import { rowCoverage, runsInRow, type RasterImage, type Rect } from '../sprite';

export interface ProportionEstimate extends Proportions {
  neckDetected: boolean;
  legsSeparated: boolean;
}

function smooth(values: Int32Array, radius: number): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let n = 0;
    for (let k = i - radius; k <= i + radius; k++) {
      if (k < 0 || k >= values.length) continue;
      sum += values[k];
      n++;
    }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

function argMax(v: Float64Array, from: number, to: number): number {
  let best = from;
  for (let i = from; i <= to; i++) if (v[i] > v[best]) best = i;
  return best;
}

/**
 * Estimates body landmarks from the silhouette's width profile. These are
 * approximations for guides and prompts — the user can correct them.
 * Expects a trimmed sprite (content touches all four edges).
 */
export function estimateProportions(sprite: RasterImage): ProportionEstimate {
  const h = sprite.height;
  const w = sprite.width;
  const fallback: ProportionEstimate = {
    heightPx: h,
    widthPx: w,
    neckY: 0.25,
    shoulderY: 0.3,
    hipY: 0.58,
    kneeY: 0.79,
    headsTall: 4,
    measured: false,
    neckDetected: false,
    legsSeparated: false,
  };
  if (h < 8 || w < 3) return fallback;
  // Smooth only larger (painted) sprites; in pixel art a 1–2 row neck is real.
  const profile = smooth(rowCoverage(sprite), h >= 100 ? Math.round(h * 0.015) : 0);
  const clampRow = (f: number) => Math.max(0, Math.min(h - 1, Math.round(f * (h - 1))));

  // Neck: scanning down, the first clear narrowing (≤ 80% of the widest row
  // above it) that widens again into shoulders.
  let neckRow = -1;
  let shoulderRow = -1;
  let headMax = 0;
  for (let y = 0; y <= clampRow(0.45) && neckRow < 0; y++) {
    headMax = Math.max(headMax, profile[y]);
    if (y < clampRow(0.06) || profile[y] > headMax * 0.8) continue;
    let ny = y;
    while (ny + 1 < h && profile[ny + 1] <= profile[ny]) ny++;
    const lookEnd = Math.min(h - 1, ny + Math.max(2, Math.round(h * 0.25)));
    const widest = argMax(profile, ny, lookEnd);
    if (profile[widest] >= profile[ny] * 1.15 && ny <= clampRow(0.5)) {
      neckRow = ny;
      shoulderRow = widest;
    } else {
      y = ny;
    }
  }
  const neckDetected = neckRow > 0;

  // Legs: rows in the lower body that split into two or more runs.
  const split = new Uint8Array(h);
  for (let y = clampRow(0.4); y <= clampRow(0.95); y++)
    split[y] = runsInRow(sprite, y, 1) >= 2 ? 1 : 0;
  let lowerRows = 0;
  let splitRows = 0;
  for (let y = clampRow(0.65); y <= clampRow(0.95); y++) {
    lowerRows++;
    splitRows += split[y];
  }
  const legsSeparated = lowerRows > 0 && splitRows / lowerRows >= 0.4;
  let crotchRow: number | null = null;
  if (legsSeparated) {
    // First row from which ≥ 80% of the rows down to 90% height are split.
    const end = clampRow(0.9);
    let suffix = 0;
    const splitFrom = new Float64Array(h + 1);
    for (let y = end; y >= clampRow(0.4); y--) {
      suffix += split[y];
      splitFrom[y] = suffix / (end - y + 1);
    }
    for (let y = clampRow(0.4); y <= clampRow(0.85); y++) {
      if (split[y] && splitFrom[y] >= 0.8) {
        crotchRow = y;
        break;
      }
    }
  }

  const neckY = neckDetected ? neckRow / h : fallback.neckY;
  const shoulderY = neckDetected ? Math.max(neckY + 0.01, shoulderRow / h) : neckY + 0.05;
  const hipY =
    crotchRow !== null
      ? Math.max(shoulderY + 0.05, crotchRow / h - 0.03)
      : neckY + (1 - neckY) * 0.45;
  const kneeY = hipY + (1 - hipY) * 0.5;
  return {
    heightPx: h,
    widthPx: w,
    neckY,
    shoulderY,
    hipY,
    kneeY,
    headsTall: Math.round((1 / Math.max(0.05, neckY)) * 10) / 10,
    measured: neckDetected,
    neckDetected,
    legsSeparated,
  };
}

function rowsBounds(sprite: RasterImage, y0: number, y1: number): Rect | null {
  let minX = sprite.width;
  let maxX = -1;
  for (let y = Math.max(0, y0); y < Math.min(sprite.height, y1); y++) {
    for (let x = 0; x < sprite.width; x++) {
      if (sprite.data[(y * sprite.width + x) * 4 + 3] > 127) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  if (maxX < 0) return null;
  return {
    x: minX,
    y: Math.max(0, y0),
    width: maxX - minX + 1,
    height: Math.min(sprite.height, y1) - Math.max(0, y0),
  };
}

/** Rough body-part regions (head, torso, legs, feet) from the landmarks. */
export function estimateAnatomy(
  sprite: RasterImage,
  p: Proportions,
): Record<AnatomyPart, BodyPart> {
  const h = sprite.height;
  const row = (f: number) => Math.round(f * h);
  const feetTop = Math.max(row(p.kneeY) + 1, h - Math.max(1, Math.round(h * 0.08)));
  return {
    head: { description: '', region: rowsBounds(sprite, 0, row(p.neckY)) },
    torso: { description: '', region: rowsBounds(sprite, row(p.neckY), row(p.hipY)) },
    arms: { description: '', region: null },
    hands: { description: '', region: null },
    legs: { description: '', region: rowsBounds(sprite, row(p.hipY), feetTop) },
    feet: { description: '', region: rowsBounds(sprite, feetTop, h) },
  };
}
