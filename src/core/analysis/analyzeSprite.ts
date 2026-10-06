import { extentAsymmetry, guessHandedness, type ExtentAsymmetry, type HandednessGuess } from '../asymmetry';
import type { ArtStyle, CameraAngle, CharacterType, ShadingStyle } from '../character/model';
import type { Direction } from '../directions';
import {
  colorHistogram,
  describeColor,
  detectOutline,
  extractPalette,
  rgbToHsl,
  rgbaToHex,
  type PaletteEntry,
  type RasterImage,
} from '../sprite';
import { estimateProportions, type ProportionEstimate } from './proportions';
import { symmetryScore, type SymmetryScore } from './symmetryScore';

export interface Detected<T> {
  value: T;
  /** 0 = not detectable (default shown), 1 = certain. */
  confidence: number;
  reason: string;
}

/** Everything Sprite8 measures about the source sprite before generation. */
export interface SpriteAnalysis {
  version: 1;
  width: number;
  height: number;
  /** Opaque share of the bounding box. */
  coverage: number;
  uniqueColors: number;
  pixelArt: Detected<boolean>;
  palette: string[];
  dominant: Array<{ hex: string; share: number; name: string }>;
  outline: { detected: boolean; color: string | null; thickness: number; share: number };
  shading: Detected<ShadingStyle>;
  artStyle: Detected<ArtStyle>;
  /** Image symmetry plus a verdict that also accounts for one-sided equipment. */
  symmetry: SymmetryScore & { reason: string };
  proportions: ProportionEstimate;
  characterType: Detected<CharacterType>;
  handedness: HandednessGuess;
  extent: ExtentAsymmetry | null;
  sourceDirectionHint: { candidates: Direction[]; reason: string };
  camera: Detected<CameraAngle>;
  notes: string[];
}

export interface AnalyzeOptions {
  sourceDirection: Direction;
  /** Pixel-art decision from the import step (upscale detection is more reliable there). */
  pixelArt?: boolean;
  pixelScale?: number;
}

function estimateShading(palette: PaletteEntry[], uniqueColors: number): Detected<ShadingStyle> {
  if (uniqueColors > 512) {
    return { value: 'soft', confidence: 0.7, reason: `${uniqueColors} distinct colours suggest smooth, painted shading.` };
  }
  const levels = new Map<number, Set<number>>();
  for (const e of palette) {
    const hsl = rgbToHsl(e.color);
    if (hsl.s < 0.15 || hsl.l < 0.08 || hsl.l > 0.92) continue;
    const bin = Math.floor(hsl.h / 30) % 12;
    const set = levels.get(bin) ?? new Set<number>();
    set.add(Math.round(hsl.l / 0.06));
    levels.set(bin, set);
  }
  if (levels.size === 0) return { value: 'flat', confidence: 0.3, reason: 'Mostly neutral colours.' };
  let total = 0;
  for (const s of levels.values()) total += s.size;
  const avg = total / levels.size;
  if (avg <= 1.5) return { value: 'flat', confidence: 0.5, reason: `About ${avg.toFixed(1)} shade(s) per hue.` };
  if (avg <= 4.5) return { value: 'cel', confidence: 0.5, reason: `About ${avg.toFixed(1)} shades per hue (banded shading).` };
  return { value: 'soft', confidence: 0.5, reason: `About ${avg.toFixed(1)} shades per hue (smooth shading).` };
}

function guessCharacterType(p: ProportionEstimate): Detected<CharacterType> {
  const aspect = p.heightPx / Math.max(1, p.widthPx);
  if (p.neckDetected && aspect >= 1.1) {
    return {
      value: 'humanoid',
      confidence: p.legsSeparated ? 0.75 : 0.55,
      reason: `Upright silhouette with a head/neck narrowing${p.legsSeparated ? ' and two legs' : ''}.`,
    };
  }
  if (aspect < 0.85) {
    return { value: 'creature', confidence: 0.3, reason: 'Wide silhouette (creature, quadruped or vehicle?).' };
  }
  return { value: 'humanoid', confidence: 0.3, reason: 'Upright silhouette; no clear neck found.' };
}

/**
 * Deterministic analysis of a trimmed, background-free source sprite.
 * Nothing here uses AI; providers may add a description via analyzeCharacter().
 */
