import { describe, expect, it } from 'vitest';
import { decodePng } from '../../models/reference-server/png.mjs';
import { insertFrame, updateFrameImage } from '../../src/core/animation';
import { DIRECTIONS } from '../../src/core/directions';
import {
  buildExport,
  buildMetadata,
  buildSheet,
  crc32,
  createZip,
  exportNames,
  slugify,
  zipExport,
} from '../../src/core/export';
import {
  activeAnimation,
  createEmptyProject,
  placeOnAnchor,
  projectWithSource,
  replaceAnimation,
  type Project,
} from '../../src/core/project';
import { contentBounds, flipHorizontal, getPixel, normalizeImport } from '../../src/core/sprite';
import { C, humanoid, nodeCodec, outlined } from './helpers';

/** Minimal ZIP reader used to validate the writer (central directory + CRC). */
function readZip(bytes: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: Array<{ name: string; data: Uint8Array }> = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const localNameLen = v.getUint16(local + 26, true);
    const data = bytes.subarray(local + 30 + localNameLen, local + 30 + localNameLen + size);
    expect(crc32(data)).toBe(crc);
    out.push({ name, data });
    p += 46 + nameLen;
  }
  return out;
}

function projectWithAllDirections(): Project {
  const sprite = outlined(humanoid({ stick: 'screen-left' }));
  const p = projectWithSource(createEmptyProject(), normalizeImport(sprite), 'Hockey Player.png');
  let anim = activeAnimation(p);
  for (const d of DIRECTIONS) {
    if (d === 'S') continue;
    const img = d === 'N' ? flipHorizontal(sprite) : sprite;
    anim = updateFrameImage(anim, d, 0, placeOnAnchor(img, p.cell).image, 'edited', null);
  }
  return replaceAnimation(p, anim);
}

describe('sprite sheet layout', () => {
  it('"original" keeps native pixels and tightly fits every direction', () => {
    const p = projectWithAllDirections();
    const sheet = buildSheet(p);
    const sprite = p.source!.sprite;
    expect(sheet.scale).toBe(1);
    expect(sheet.columns).toBe(8);
    expect(sheet.image.width).toBe(sheet.cellWidth * 8);
    expect(sheet.cellHeight).toBe(sprite.height + 8); // padding 4 top + bottom
    expect(sheet.anchor.y).toBe(sheet.cellHeight - 4);
    expect(sheet.warnings).toEqual([]);
    // Every cell stands on the same ground line.
    for (const cell of sheet.cells) {
      const b = contentBounds(cell.image)!;
      expect(b.y + b.height).toBe(sheet.anchor.y);
    }
  });

  it('64 px target with pixel preservation uses an integer scale and the documented anchor', () => {
    const p = projectWithAllDirections();
    const sheet = buildSheet({
      ...p,
      sheet: { ...p.sheet, target: '64', pixelPreservation: true },
    });
    expect([sheet.cellWidth, sheet.cellHeight]).toEqual([64, 64]);
    expect(sheet.anchor).toEqual({ x: 32, y: 60 });
    expect(Number.isInteger(sheet.scale)).toBe(true);
    // Upscaling keeps exact source colours.
    const colors = new Set<string>();
    for (const c of sheet.cells) {
      for (let i = 0; i < c.image.data.length; i += 4) {
        if (c.image.data[i + 3]) colors.add(Array.from(c.image.data.subarray(i, i + 4)).join());
      }
    }
    expect(colors.size).toBeLessThanOrEqual(p.source!.sprite.data.length);
    expect([...colors].every((c) => c.endsWith(',255'))).toBe(true);
  });

  it('supports 4 × 2, compass, spacing, background colour and export scale', () => {
    const p = projectWithAllDirections();
    const s42 = buildSheet({ ...p, sheet: { ...p.sheet, grid: '4x2', target: '48', spacing: 2 } });
    expect([s42.columns, s42.rows]).toEqual([4, 2]);
    expect(s42.image.width).toBe(4 * 48 + 3 * 2);
    const compass = buildSheet({
      ...p,
      sheet: {
        ...p.sheet,
        grid: 'compass',
        target: '32',
        background: 'color',
        backgroundColor: '#102030',
      },
    });
    expect([compass.image.width, compass.image.height]).toEqual([96, 96]);
    expect(getPixel(compass.image, 48, 48)).toEqual({ r: 16, g: 32, b: 48, a: 255 }); // empty centre cell is background
    const x2 = buildSheet({ ...p, sheet: { ...p.sheet, target: '64', exportScale: 2 } });
    expect([x2.cellWidth, x2.cellHeight]).toEqual([128, 128]);
    expect(x2.anchor).toEqual({ x: 64, y: 120 });
  });

  it('lays out multi-frame animations with one row per direction', () => {
    const p = projectWithAllDirections();
    const anim = insertFrame(activeAnimation(p), 0, true);
    const sheet = buildSheet(replaceAnimation(p, anim));
    expect([sheet.columns, sheet.rows]).toEqual([2, 8]);
    expect(sheet.cells).toHaveLength(16);
  });

  it('warns about empty directions', () => {
    const p = projectWithSource(createEmptyProject(), normalizeImport(humanoid()), 'a.png');
    expect(buildSheet(p).warnings.join(' ')).toMatch(/Empty directions: N, NE, E, SE, SW, W, NW/);
  });
});

