import { createRaster, type RasterImage } from '../sprite';
import { directionInfo, type Direction } from '../directions';
import type { CameraAngle, Proportions } from '../character/model';
import {
  CAMERA_TILT,
  KEYPOINT_NAMES,
  poseKeypoints,
  type PoseBody,
  type PoseKeypoint,
} from './skeleton';

/**
 * Renders keypoints the way the OpenPose preprocessor does, so a pose
 * ControlNet (e.g. control_v11p_sd15_openpose) understands the image: black
 * background, one coloured oval per limb, a coloured dot per joint. The
 * colours also tell the network which side is the character's right.
 */

type Rgb = [number, number, number];

/** Limb colours, in OpenPose's limb order. */
const COLORS: Rgb[] = [
  [255, 0, 0],
  [255, 85, 0],
  [255, 170, 0],
  [255, 255, 0],
  [170, 255, 0],
  [85, 255, 0],
  [0, 255, 0],
  [0, 255, 85],
  [0, 255, 170],
  [0, 255, 255],
  [0, 170, 255],
  [0, 85, 255],
  [0, 0, 255],
  [85, 0, 255],
  [170, 0, 255],
  [255, 0, 255],
  [255, 0, 170],
  [255, 0, 85],
];

/** Keypoint index pairs (0-based), in OpenPose's limb order. */
const LIMBS: Array<[number, number]> = [
  [1, 2],
  [1, 5],
  [2, 3],
  [3, 4],
  [5, 6],
  [6, 7],
  [1, 8],
  [8, 9],
  [9, 10],
  [1, 11],
  [11, 12],
  [12, 13],
  [1, 0],
  [0, 14],
  [14, 16],
  [0, 15],
  [15, 17],
];

export interface PoseBox {
  /** Body centre line (pixels). */
  centerX: number;
  /** Ground line = bottom of the feet (pixels, y grows downwards). */
  bottom: number;
  /** Height from the ground line to the top of the head (pixels). */
  height: number;
}

export interface PlacedKeypoint extends PoseKeypoint {
  px: number;
  py: number;
}

export function placeKeypoints(points: PoseKeypoint[], box: PoseBox): PlacedKeypoint[] {
  return points.map((p) => ({
    ...p,
    px: box.centerX + p.x * box.height,
    py: box.bottom - p.y * box.height,
  }));
}

function fillOval(
  rgb: Uint8ClampedArray,
  size: number,
  a: PlacedKeypoint,
  b: PlacedKeypoint,
  halfWidth: number,
  color: Rgb,
): void {
  const cx = (a.px + b.px) / 2;
  const cy = (a.py + b.py) / 2;
  const dx = b.px - a.px;
  const dy = b.py - a.py;
  const half = Math.hypot(dx, dy) / 2;
  const ux = half > 0 ? dx / (2 * half) : 1;
  const uy = half > 0 ? dy / (2 * half) : 0;
  const reach = Math.ceil(Math.max(half, halfWidth)) + 1;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const x1 = Math.min(size - 1, Math.ceil(cx + reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const y1 = Math.min(size - 1, Math.ceil(cy + reach));
  const semiA = Math.max(half, 0.5);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const along = px * ux + py * uy;
      const across = -px * uy + py * ux;
      if ((along * along) / (semiA * semiA) + (across * across) / (halfWidth * halfWidth) <= 1) {
        const i = (y * size + x) * 3;
        rgb[i] = color[0];
        rgb[i + 1] = color[1];
        rgb[i + 2] = color[2];
      }
    }
  }
}

function fillDot(
  rgb: Uint8ClampedArray,
  size: number,
  x: number,
  y: number,
  radius: number,
  color: Rgb,
): void {
  const x0 = Math.max(0, Math.floor(x - radius));
  const x1 = Math.min(size - 1, Math.ceil(x + radius));
  const y0 = Math.max(0, Math.floor(y - radius));
  const y1 = Math.min(size - 1, Math.ceil(y + radius));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if ((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= radius * radius) {
        const i = (yy * size + xx) * 3;
        rgb[i] = color[0];
        rgb[i + 1] = color[1];
        rgb[i + 2] = color[2];
      }
    }
  }
}

/** Draws placed keypoints into a square OpenPose-style guide image (opaque RGBA). */
export function drawPose(points: PlacedKeypoint[], size: number): RasterImage {
  const rgb = new Uint8ClampedArray(size * size * 3);
  const stick = Math.max(2, size / 128);

  // Far limbs first so near limbs stay on top.
  const limbs = LIMBS.map(([a, b], index) => ({ a: points[a], b: points[b], index }))
    .filter(({ a, b }) => a.visible && b.visible)
    .sort((l, m) => (l.a.depth + l.b.depth) / 2 - (m.a.depth + m.b.depth) / 2);
  for (const { a, b, index } of limbs) fillOval(rgb, size, a, b, stick, COLORS[index]);
  // The reference preprocessor dims the limbs before drawing the joints.
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.floor(rgb[i] * 0.6);
  for (const [i, p] of points.entries()) {
    if (p.visible) fillDot(rgb, size, p.px, p.py, stick, COLORS[i]);
  }

  const out = createRaster(size, size);
  for (let i = 0; i < size * size; i++) {
    out.data[i * 4] = rgb[i * 3];
    out.data[i * 4 + 1] = rgb[i * 3 + 1];
    out.data[i * 4 + 2] = rgb[i * 3 + 2];
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

export interface PoseGuideOptions {
  direction: Direction;
  /** Side length of the (square) guide image — the generation canvas size. */
  size: number;
  proportions: PoseBody | Proportions;
  camera?: CameraAngle;
  /** Where the character stands on the canvas; defaults to Sprite8's input layout. */
  box?: PoseBox;
}

/** The guide image for one direction, aligned to where the character stands on the input. */
export function renderPoseGuide(opts: PoseGuideOptions): RasterImage {
  const { size } = opts;
  const box = opts.box ?? { centerX: size / 2, bottom: size * 0.9, height: size * 0.8 };
  const tilt = CAMERA_TILT[opts.camera ?? 'side'];
  const points = placeKeypoints(poseKeypoints(opts.direction, opts.proportions, tilt), box);
  return drawPose(points, size);
}

/**
 * The guide for a generation request: sized like the (square) input image and aligned to where
 * the character stands on it, so the pose lands on the character rather than somewhere else.
 */
export function poseGuideForInput(
  direction: Direction,
  character: { proportions: PoseBody | Proportions; camera?: CameraAngle },
  input: { image: { width: number }; body?: { centerX: number; top: number; bottom: number } },
): RasterImage {
  const { body } = input;
  return renderPoseGuide({
    direction,
    size: input.image.width,
    proportions: character.proportions,
    camera: character.camera,
    box: body
      ? { centerX: body.centerX, bottom: body.bottom, height: body.bottom - body.top }
      : undefined,
  });
}

/** Keypoint lookup by name (handy for tests and debugging). */
export function keypoint<T extends { name: string }>(
  points: T[],
  name: (typeof KEYPOINT_NAMES)[number],
): T {
  const p = points.find((k) => k.name === name);
  if (!p) throw new Error(`Unknown keypoint ${name}`);
  return p;
}

/** Documented here so the direction table and the skeleton cannot drift apart silently. */
export function describeFacing(direction: Direction): string {
  return directionInfo(direction).view;
}
