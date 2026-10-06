import { describe, expect, it } from 'vitest';
import { DIRECTIONS } from '../../src/core/directions';
import {
  CAMERA_TILT,
  KEYPOINT_NAMES,
  convexHull,
  keypoint,
  placeKeypoints,
  poseKeypoints,
  renderPoseGuide,
  renderRepaintMask,
  repaintMaskForInput,
  sanitizeBody,
  type PoseBody,
} from '../../src/core/pose';
import { createRaster } from '../../src/core/sprite';
import { sidePlacement } from '../../src/core/asymmetry';

const BODY: PoseBody = { neckY: 0.2, shoulderY: 0.26, hipY: 0.55, kneeY: 0.77, headsTall: 4 };

describe('pose skeleton', () => {
  it('has the 18 OpenPose keypoints for every direction', () => {
    for (const d of DIRECTIONS) {
      const pts = poseKeypoints(d, BODY);
      expect(pts.map((p) => p.name)).toEqual([...KEYPOINT_NAMES]);
    }
  });

  it('puts the feet on the ground and the head at the top', () => {
    const pts = poseKeypoints('S', BODY);
    expect(keypoint(pts, 'rightAnkle').y).toBeLessThan(0.06);
    const head = Math.max(...pts.map((p) => p.y));
    expect(head).toBeGreaterThan(0.85);
    expect(head).toBeLessThanOrEqual(1);
  });

  it("keeps the character's right side where the asymmetry system says it is", () => {
    // Screen side of the right shoulder relative to the left one, in every view.
    for (const d of DIRECTIONS) {
      const pts = poseKeypoints(d, BODY);
      const dx = keypoint(pts, 'rightShoulder').x - keypoint(pts, 'leftShoulder').x;
      const dDepth = keypoint(pts, 'rightShoulder').depth - keypoint(pts, 'leftShoulder').depth;
      const side = sidePlacement(d, 'right');
      if (side.screen === 'left') expect(dx, d).toBeLessThan(-0.05);
      if (side.screen === 'right') expect(dx, d).toBeGreaterThan(0.05);
      if (side.screen === 'center') expect(Math.abs(dx), d).toBeLessThan(0.01);
      if (side.placement === 'near') expect(dDepth, d).toBeGreaterThan(0.01);
      if (side.placement === 'far') expect(dDepth, d).toBeLessThan(-0.01);
    }
  });

  it('is never a mirror image of the opposite side (right stays right)', () => {
    const e = poseKeypoints('E', BODY);
    const w = poseKeypoints('W', BODY);
    // In E the right wrist is the near one; in W it is the far one.
    expect(keypoint(e, 'rightWrist').depth).toBeGreaterThan(keypoint(e, 'leftWrist').depth);
    expect(keypoint(w, 'rightWrist').depth).toBeLessThan(keypoint(w, 'leftWrist').depth);
  });

  it('hides the face in back views and the far eye and ear in profile', () => {
    const vis = (d: (typeof DIRECTIONS)[number], n: (typeof KEYPOINT_NAMES)[number]) =>
      keypoint(poseKeypoints(d, BODY), n).visible;
    for (const d of ['N', 'NE', 'NW'] as const) {
      expect(vis(d, 'nose'), d).toBe(false);
      expect(vis(d, 'rightEye'), d).toBe(false);
      expect(vis(d, 'leftEye'), d).toBe(false);
    }
    for (const d of ['S', 'SE', 'SW'] as const) expect(vis(d, 'nose'), d).toBe(true);
    expect(vis('S', 'rightEye') && vis('S', 'leftEye')).toBe(true);
    // Facing east: the right side is near, the left side hidden.
    expect(vis('E', 'nose')).toBe(true);
    expect(vis('E', 'rightEye')).toBe(true);
    expect(vis('E', 'leftEye')).toBe(false);
    expect(vis('E', 'rightEar')).toBe(true);
    expect(vis('E', 'leftEar')).toBe(false);
    expect(vis('W', 'leftEar')).toBe(true);
    expect(vis('W', 'rightEar')).toBe(false);
    // Front and back both show both ears.
    expect(vis('S', 'rightEar') && vis('S', 'leftEar')).toBe(true);
    expect(vis('N', 'rightEar') && vis('N', 'leftEar')).toBe(true);
  });

  it('narrows in profile and is widest from the front and back', () => {
    const width = (d: (typeof DIRECTIONS)[number]) => {
      const xs = poseKeypoints(d, BODY).map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(width('E')).toBeLessThan(width('S') * 0.5);
    expect(width('N')).toBeCloseTo(width('S'), 5);
    expect(width('NE')).toBeLessThan(width('N'));
  });

  it('raises distant points when the camera looks down', () => {
    const flat = poseKeypoints('E', BODY, CAMERA_TILT.side);
    const tilted = poseKeypoints('E', BODY, CAMERA_TILT.elevated);
    const gap = (pts: typeof flat) => keypoint(pts, 'rightWrist').y - keypoint(pts, 'leftWrist').y;
    // Facing east the right wrist is the near one: level from the side, lower when seen from above.
    expect(gap(flat)).toBeCloseTo(0, 6);
    expect(gap(tilted)).toBeLessThan(-0.05);
  });

  it('repairs implausible measurements instead of producing nonsense', () => {
    const b = sanitizeBody({ neckY: 0.9, shoulderY: 0.1, hipY: 0.2, kneeY: 0.1, headsTall: 0 });
    expect(b.neckY).toBeLessThan(b.shoulderY);
    expect(b.shoulderY).toBeLessThan(b.hipY);
    expect(b.hipY).toBeLessThan(b.kneeY);
    expect(b.headsTall).toBeGreaterThanOrEqual(1.5);
    const nan = sanitizeBody({ neckY: NaN, shoulderY: NaN, hipY: NaN, kneeY: NaN, headsTall: NaN });
    expect(Object.values(nan).every(Number.isFinite)).toBe(true);
  });
});

describe('pose guide image', () => {
  const size = 256;
  const at = (img: { data: Uint8ClampedArray; width: number }, x: number, y: number) => {
    const i = (Math.round(y) * img.width + Math.round(x)) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };

  it('is an opaque, mostly black image with coloured limbs', () => {
    const img = renderPoseGuide({ direction: 'S', size, proportions: BODY });
    expect(img.width).toBe(size);
    let lit = 0;
    for (let i = 0; i < size * size; i++) {
      expect(img.data[i * 4 + 3]).toBe(255);
      if (img.data[i * 4] + img.data[i * 4 + 1] + img.data[i * 4 + 2] > 0) lit++;
    }
    expect(lit).toBeGreaterThan(300);
    expect(lit / (size * size)).toBeLessThan(0.15);
  });

  it('draws each joint dot at its placed position in its OpenPose colour', () => {
    const box = { centerX: 128, bottom: 230, height: 200 };
    const img = renderPoseGuide({ direction: 'S', size, proportions: BODY, box });
    const pts = poseKeypoints('S', BODY);
    const px = (n: (typeof KEYPOINT_NAMES)[number]) => {
      const p = keypoint(pts, n);
      return [box.centerX + p.x * box.height, box.bottom - p.y * box.height] as const;
    };
    // Neck = colour index 1 (255,85,0); right shoulder = index 2 (255,170,0).
    expect(at(img, ...px('neck'))).toEqual([255, 85, 0]);
    expect(at(img, ...px('rightShoulder'))).toEqual([255, 170, 0]);
    // Facing the camera the right shoulder is on the image's LEFT.
    expect(px('rightShoulder')[0]).toBeLessThan(px('leftShoulder')[0]);
  });

  it('draws different images for different directions, and no face dots from behind', () => {
    const imgs = DIRECTIONS.map((d) => renderPoseGuide({ direction: d, size, proportions: BODY }));
    for (let i = 0; i < imgs.length; i++)
      for (let j = i + 1; j < imgs.length; j++)
        expect(Buffer.compare(Buffer.from(imgs[i].data), Buffer.from(imgs[j].data))).not.toBe(0);
    // The nose dot (colour index 0 = pure red 255,0,0) is absent in the back view.
    const countRed = (img: (typeof imgs)[number]) => {
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4)
        if (img.data[i] === 255 && img.data[i + 1] === 0 && img.data[i + 2] === 0) n++;
      return n;
    };
    expect(countRed(renderPoseGuide({ direction: 'S', size, proportions: BODY }))).toBeGreaterThan(
      0,
    );
    expect(countRed(renderPoseGuide({ direction: 'N', size, proportions: BODY }))).toBe(0);
  });

  it('stays inside the image for extreme boxes', () => {
    const img = renderPoseGuide({
      direction: 'E',
      size: 64,
      proportions: BODY,
      box: { centerX: 2, bottom: 80, height: 300 },
    });
    expect(img.data.length).toBe(64 * 64 * 4);
  });
});

