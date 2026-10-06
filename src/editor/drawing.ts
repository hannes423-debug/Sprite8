import type { RasterImage, Rect, Rgba } from '../core/sprite';

/** Calls `plot` for every pixel on the line from (x0, y0) to (x1, y1) (Bresenham). */
export function bresenham(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

export interface StampOptions {
  size: number;
  color: Rgba;
  erase: boolean;
  /** Restrict painting to this rectangle (the active selection). */
  clip: Rect | null;
  /** Also paint mirrored around this vertical axis (continuous x). */
  mirrorAxis: number | null;
}

function writePixel(img: RasterImage, x: number, y: number, o: StampOptions): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  if (o.clip && (x < o.clip.x || y < o.clip.y || x >= o.clip.x + o.clip.width || y >= o.clip.y + o.clip.height)) return;
  const i = (y * img.width + x) * 4;
  if (o.erase || o.color.a === 0) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = img.data[i + 3] = 0;
    return;
  }
  img.data[i] = o.color.r;
  img.data[i + 1] = o.color.g;
  img.data[i + 2] = o.color.b;
  img.data[i + 3] = o.color.a;
}

/** The pixel rectangle a square brush of `size` covers when centred on (x, y). */
export function brushRect(x: number, y: number, size: number): Rect {
  const s = Math.max(1, Math.round(size));
  const off = Math.floor((s - 1) / 2);
  return { x: x - off, y: y - off, width: s, height: s };
}

/** Stamps a square brush (mutates `img`). */
export function stamp(img: RasterImage, x: number, y: number, o: StampOptions): void {
  const r = brushRect(x, y, o.size);
  for (let yy = r.y; yy < r.y + r.height; yy++) {
    for (let xx = r.x; xx < r.x + r.width; xx++) {
      writePixel(img, xx, yy, o);
      if (o.mirrorAxis !== null) writePixel(img, Math.round(o.mirrorAxis * 2) - xx - 1, yy, o);
    }
  }
}