describe('metadata', () => {
  it('matches the simple documented format', () => {
    const p = projectWithAllDirections();
    const sheet = buildSheet({ ...p, sheet: { ...p.sheet, target: '64' } });
    const names = exportNames(p.setup.name, 'Idle', 1);
    const meta = buildMetadata(p, sheet, names);
    expect(meta.character).toBe('Hockey_Player');
    expect(meta.directions).toEqual({
      N: 'Hockey_Player_N.png',
      NE: 'Hockey_Player_NE.png',
      E: 'Hockey_Player_E.png',
      SE: 'Hockey_Player_SE.png',
      S: 'Hockey_Player_S.png',
      SW: 'Hockey_Player_SW.png',
      W: 'Hockey_Player_W.png',
      NW: 'Hockey_Player_NW.png',
    });
    expect(meta.cellWidth).toBe(64);
    expect(meta.cellHeight).toBe(64);
    expect(meta.anchor).toEqual({ x: 32, y: 60 });
    expect(meta.sheet.order).toEqual([...DIRECTIONS]);
    expect(meta.animation.frames.E[0]).toEqual({
      x: 128,
      y: 0,
      w: 64,
      h: 64,
      file: 'Hockey_Player_E.png',
    });
    expect(meta.symmetry).toBe('asymmetric');
  });

  it('names files per frame for animations', () => {
    const n = exportNames('My Hero!', 'Walk', 4);
    expect(n.cell('NE', 3)).toBe('My_Hero_walk_NE_3.png');
    expect(slugify('Ünïcödé name')).toBe('Unicode_name');
    expect(slugify('***')).toBe('character');
  });
});

describe('zip writer', () => {
  it('writes a valid store-only archive', () => {
    const files = [
      { name: 'a.txt', data: new TextEncoder().encode('hello') },
      { name: 'dir/b.bin', data: Uint8Array.from([0, 1, 2, 255]) },
    ];
    const zip = createZip(files);
    const read = readZip(zip);
    expect(read.map((f) => f.name)).toEqual(['a.txt', 'dir/b.bin']);
    expect(new TextDecoder().decode(read[0].data)).toBe('hello');
    expect(Array.from(read[1].data)).toEqual([0, 1, 2, 255]);
    expect(() => createZip([files[0], files[0]])).toThrow(/duplicate/);
  });

  it('computes standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('exports sheet, individual PNGs and JSON in one archive', async () => {
    const p = projectWithAllDirections();
    const bundle = await buildExport({ ...p, sheet: { ...p.sheet, target: '64' } }, nodeCodec, {
      sheet: true,
      cells: true,
      json: true,
    });
    const entries = readZip(zipExport(bundle));
    expect(entries.map((e) => e.name)).toEqual([
      'Hockey_Player_sheet.png',
      ...DIRECTIONS.map((d) => `Hockey_Player_${d}.png`),
      'Hockey_Player.json',
    ]);
    const sheetPng = decodePng(entries[0].data);
    expect([sheetPng.width, sheetPng.height]).toEqual([512, 64]);
    const nPng = decodePng(entries[1].data);
    expect([nPng.width, nPng.height]).toEqual([64, 64]);
    const meta = JSON.parse(new TextDecoder().decode(entries.at(-1)!.data));
    expect(meta.anchor).toEqual({ x: 32, y: 60 });
    expect(C.red).toBeTruthy();
  });
});
