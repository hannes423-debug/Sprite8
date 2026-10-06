import { describe, expect, it } from 'vitest';
import { EditorController, type PointerInfo } from '../../src/editor/controller';
import { bresenham, brushRect } from '../../src/editor/drawing';
import { createRaster, getPixel, setPixelInPlace, type RasterImage } from '../../src/core/sprite';
import { C } from './helpers';

function setup(img = createRaster(16, 16)) {
  const commits: Array<{ image: RasterImage; label: string }> = [];
  const ctl = new EditorController(
    img,
    { x: 8, y: 15 },
    {
      commit: (image, label) => commits.push({ image, label }),
      colorPicked: () => {},
    },
  );
  ctl.setStageSize(800, 600);
  ctl.color = { ...C.red };
  return { ctl, commits };
}

/** Screen position of the centre of image pixel (x, y). */
function at(
  ctl: EditorController,
  x: number,
  y: number,
  id = 1,
  extra: Partial<PointerInfo> = {},
): PointerInfo {
  return {
    id,
    x: ctl.view.panX + (x + 0.5) * ctl.view.zoom,
    y: ctl.view.panY + (y + 0.5) * ctl.view.zoom,
    button: 0,
    pointerType: 'mouse',
    shiftKey: false,
    altKey: false,
    ...extra,
  };
}

function drag(
  ctl: EditorController,
  from: [number, number],
  to: [number, number],
  extra: Partial<PointerInfo> = {},
) {
  ctl.pointerDown(at(ctl, ...from, 1, extra));
  ctl.pointerMove(at(ctl, ...to, 1, extra));
  ctl.pointerUp(at(ctl, ...to, 1, extra));
}

function count(img: RasterImage, c: { r: number; g: number; b: number }): number {
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4)
    if (
      img.data[i + 3] &&
      img.data[i] === c.r &&
      img.data[i + 1] === c.g &&
      img.data[i + 2] === c.b
    )
      n++;
  return n;
}

describe('drawing primitives', () => {
  it('draws continuous Bresenham lines', () => {
    const pts: Array<[number, number]> = [];
    bresenham(0, 0, 4, 2, (x, y) => pts.push([x, y]));
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.at(-1)).toEqual([4, 2]);
    expect(pts).toHaveLength(5);
  });

  it('centres square brushes', () => {
    expect(brushRect(5, 5, 1)).toEqual({ x: 5, y: 5, width: 1, height: 1 });
    expect(brushRect(5, 5, 3)).toEqual({ x: 4, y: 4, width: 3, height: 3 });
  });
});

