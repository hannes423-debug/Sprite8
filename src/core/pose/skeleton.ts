import { directionInfo, type Direction } from '../directions';
import type { CameraAngle, Proportions } from '../character/model';

/**
 * Pose System — a simple 3D stick-figure that is turned to face each of the
 * eight directions and flattened to an OpenPose-style keypoint set.
 *
 * Why: an image model cannot be asked "show the back of this character"
 * reliably, but a pose ControlNet can be told exactly where the head, the
 * shoulders and the two hands must be. The skeleton is deterministic — it is
 * built from the proportions Sprite8 measured on the source sprite and the
 * same direction geometry as the asymmetry system — and it keeps the
 * character's RIGHT side right: right-side keypoints carry the right-side
 * colours in the guide image and swap screen sides exactly as the table in
 * `core/asymmetry/sides.ts` says.
 *
 * It is a guide, not an animation rig: a neutral standing pose with the arms
 * hanging at the sides. Equipment and clothing come from the source image and
 * the prompt, not from the skeleton.
 */

/** OpenPose "COCO-18" keypoint order; "right"/"left" are the CHARACTER's sides. */
export const KEYPOINT_NAMES = [
  'nose',
  'neck',
  'rightShoulder',
  'rightElbow',
  'rightWrist',
  'leftShoulder',
  'leftElbow',
  'leftWrist',
  'rightHip',
  'rightKnee',
  'rightAnkle',
  'leftHip',
  'leftKnee',
  'leftAnkle',
  'rightEye',
  'leftEye',
  'rightEar',
  'leftEar',
] as const;
export type KeypointName = (typeof KEYPOINT_NAMES)[number];

/** Body landmarks as fractions of the total height, measured from the TOP (like `Proportions`). */
export type PoseBody = Pick<Proportions, 'neckY' | 'shoulderY' | 'hipY' | 'kneeY' | 'headsTall'>;

export interface PoseKeypoint {
  name: KeypointName;
  /** Horizontal position in body heights from the body centre (+ = screen right). */
  x: number;
  /** Height above the ground in body heights (0 = feet, 1 = top of the head). */
  y: number;
  /** Nearness to the camera (+ = toward the camera), in body heights. */
  depth: number;
  /** False when the point faces away from the camera (e.g. the nose in a back view). */
  visible: boolean;
}

/** Camera tilt (radians): how far the camera looks down on the character. */
export const CAMERA_TILT: Record<CameraAngle, number> = {
  side: 0,
  elevated: 0.35,
  isometric: 0.52,
  'top-down': 0.9,
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Measured proportions can be noisy; the skeleton only needs a plausible ordering. */
export function sanitizeBody(body: PoseBody): PoseBody {
  const headsTall = clamp(Number.isFinite(body.headsTall) ? body.headsTall : 4, 1.5, 10);
  const neckY = clamp(Number.isFinite(body.neckY) ? body.neckY : 1 / headsTall, 0.06, 0.45);
  const shoulderY = clamp(
    Number.isFinite(body.shoulderY) ? body.shoulderY : neckY + 0.05,
    neckY + 0.02,
    0.6,
  );
  const hipY = clamp(Number.isFinite(body.hipY) ? body.hipY : 0.55, shoulderY + 0.1, 0.8);
  const kneeY = clamp(Number.isFinite(body.kneeY) ? body.kneeY : 0.78, hipY + 0.06, 0.95);
  return { headsTall, neckY, shoulderY, hipY, kneeY };
}

const FACE_EYE_TURN = (35 * Math.PI) / 180;

/**
 * Keypoints of the skeleton turned to face `direction`.
 * @param tilt camera tilt in radians (see `CAMERA_TILT`).
 */
export function poseKeypoints(direction: Direction, body: PoseBody, tilt = 0): PoseKeypoint[] {
  const b = sanitizeBody(body);
  const f = directionInfo(direction).facing;
  // The character's right side points along r; "toward the camera" is −y.
  const r = { x: f.y, y: -f.x };

  const headH = Math.min(1 / b.headsTall, b.neckY * 1.05);
  const headCenter = 1 - headH / 2;
  const shoulderU = 1 - b.shoulderY;
  const neckU = 1 - (b.neckY + b.shoulderY) / 2;
  const hipU = 1 - b.hipY;
  const kneeU = 1 - b.kneeY;
  const ankleU = 0.035;
  const torso = shoulderU - hipU;
  const armLength = Math.min(torso * 1.2, shoulderU - 0.12);
  const shoulderHalf = headH * (0.55 + 0.045 * b.headsTall);
  const hipHalf = shoulderHalf * 0.5;
  // A small natural stride (right leg forward, left arm forward) so that in profile the near and
  // far limbs do not collapse onto one line. It is invisible from the front and the back.
  const stride = 0.035;

  // Character-local points: [right offset, height, forward offset].
  const local: Record<KeypointName, [number, number, number]> = {
    nose: [0, headCenter - 0.08 * headH, 0.5 * headH],
    neck: [0, neckU, 0],
    rightShoulder: [shoulderHalf, shoulderU, 0],
    rightElbow: [shoulderHalf * 1.1, shoulderU - armLength / 2, -stride / 2],
    rightWrist: [shoulderHalf * 1.2, shoulderU - armLength, -stride],
    leftShoulder: [-shoulderHalf, shoulderU, 0],
    leftElbow: [-shoulderHalf * 1.1, shoulderU - armLength / 2, stride / 2],
    leftWrist: [-shoulderHalf * 1.2, shoulderU - armLength, stride],
    rightHip: [hipHalf, hipU, 0],
    rightKnee: [hipHalf, kneeU, stride / 2],
    rightAnkle: [hipHalf * 1.05, ankleU, stride],
    leftHip: [-hipHalf, hipU, 0],
    leftKnee: [-hipHalf, kneeU, -stride / 2],
    leftAnkle: [-hipHalf * 1.05, ankleU, -stride],
    rightEye: [0.2 * headH, headCenter + 0.1 * headH, 0.38 * headH],
    leftEye: [-0.2 * headH, headCenter + 0.1 * headH, 0.38 * headH],
    rightEar: [0.45 * headH, headCenter, -0.05 * headH],
    leftEar: [-0.45 * headH, headCenter, -0.05 * headH],
  };

  // How much a surface with the given world normal faces the camera (south).
  const facing = (ny: number): number => -ny;
  const c = Math.cos(FACE_EYE_TURN);
  const s = Math.sin(FACE_EYE_TURN);
  const visibleFace: Partial<Record<KeypointName, boolean>> = {
    nose: facing(f.y) >= -0.05,
    // Eyes sit on the face turned slightly outwards; the far eye disappears in profile.
    rightEye: facing(f.y * c + r.y * s) > 0.02,
    leftEye: facing(f.y * c - r.y * s) > 0.02,
    // Ears face sideways: visible when that side is not turned away.
    rightEar: facing(r.y) >= -0.15,
    leftEar: facing(-r.y) >= -0.15,
  };

  return KEYPOINT_NAMES.map((name) => {
    const [right, up, forward] = local[name];
    const wx = right * r.x + forward * f.x;
    const wy = right * r.y + forward * f.y;
    return {
      name,
      x: wx,
      // Looking down on the scene, points further away appear higher on screen.
      y: up + wy * Math.sin(tilt),
      depth: -wy,
      visible: visibleFace[name] ?? true,
    };
  });
}
