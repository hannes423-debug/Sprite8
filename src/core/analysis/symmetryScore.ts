import { scaleNearest, type RasterImage } from '../sprite';

export interface SymmetryScore {
  /** Combined score 0…1 (1 = perfect mirror symmetry in the image). */
  score: number;
  /** Silhouette IoU between the image and its mirror. */
  maskScore: number;
  /** Fraction of mirrored opaque pixel pairs with similar colours. */
  colorScore: number;
  /** Best mirror axis (continuous x, source pixels). */
  axisX: number;
  verdict: 'symmetric' | 'asymmetric' | 'uncertain';
}

/**
 * Measures left/right mirror symmetry of the image itself. This only tells
 * you something about the CHARACTER for front (S) and back (N) views: a
 * symmetric character seen in profile is not mirror-symmetric on screen.
 */
export function symmetryScore(img: RasterImage, alphaThreshold = 127): SymmetryScore {
  const maxW = 256;
  const scale = img.width > maxW ? maxW / img.width : 1;
  const src = scale < 1 ? scaleNearest(img, Math.round(img.width * scale), Math.max(1, Math.round(img.height * scale))) : img;
  const { width: w, height: h, data: d } = src;
  const opaque = (x: number, y: number) => d[(y * w + x) * 4 + 3] > alphaThreshold;
  const empty: SymmetryScore = { score: 0, maskScore: 0, colorScore: 0, axisX: img.width / 2, verdict: 'uncertain' };
  if (w === 0 || h === 0) return empty;

  let bestAxis = w / 2;
  let bestIou = -1;
  const span = Math.max(1, Math.round(w * 0.15));
  for (let twoA = Math.round(w - 2 * span); twoA <= Math.round(w + 2 * span); twoA++) {
    let inter = 0;
    let union = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = opaque(x, y);
        const mx = twoA - x - 1;
        const b = mx >= 0 && mx < w && opaque(mx, y);
        if (a && b) inter++;
        if (a || b) union++;
      }
    }
    const iou = union ? inter / union : 0;
    if (iou > bestIou + 1e-9 || (Math.abs(iou - bestIou) <= 1e-9 && Math.abs(twoA / 2 - w / 2) < Math.abs(bestAxis - w / 2))) {
      bestIou = iou;
      bestAxis = twoA / 2;
    }
  }
  let pairs = 0;
  let similar = 0;
  const twoA = Math.round(bestAxis * 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const mx = twoA - x - 1;
      if (mx <= x || mx >= w) continue; // each pair once
      if (!opaque(x, y) || !opaque(mx, y)) continue;
      pairs++;
      const i = (y * w + x) * 4;
      const j = (y * w + mx) * 4;
      const dist = Math.hypot(d[i] - d[j], d[i + 1] - d[j + 1], d[i + 2] - d[j + 2]);
      if (dist < 48) similar++;
    }
  }
  const maskScore = Math.max(0, bestIou);
  const colorScore = pairs ? similar / pairs : 0;
  const score = 0.5 * maskScore + 0.5 * colorScore;
  const verdict = score >= 0.88 ? 'symmetric' : score < 0.75 ? 'asymmetric' : 'uncertain';
  return { score, maskScore, colorScore, axisX: bestAxis / scale, verdict };
}