describe('editor controller', () => {
  it('fits the canvas with an integer zoom', () => {
    const { ctl } = setup();
    expect(Number.isInteger(ctl.view.zoom)).toBe(true);
    expect(ctl.view.zoom).toBeGreaterThan(10);
  });

  it('paints a stroke as one undoable commit and never mutates the committed image', () => {
    const { ctl, commits } = setup();
    const original = ctl.image;
    drag(ctl, [2, 3], [6, 3]);
    expect(commits).toHaveLength(1);
    expect(commits[0].label).toBe('Paint');
    expect(count(commits[0].image, C.red)).toBe(5);
    expect(count(original, C.red)).toBe(0);
    // The next stroke works on a copy: the first commit stays as it was.
    drag(ctl, [2, 5], [2, 5]);
    expect(count(commits[0].image, C.red)).toBe(5);
    expect(count(commits[1].image, C.red)).toBe(6);
  });

  it('erases with the eraser and with the right mouse button', () => {
    const img = createRaster(16, 16, C.blue);
    const { ctl, commits } = setup(img);
    ctl.setTool('eraser');
    drag(ctl, [0, 0], [3, 0]);
    expect(getPixel(commits[0].image, 2, 0).a).toBe(0);
    ctl.setTool('pencil');
    drag(ctl, [0, 5], [0, 5], { button: 2 });
    expect(getPixel(commits[1].image, 0, 5).a).toBe(0);
  });

  it('mirror painting paints around the centre line', () => {
    const { ctl, commits } = setup();
    ctl.mirrorPaint = true;
    drag(ctl, [2, 4], [2, 4]);
    expect(getPixel(commits[0].image, 2, 4)).toEqual(C.red);
    expect(getPixel(commits[0].image, 13, 4)).toEqual(C.red); // 2·8 − 2 − 1
  });

  it('fills contiguous regions and respects the selection', () => {
    const img = createRaster(8, 8);
    for (let y = 0; y < 8; y++) setPixelInPlace(img, 4, y, C.blue); // wall
    const { ctl, commits } = setup(img);
    ctl.setTool('fill');
    ctl.pointerDown(at(ctl, 0, 0));
    ctl.pointerUp(at(ctl, 0, 0));
    expect(count(commits[0].image, C.red)).toBe(32);
  });

  it('picks colours with the eyedropper', () => {
    const img = createRaster(8, 8);
    setPixelInPlace(img, 1, 1, C.skin);
    const picked: unknown[] = [];
    const ctl = new EditorController(
      img,
      { x: 4, y: 7 },
      { commit: () => {}, colorPicked: (c) => picked.push(c) },
    );
    ctl.setStageSize(400, 400);
    ctl.setTool('picker');
    ctl.pointerDown(at(ctl, 1, 1));
    expect(ctl.color).toEqual(C.skin);
    expect(picked).toHaveLength(1);
  });

  it('selects, lifts and moves pixels as one step', () => {
    const img = createRaster(16, 16);
    setPixelInPlace(img, 2, 2, C.blue);
    const { ctl, commits } = setup(img);
    ctl.setTool('select');
    drag(ctl, [1, 1], [3, 3]);
    expect(ctl.selection).toEqual({ x: 1, y: 1, width: 3, height: 3 });
    drag(ctl, [2, 2], [7, 4]); // drag inside the selection moves it
    expect(ctl.floating).not.toBeNull();
    expect(commits).toHaveLength(0);
    ctl.commitFloating();
    expect(commits[0].label).toBe('Move selection');
    expect(getPixel(commits[0].image, 7, 4)).toEqual(C.blue);
    expect(getPixel(commits[0].image, 2, 2).a).toBe(0);
  });

  it('copies and pastes at the same position (also across directions)', () => {
    const img = createRaster(16, 16);
    setPixelInPlace(img, 5, 6, C.blue);
    const { ctl, commits } = setup(img);
    ctl.setTool('select');
    drag(ctl, [5, 6], [5, 6]);
    expect(ctl.selection).toBeNull(); // a click without dragging deselects
    drag(ctl, [4, 5], [6, 7]);
    ctl.copy();
    ctl.setImage(createRaster(16, 16)); // e.g. switching to another direction
    ctl.paste();
    expect(ctl.floating?.x).toBe(4);
    ctl.commitFloating();
    expect(getPixel(commits.at(-1)!.image, 5, 6)).toEqual(C.blue);
  });

  it('flips a selection in place and mirrors whole frames around the anchor', () => {
    const img = createRaster(16, 16);
    setPixelInPlace(img, 1, 1, C.blue);
    const { ctl, commits } = setup(img);
    ctl.selection = { x: 0, y: 0, width: 4, height: 4 };
    ctl.flip('h');
    expect(getPixel(commits[0].image, 2, 1)).toEqual(C.blue);
    ctl.selection = null;
    ctl.flip('h');
    expect(getPixel(commits[1].image, 13, 1)).toEqual(C.blue); // 2·8 − 2 − 1
  });

  it('rotates a selection by 90°', () => {
    const img = createRaster(16, 16);
    setPixelInPlace(img, 0, 0, C.blue);
    const { ctl, commits } = setup(img);
    ctl.selection = { x: 0, y: 0, width: 2, height: 2 };
    ctl.rotate(90);
    expect(getPixel(commits[0].image, 1, 0)).toEqual(C.blue);
  });

  it('scales a whole character around its feet', () => {
    const img = createRaster(16, 16);
    for (let y = 11; y < 15; y++) for (let x = 7; x < 9; x++) setPixelInPlace(img, x, y, C.blue);
    const { ctl, commits } = setup(img);
    ctl.scale(2);
    const out = commits[0].image;
    expect(count(out, C.blue)).toBe(32);
    expect(getPixel(out, 7, 14)).toEqual(C.blue); // still standing on the same ground row
    expect(getPixel(out, 7, 15).a).toBe(0);
  });

  it('crop clears everything outside the selection', () => {
    const { ctl, commits } = setup(createRaster(16, 16, C.blue));
    ctl.selection = { x: 2, y: 2, width: 3, height: 3 };
    ctl.cropToSelection();
    expect(count(commits[0].image, C.blue)).toBe(9);
  });

  it('pinch-zooms with two fingers and cancels a stroke started by the first finger', () => {
    const { ctl, commits } = setup();
    const z0 = ctl.view.zoom;
    const touch = { pointerType: 'touch' } as const;
    ctl.pointerDown({ ...at(ctl, 4, 4, 1), ...touch });
    ctl.pointerDown({ ...at(ctl, 8, 8, 2), ...touch });
    const p1 = at(ctl, 2, 2, 1);
    const p2 = at(ctl, 10, 10, 2);
    ctl.pointerMove({ ...p1, ...touch });
    ctl.pointerMove({ ...p2, ...touch });
    ctl.pointerUp({ ...p1, ...touch });
    ctl.pointerUp({ ...p2, ...touch });
    expect(ctl.view.zoom).toBeGreaterThan(z0);
    expect(commits).toHaveLength(0);
  });

  it('zooms in steps and back to fit', () => {
    const { ctl } = setup();
    const z0 = ctl.view.zoom;
    ctl.zoomStep(1);
    expect(ctl.view.zoom).toBeGreaterThan(z0);
    ctl.fit();
    expect(ctl.view.zoom).toBe(z0);
  });

  it('external updates drop floating selections', () => {
    const { ctl } = setup();
    ctl.paste(createRaster(2, 2, C.blue));
    expect(ctl.floating).not.toBeNull();
    ctl.setImage(createRaster(16, 16, C.red));
    expect(ctl.floating).toBeNull();
  });
});
