import {
  blitInPlace,
  createRaster,
  findFeet,
  rgbDistance,
  scaleNearest,
  scaleSmooth,
  trim,
  type RasterImage,
  type Rgba,
} from '../sprite';

export interface PreparedInput {
  /** Square image handed to the provider (flattened onto `background`). */
  image: RasterImage;
  /** Provider pixels per working pixel. */
  scale: number;
  background: Rgba;
  backgroundName: string;
}

const BACKGROUNDS: Array<{ color: Rgba; name: string }> = [
  { color: { r: 255, g: 255, b: 255, a: 255 }, name: 'white' },
  { color: { r: 214, g: 214, b: 214, a: 255 }, name: 'light gray' },
  { color: { r: 128, g: 128, b: 128, a: 255 }, name: 'gray' },
];

/** Picks the plain background that contrasts most with the character's main colours. */
export function chooseInputBackground(dominant: Array<{ color: Rgba; share: number }>): {
  color: Rgba;
  name: string;
} {
  const relevant = dominant.filter((d) => d.share >= 0.02).map((d) => d.color);
  let best = BACKGROUNDS[0];
  let bestScore = -1;
  for (const bg of BACKGROUNDS) {
    const minD = relevant.length ? Math.min(...relevant.map((c) => rgbDistance(c, bg.color))) : 999;
    // Prefer white unless a character colour is really close to it.
    const score = bg === BACKGROUNDS[0] ? minD + 40 : minD;
    if (score > bestScore) {
      bestScore = score;
      best = bg;
    }
  }
  return { color: { ...best.color }, name: best.name };
}

/**
 * Places a sprite on a square canvas for an image model: scaled up (integer
 * nearest-neighbour for pixel art), feet centred, flattened onto a plain
 * background. `fill` is the fraction of the canvas the sprite may occupy.
 */
export function prepareProviderInput(
  sprite: RasterImage,
  size: number,
  opts: { pixelArt: boolean; background: { color: Rgba; name: string }; fill?: number },
): PreparedInput {
  const fill = opts.fill ?? 0.8;
  const trimmed = trim(sprite, 16)?.image ?? sprite;
  const maxSide = Math.max(1, trimmed.width, trimmed.height);
  let scale: number;
  let scaled: RasterImage;
  if (opts.pixelArt) {
    scale = Math.max(1, Math.floor((size * fill) / maxSide));
    scaled = scaleNearest(trimmed, trimmed.width * scale, trimmed.height * scale);
  } else {
    scale = (size * fill) / maxSide;
    scaled = scaleSmooth(
      trimmed,
      Math.round(trimmed.width * scale),
      Math.round(trimmed.height * scale),
    );
  }
  const out = createRaster(size, size, opts.background.color);
  const feet = findFeet(scaled);
  const dx = Math.round(size / 2 - (feet?.feetX ?? scaled.width / 2));
  const bottom = Math.round(size * (1 - (1 - fill) / 2));
  const dy = bottom - scaled.height;
  blitInPlace(out, scaled, dx, dy, 'over');
  return {
    image: out,
    scale,
    background: opts.background.color,
    backgroundName: opts.background.name,
  };
}