describe('repaint mask', () => {
  const size = 256;
  const box = { centerX: 128, bottom: 236, height: 200 };
  const white = (img: { data: Uint8ClampedArray; width: number }, x: number, y: number) =>
    img.data[(Math.round(y) * img.width + Math.round(x)) * 4] === 255;

  it('computes convex hulls', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 2, y: 2 },
      { x: 2, y: 0 },
    ]);
    expect(hull).toHaveLength(4);
  });

  it('covers every keypoint and the whole body, but not the corners', () => {
    for (const d of DIRECTIONS) {
      const mask = renderRepaintMask({ direction: d, size, proportions: BODY, box });
      const pts = placeKeypoints(poseKeypoints(d, BODY), box);
      for (const p of pts) expect(white(mask, p.px, p.py), `${d} ${p.name}`).toBe(true);
      // Head top and feet.
      expect(white(mask, box.centerX, box.bottom - box.height + 2), d).toBe(true);
      expect(white(mask, box.centerX, box.bottom - 2), d).toBe(true);
      for (const [x, y] of [
        [2, 2],
        [size - 3, 2],
        [2, size - 3],
        [size - 3, size - 3],
      ])
        expect(white(mask, x, y), `${d} corner`).toBe(false);
    }
  });

  it('is narrower in profile than from the front', () => {
    const area = (d: (typeof DIRECTIONS)[number]) => {
      const m = renderRepaintMask({ direction: d, size, proportions: BODY, box });
      let n = 0;
      for (let i = 0; i < size * size; i++) if (m.data[i * 4] === 255) n++;
      return n;
    };
    expect(area('E')).toBeLessThan(area('S'));
    expect(area('S')).toBeLessThan(size * size * 0.5);
  });

  it('also covers the silhouette of the image being replaced', () => {
    const source = createRaster(size, size, { r: 200, g: 200, b: 200, a: 255 });
    // A "stick" sticking out far to the right of where the new pose reaches.
    for (let y = 100; y < 110; y++)
      for (let x = 200; x < 240; x++) source.data.set([20, 20, 20, 255], (y * size + x) * 4);
    const plain = renderRepaintMask({ direction: 'E', size, proportions: BODY, box });
    const withSource = renderRepaintMask({
      direction: 'E',
      size,
      proportions: BODY,
      box,
      source: { image: source, background: { r: 200, g: 200, b: 200, a: 255 } },
    });
    expect(white(plain, 220, 105)).toBe(false);
    expect(white(withSource, 220, 105)).toBe(true);
  });

  it('can be switched off (everything may be repainted)', () => {
    const input = { image: createRaster(64, 64), background: { r: 0, g: 0, b: 0, a: 255 } };
    const all = repaintMaskForInput('S', { proportions: BODY }, input, { wholeImage: true });
    expect(all.data.every((v, i) => i % 4 === 3 || v === 255)).toBe(true);
    const some = repaintMaskForInput('S', { proportions: BODY }, input);
    expect(some.data.some((v, i) => i % 4 === 0 && v === 0)).toBe(true);
  });
});
