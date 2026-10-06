import { createRaster, type RasterImage, type Rgba } from '../sprite';
import { CAMERA_TILT, poseKeypoints } from './skeleton';
import { placeKeypoints, type PoseGuideOptions } from './render';

/**
 * Repaint mask — where the character may be drawn.
 *
 * Small image models like to paint a whole scene around the character (an ice rink, mountains),
 * and a scene cannot be separated from the character afterwards. A latent noise mask lets the
 * sampler repaint only this region; everything outside keeps the source's flat background, which
 * the consistency pipeline can remove.
 *
 * The region is the convex hull of the pose skeleton (so the arms and legs of the NEW view fit),
 * inflated to leave room for hair, clothing and held items. When an existing view is being varied
 * its silhouette is added, so no ghost of the old pose is left outside the region.
 */
export interface RepaintMaskOptions extends PoseGuideOptions {
  /** An existing view whose character silhouette is added to the region (variations). */
  source?: { image: RasterImage; background: Rgba };
  /** Extra room around the skeleton, in body heights (default 0.12). */
  inflate?: number;
}

type P = { x: number; y: number };

function cross(o: P, a: P, b: P): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Andrew's monotone chain; counter-clockwise (in a y-up frame) without repeated points. */
export function convexHull(points: P[]): P[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: P[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: P[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function distToSegment(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Separable square max-filter (dilation) on a 0/1 mask. */
function dilate(mask: Uint8Array, size: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let on = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(size - 1, x + radius) && !on; k++)
        on = mask[y * size + k];
      tmp[y * size + x] = on;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let on = 0;
      for (let k = Math.max(0, y - radius); k <= Math.min(size - 1, y + radius) && !on; k++)
        on = tmp[k * size + x];
      out[y * size + x] = on;
    }
  }
  return out;
}

/** Pixels that differ from the plain background colour (the character on a prepared input). */
export function foregroundMask(
  image: RasterImage,
  background: Rgba,
  tolerance = 28,
): { mask: Uint8Array; count: number } {
  const mask = new Uint8Array(image.width * image.height);
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    const d = Math.max(
      Math.abs(image.data[o] - background.r),
      Math.abs(image.data[o + 1] - background.g),
      Math.abs(image.data[o + 2] - background.b),
    );
    if (image.data[o + 3] > 0 && d > tolerance) {
      mask[i] = 1;
      count++;
    }
  }
  return { mask, count };
}

/** White where the sampler may repaint, black elsewhere (opaque RGBA, square). */
export function renderRepaintMask(opts: RepaintMaskOptions): RasterImage {
  const { size } = opts;
  const box = opts.box ?? { centerX: size / 2, bottom: size * 0.9, height: size * 0.8 };
  const tilt = CAMERA_TILT[opts.camera ?? 'side'];
  const placed = placeKeypoints(poseKeypoints(opts.direction, opts.proportions, tilt), box);
  const radius = (opts.inflate ?? 0.12) * box.height;

  // Hull of the skeleton plus the top of the head and the ground under the feet.
  const head = placed[0];
  const pts: P[] = placed.map((k) => ({ x: k.px, y: k.py }));
  pts.push({ x: head.px, y: box.bottom - box.height });
  pts.push({ x: box.centerX, y: box.bottom });
  const hull = convexHull(pts);

  const mask = new Uint8Array(size * size);
  const inside = (p: P): boolean => {
    // The hull is counter-clockwise in a y-up frame, so inside means "left of every edge".
    let all = true;
    for (let i = 0; i < hull.length && all; i++)
      all = cross(hull[i], hull[(i + 1) % hull.length], p) >= 0;
    return all;
  };
  const reach = Math.ceil(radius);
  const x0 = Math.max(0, Math.floor(Math.min(...hull.map((h) => h.x)) - reach));
  const x1 = Math.min(size - 1, Math.ceil(Math.max(...hull.map((h) => h.x)) + reach));
  const y0 = Math.max(0, Math.floor(Math.min(...hull.map((h) => h.y)) - reach));
  const y1 = Math.min(size - 1, Math.ceil(Math.max(...hull.map((h) => h.y)) + reach));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = { x: x + 0.5, y: y + 0.5 };
      let hit = hull.length >= 3 && inside(p);
      for (let i = 0; i < hull.length && !hit; i++)
        hit = distToSegment(p, hull[i], hull[(i + 1) % hull.length]) <= radius;
      if (hit) mask[y * size + x] = 1;
    }
  }

  if (opts.source && opts.source.image.width === size && opts.source.image.height === size) {
    const { mask: fg } = foregroundMask(opts.source.image, opts.source.background);
    const grown = dilate(fg, size, Math.max(1, Math.round(0.02 * box.height)));
    for (let i = 0; i < mask.length; i++) if (grown[i]) mask[i] = 1;
  }

  const out = createRaster(size, size);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 255 : 0;
    out.data[i * 4] = v;
    out.data[i * 4 + 1] = v;
    out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** The mask for a generation request (see `poseGuideForInput`). */
export function repaintMaskForInput(
  direction: PoseGuideOptions['direction'],
  character: Pick<PoseGuideOptions, 'proportions' | 'camera'>,
  input: {
    image: RasterImage;
    background: Rgba;
    body?: { centerX: number; top: number; bottom: number };
  },
  opts: { wholeImage?: boolean; includeSilhouette?: boolean } = {},
): RasterImage {
  const size = input.image.width;
  if (opts.wholeImage) {
    const all = createRaster(size, size);
    for (let i = 0; i < all.data.length; i++) all.data[i] = 255;
    return all;
  }
  const { body } = input;
  return renderRepaintMask({
    direction,
    size,
    proportions: character.proportions,
    camera: character.camera,
    box: body
      ? { centerX: body.centerX, bottom: body.bottom, height: body.bottom - body.top }
      : undefined,
    source: opts.includeSilhouette
      ? { image: input.image, background: input.background }
      : undefined,
  });
}