export function analyzeSprite(sprite: RasterImage, opts: AnalyzeOptions): SpriteAnalysis {
  const hist = colorHistogram(sprite);
  const uniqueColors = hist.size;
  let opaque = 0;
  for (const n of hist.values()) opaque += n;
  const coverage = opaque / Math.max(1, sprite.width * sprite.height);
  const palette = extractPalette(sprite, 32);
  const dominant = palette.slice(0, 6).map((e) => ({
    hex: rgbaToHex(e.color),
    share: Math.round((e.count / Math.max(1, opaque)) * 1000) / 1000,
    name: describeColor(e.color),
  }));
  const outline = detectOutline(sprite);
  const shading = estimateShading(palette, uniqueColors);
  const pixelArtValue = opts.pixelArt ?? (uniqueColors <= 256 && Math.max(sprite.width, sprite.height) <= 256);
  const pixelArt: Detected<boolean> = {
    value: pixelArtValue,
    confidence: opts.pixelScale && opts.pixelScale > 1 ? 0.95 : pixelArtValue ? 0.7 : 0.6,
    reason:
      opts.pixelScale && opts.pixelScale > 1
        ? `Upscaled ${opts.pixelScale}× pixel art detected.`
        : pixelArtValue
          ? `Hard edges and ${uniqueColors} colours.`
          : `${uniqueColors} colours with soft edges.`,
  };
  const artStyle: Detected<ArtStyle> = pixelArtValue
    ? { value: 'pixel-art', confidence: pixelArt.confidence, reason: pixelArt.reason }
    : uniqueColors <= 64
      ? { value: 'cartoon', confidence: 0.35, reason: 'Few flat colours.' }
      : { value: 'painted', confidence: 0.35, reason: 'Many colours / soft shading.' };
  const rawSymmetry = symmetryScore(sprite);
  const proportions = estimateProportions(sprite);
  const characterType = guessCharacterType(proportions);
  const handedness = guessHandedness(sprite, opts.sourceDirection);
  const extent = extentAsymmetry(sprite);
  // Thin one-sided items (sticks, spears) hardly change the pixel-area score
  // but make a character asymmetric, so the silhouette's reach counts too.
  const oneSided = !!extent && Math.abs(extent.ratio) >= 0.25;
  const symmetry: SpriteAnalysis['symmetry'] = oneSided
    ? {
        ...rawSymmetry,
        verdict: 'asymmetric',
        reason: `The silhouette reaches ${Math.round(Math.abs(extent!.ratio) * 100)}% further to one side (one-sided equipment?).`,
      }
    : {
        ...rawSymmetry,
        reason:
          rawSymmetry.verdict === 'symmetric'
            ? 'Left and right halves of the image match.'
            : rawSymmetry.verdict === 'asymmetric'
              ? 'Left and right halves of the image differ.'
              : 'Left and right halves are similar but not identical.',
      };

  let sourceDirectionHint: SpriteAnalysis['sourceDirectionHint'];
  if (rawSymmetry.score >= 0.88 && !oneSided) {
    sourceDirectionHint = { candidates: ['S', 'N'], reason: 'The image is mirror-symmetric, typical of a front (S) or back (N) view.' };
  } else if (rawSymmetry.maskScore < 0.6 || oneSided) {
    sourceDirectionHint = {
      candidates: [],
      reason: 'The silhouette is strongly one-sided: a profile/diagonal view or a character with one-sided equipment.',
    };
  } else {
    sourceDirectionHint = { candidates: [], reason: 'The facing direction cannot be measured reliably — please choose it.' };
  }

  const notes: string[] = [];
  if (opts.sourceDirection !== 'S' && opts.sourceDirection !== 'N') {
    notes.push('Symmetry was measured on a non-front/back view, so it says little about the character itself.');
  }
  if (!proportions.measured) notes.push('Body landmarks could not be measured; default proportions are used.');

  return {
    version: 1,
    width: sprite.width,
    height: sprite.height,
    coverage,
    uniqueColors,
    pixelArt,
    palette: palette.map((e) => rgbaToHex(e.color)),
    dominant,
    outline: {
      detected: outline.detected,
      color: outline.color ? rgbaToHex(outline.color) : null,
      thickness: outline.thickness,
      share: outline.share,
    },
    shading,
    artStyle,
    symmetry,
    proportions,
    characterType,
    handedness,
    extent,
    sourceDirectionHint,
    camera: {
      value: 'elevated',
      confidence: 0,
      reason: 'Camera elevation cannot be measured from a single sprite — defaulting to elevated 2.5D. Please confirm.',
    },
    notes,
  };
}
