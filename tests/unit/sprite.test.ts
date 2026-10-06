import { describe, expect, it } from 'vitest';
import {
  applyOutline,
  binarizeAlpha,
  blit,
  contentBounds,
  createRaster,
  crop,
  describeColor,
  detectBackground,
  detectOutline,
  detectPixelScale,
  downsamplePixelArt,
  downscaleMode,
  extractPalette,
  findFeet,
  flipHorizontal,
  getPixel,
  hexToRgba,
  medianCut,
  mirrorAroundAxis,
  normalizeImport,
  paletteCoverage,
  quantizeToPalette,
  rastersEqual,
  removeBackground,
  rgbaToHex,
  rotate90,
  rotateArbitrary,
  runsInRow,
  scaleNearest,
  scaleSmooth,
  setPixelInPlace,
  trim,
  colorRegionMask,
  type Rgba,
} from '../../src/core/sprite';
import { C, fromAscii, humanoid, opaqueColors, outlined, rng } from './helpers';

const P: Record<string, Rgba> = { R: C.red, B: C.blue, K: C.outline, W: C.white, G: { r: 0, g: 255, b: 0, a: 255 }, M: { r: 255, g: 0, b: 255, a: 255 } };

describe('colour helpers', () => {
  it('round-trips hex', () => {
    expect(rgbaToHex({ r: 255, g: 16, b: 1, a: 255 })).toBe('#ff1001');
    expect(rgbaToHex({ r: 0, g: 0, b: 0, a: 128 })).toBe('#00000080');
    expect(hexToRgba('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 255 });
    expect(hexToRgba('#11223344')).toEqual({ r: 0x11, g: 0x22, b: 0x33, a: 0x44 });
    expect(hexToRgba('nope')).toBeNull();
  });

  it('names colours for prompts', () => {
    expect(describeColor({ r: 200, g: 40, b: 40 })).toBe('red');
    expect(describeColor({ r: 10, g: 10, b: 10 })).toBe('black');
    expect(describeColor({ r: 250, g: 250, b: 250 })).toBe('white');
    expect(describeColor({ r: 40, g: 60, b: 150 })).toBe('blue');
    expect(describeColor({ r: 243, g: 198, b: 144 })).toBe('skin tone');
  });
});

describe('geometric transforms', () => {
  const img = fromAscii(['RB.', 'K..'], P);

  it('flips horizontally', () => {
    const f = flipHorizontal(img);
    expect(getPixel(f, 2, 0)).toEqual(C.red);
    expect(getPixel(f, 1, 0)).toEqual(C.blue);
    expect(getPixel(f, 2, 1)).toEqual(C.outline);
    expect(rastersEqual(flipHorizontal(f), img)).toBe(true);
  });

  it('mirrors around an arbitrary axis keeping canvas size', () => {
    const wide = createRaster(10, 1);
    setPixelInPlace(wide, 2, 0, C.red);
    // axis at x = 4 (edge between pixel 3 and 4): pixel 2 -> pixel 5
    const m = mirrorAroundAxis(wide, 4);
    expect(m.width).toBe(10);
    expect(getPixel(m, 5, 0)).toEqual(C.red);
    expect(getPixel(m, 2, 0).a).toBe(0);
    // half-pixel axis maps the centre pixel onto itself
    expect(getPixel(mirrorAroundAxis(wide, 2.5), 2, 0)).toEqual(C.red);
  });

  it('rotates by 90° and back', () => {
    const r = rotate90(img, true);
    expect([r.width, r.height]).toEqual([2, 3]);
    expect(getPixel(r, 1, 0)).toEqual(C.red); // top-left moves to top-right
    expect(rastersEqual(rotate90(r, false), img)).toBe(true);
    expect(rastersEqual(rotateArbitrary(img, 90, { expand: true }), r)).toBe(true);
  });

  it('rotates arbitrarily without inventing colours', () => {
    const h = humanoid();
    const r = rotateArbitrary(h, 17, { expand: true });
    for (const c of opaqueColors(r)) expect(opaqueColors(h).has(c)).toBe(true);
  });

  it('crops and blits', () => {
    const c = crop(img, { x: 1, y: 0, width: 3, height: 2 });
    expect(getPixel(c, 0, 0)).toEqual(C.blue);
    expect(getPixel(c, 2, 1).a).toBe(0); // outside source
    const canvas = blit(createRaster(4, 4), img, 1, 1);
    expect(getPixel(canvas, 1, 1)).toEqual(C.red);
    expect(getPixel(canvas, 0, 0).a).toBe(0);
  });
});

describe('scaling', () => {
  it('nearest-neighbour preserves exact pixels', () => {
    const img = fromAscii(['RB', 'KW'], P);
    const up = scaleNearest(img, 8, 8);
    expect(getPixel(up, 0, 0)).toEqual(C.red);
    expect(getPixel(up, 7, 0)).toEqual(C.blue);
    expect(getPixel(up, 3, 7)).toEqual(C.outline);
    expect(opaqueColors(up).size).toBe(4);
  });

  it('smooth scaling averages without dark transparent fringes', () => {
    const img = fromAscii(['R.', '..'], P);
    const half = scaleSmooth(img, 1, 1);
    const p = getPixel(half, 0, 0);
    expect(p.r).toBe(200); // colour of the only opaque pixel, not darkened
    expect(p.a).toBe(64);
  });

  it('mode downscale keeps crisp palette colours', () => {
    const big = scaleNearest(humanoid(), 160, 192);
    const small = downscaleMode(big, 40, 48);
    expect(rastersEqual(small, humanoid())).toBe(true);
  });
});

describe('bounds & feet', () => {
  it('finds content bounds and trims', () => {
    const img = createRaster(10, 10);
    setPixelInPlace(img, 3, 4, C.red);
    setPixelInPlace(img, 6, 8, C.red);
    expect(contentBounds(img)).toEqual({ x: 3, y: 4, width: 4, height: 5 });
    const t = trim(img)!;
    expect([t.image.width, t.image.height, t.offsetX, t.offsetY]).toEqual([4, 5, 3, 4]);
    expect(contentBounds(createRaster(3, 3))).toBeNull();
  });

  it('locates feet independent of a one-sided stick', () => {
    const plain = findFeet(humanoid())!;
    const stick = findFeet(humanoid({ stick: 'screen-left' }))!;
    expect(plain.groundY).toBe(48);
    // The blade touches the ground too but feet dominate the bottom band.
    expect(Math.abs(stick.feetX - plain.feetX)).toBeLessThan(6);
  });

  it('counts runs in a row', () => {
    const img = fromAscii(['RR.RR..R'], P);
    expect(runsInRow(img, 0, 1)).toBe(3);
    expect(runsInRow(img, 0, 2)).toBe(2);
  });
});

describe('background removal', () => {
  it('leaves transparent images alone', () => {
    const img = humanoid();
    expect(detectBackground(img).kind).toBe('transparent');
    expect(rastersEqual(removeBackground(img).image, img)).toBe(true);
  });

  it('flood-fills a white background but keeps enclosed white details', () => {
    const img = fromAscii(['WWWWWWW', 'WKKKKKW', 'WKWWWKW', 'WKKKKKW', 'WWWWWWW'], P);
    const res = removeBackground(img, { defringe: false });
    expect(res.info.kind).toBe('solid');
    expect(getPixel(res.image, 0, 0).a).toBe(0);
    expect(getPixel(res.image, 3, 2)).toEqual(C.white); // eye-white inside the outline survives
    expect(getPixel(res.image, 1, 1)).toEqual(C.outline);
  });

  it('removes enclosed pockets of a chroma-key colour', () => {
    const img = fromAscii(['MMMMMMM', 'MKKKKKM', 'MKMMMKM', 'MKKKKKM', 'MMMMMMM'], P);
    const res = removeBackground(img);
    expect(getPixel(res.image, 3, 2).a).toBe(0);
    expect(getPixel(res.image, 1, 1)).toEqual(C.outline);
  });

  it('decontaminates soft edges of painted art', () => {
    // 5×5 red block on white with a soft left edge (50% blend with white).
    const img = createRaster(11, 11, C.white);
    for (let y = 3; y <= 7; y++) {
      for (let x = 3; x <= 7; x++) setPixelInPlace(img, x, y, C.red);
      setPixelInPlace(img, 2, y, { r: 228, g: 157, b: 157, a: 255 });
    }
    const res = removeBackground(img, { defringe: true, tolerance: 20 });
    expect(getPixel(res.image, 5, 5)).toEqual(C.red);
    const edge = getPixel(res.image, 2, 5);
    expect(edge.a).toBeGreaterThan(40);
    expect(edge.a).toBeLessThan(230);
    expect(edge.g).toBeLessThan(157); // white contribution removed
  });
});

describe('pixel-art upscale detection', () => {
  it('detects and reverses an integer upscale with an offset', () => {
    const native = humanoid({ stick: 'screen-right' });
    const up = scaleNearest(native, native.width * 4, native.height * 4);
    // Shift by 2px so the grid does not start at 0.
    const shifted = blit(createRaster(up.width + 2, up.height + 2), up, 2, 2);
    const res = detectPixelScale(shifted);
    expect(res.scale).toBe(4);
    expect(res.offsetX).toBe(2);
    const down = downsamplePixelArt(shifted, res.scale, res.offsetX, res.offsetY);
    const t = trim(down)!.image;
    expect(rastersEqual(t, trim(native)!.image)).toBe(true);
  });

  it('reports scale 1 for native pixel art', () => {
    expect(detectPixelScale(humanoid()).scale).toBe(1);
  });

  it('normalizeImport turns an upscaled sprite on a solid background into a clean native sprite', () => {
    const native = humanoid();
    const up = scaleNearest(native, native.width * 3, native.height * 3);
    const onWhite = createRaster(up.width + 9, up.height + 9, C.white);
    const composed = blit(onWhite, up, 3, 6);
    const res = normalizeImport(composed);
    expect(res.pixelScale.scale).toBe(3);
    expect(res.pixelArt).toBe(true);
    expect(res.background.kind).toBe('solid');
    expect(rastersEqual(res.sprite, trim(native)!.image)).toBe(true);
  });
});

describe('palettes', () => {
  it('extracts exact colours sorted by frequency', () => {
    const pal = extractPalette(humanoid(), 16);
    expect(pal.length).toBe(4);
    expect(pal[0].color).toEqual({ ...C.red }); // torso + arms are the largest area
    expect(pal[1].color).toEqual({ ...C.blue });
  });

  it('median cut reduces many colours', () => {
    const r = rng(1);
    const entries = Array.from({ length: 300 }, () => ({
      color: { r: Math.floor(r() * 256), g: Math.floor(r() * 256), b: Math.floor(r() * 256), a: 255 },
      count: 1 + Math.floor(r() * 10),
    }));
    expect(medianCut(entries, 12).length).toBe(12);
  });

  it('quantizes to the nearest palette colour', () => {
    const img = createRaster(2, 1);
    setPixelInPlace(img, 0, 0, { r: 190, g: 70, b: 60, a: 255 });
    setPixelInPlace(img, 1, 0, { r: 30, g: 30, b: 50, a: 100 });
    const q = quantizeToPalette(img, [C.red, C.outline, C.white], { binarizeAlpha: true });
    expect(getPixel(q, 0, 0)).toEqual(C.red);
    expect(getPixel(q, 1, 0).a).toBe(0); // below the alpha threshold
    expect(paletteCoverage(q, [C.red])).toBe(1);
  });
});

describe('outline', () => {
  it('detects a 1px dark outline', () => {
    const o = detectOutline(outlined(humanoid()));
    expect(o.detected).toBe(true);
    expect(o.color).toEqual(C.outline);
    expect(o.thickness).toBe(1);
    expect(detectOutline(humanoid()).detected).toBe(false);
  });

  it('applies an outline without changing the silhouette', () => {
    const img = humanoid();
    const out = applyOutline(img, C.outline);
    expect(contentBounds(out)).toEqual(contentBounds(img));
    expect(getPixel(out, 15, 0)).toEqual(C.outline); // top edge of the head
    expect(detectOutline(out).detected).toBe(true);
  });
});

describe('alpha & regions', () => {
  it('binarizes alpha', () => {
    const img = createRaster(2, 1);
    setPixelInPlace(img, 0, 0, { r: 9, g: 9, b: 9, a: 200 });
    setPixelInPlace(img, 1, 0, { r: 9, g: 9, b: 9, a: 20 });
    const b = binarizeAlpha(img);
    expect(getPixel(b, 0, 0).a).toBe(255);
    expect(getPixel(b, 1, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('selects contiguous colour regions', () => {
    const img = fromAscii(['RRB', 'BRB', 'RBR'], P);
    const mask = colorRegionMask(img, 0, 0);
    expect([...mask]).toEqual([1, 1, 0, 0, 1, 0, 0, 0, 0]);
    const all = colorRegionMask(img, 0, 0, { contiguous: false });
    expect(all.reduce((s, v) => s + v, 0)).toBe(5);
  });
});
