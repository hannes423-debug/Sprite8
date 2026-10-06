import {
  blit,
  clearOutside,
  clearRect,
  cloneRaster,
  colorRegionMask,
  contentBounds,
  createRaster,
  crop,
  fillMaskInPlace,
  findFeet,
  flipHorizontal,
  flipVertical,
  getPixel,
  mirrorAroundAxis,
  multiplyAlpha,
  rastersEqual,
  rotateArbitrary,
  scaleNearest,
  scaleSmooth,
  translate,
  type RasterImage,
  type Rect,
  type Rgba,
} from '../core/sprite';
import { symmetrize } from '../core/symmetry';
import { createCanvas, putRaster, rasterCanvas } from '../platform/canvas';
import { drawGuideImage, drawGuides, type GuideSpec } from '../ui/canvas/guides';
import type { View } from '../ui/canvas/SpriteCanvas';
import { bresenham, brushRect, stamp } from './drawing';

/**
 * Pixel editor engine — framework-free. React only forwards pointer/keyboard
 * events and renders the toolbars; everything about painting, selections,
 * floating pastes, transforms and the viewport lives here.
 *
 * Committed images are immutable: a stroke paints into a private copy and
 * hands the finished raster to `commit`, which records an undo step.
 */
export type Tool = 'pencil' | 'eraser' | 'fill' | 'picker' | 'select' | 'pan';

export interface PointerInfo {
  id: number;
  x: number;
  y: number;
  button: number;
  pointerType: string;
  shiftKey: boolean;
  altKey: boolean;
}

export interface Floating {
  image: RasterImage;
  x: number;
  y: number;
  /** The frame underneath (with the lifted area already cleared, if any). */
  base: RasterImage;
  label: string;
}

export interface EditorCallbacks {
  commit: (image: RasterImage, label: string) => void;
  colorPicked: (c: Rgba) => void;
  notify?: (message: string) => void;
}

type Gesture =
  | { kind: 'stroke'; lastX: number; lastY: number; erase: boolean; label: string }
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | {
      kind: 'pinch';
      dist: number;
      zoom: number;
      midX: number;
      midY: number;
      panX: number;
      panY: number;
    }
  | { kind: 'select'; startX: number; startY: number; moved: boolean }
  | { kind: 'move'; startX: number; startY: number; origX: number; origY: number };

const ZOOM_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64];

/** Shared between directions, so a detail can be copied from E and pasted into NE. */
const clipboard: { image: RasterImage | null; x: number; y: number } = { image: null, x: 0, y: 0 };

export function hasClipboard(): boolean {
  return !!clipboard.image;
}

let checkerPattern: CanvasPattern | null = null;
const tintCache = new WeakMap<RasterImage, HTMLCanvasElement>();

function tinted(img: RasterImage): HTMLCanvasElement {
  let c = tintCache.get(img);
  if (!c) {
    c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(rasterCanvas(img), 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(90,170,255,0.45)';
    ctx.fillRect(0, 0, img.width, img.height);
    tintCache.set(img, c);
  }
  return c;
}

export class EditorController {
  image: RasterImage;
  floating: Floating | null = null;
  selection: Rect | null = null;
  tool: Tool = 'pencil';
  color: Rgba = { r: 27, g: 26, b: 41, a: 255 };
  brushSize = 1;
  mirrorPaint = false;
  fillContiguous = true;
  anchorX: number;
  anchorY: number;
  view = { zoom: 8, panX: 0, panY: 0 };
  stage = { w: 0, h: 0 };
  overlays = {
    grid: true,
    guides: null as GuideSpec | null,
    onion: null as RasterImage | null,
    onionAlpha: 0.3,
    silhouette: null as RasterImage | null,
    pixelated: true,
  };
  hover: { x: number; y: number } | null = null;
  spaceDown = false;

  private work: RasterImage | null = null;
  private gesture: Gesture | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private baseCanvas: HTMLCanvasElement | null = null;
  private baseRaster: RasterImage | null = null;
  private baseDirty = true;
  private needsFit = true;
  private readonly cb: EditorCallbacks;

  constructor(image: RasterImage, anchor: { x: number; y: number }, cb: EditorCallbacks) {
    this.image = image;
    this.anchorX = anchor.x;
    this.anchorY = anchor.y;
    this.cb = cb;
  }

  /* ------------------------------------------------------------ plumbing */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  emit(): void {
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  get width(): number {
    return this.image.width;
  }

  get height(): number {
    return this.image.height;
  }

  /** What is shown under any floating selection. */
  private get displayed(): RasterImage {
    return this.work ?? this.floating?.base ?? this.image;
  }

  /** The visible pixels including a floating selection. */
  composite(): RasterImage {
    return this.floating
      ? blit(this.floating.base, this.floating.image, this.floating.x, this.floating.y, 'over')
      : this.displayed;
  }

  /** External update (undo, regenerate, switching direction). */
  setImage(img: RasterImage, anchor?: { x: number; y: number }): void {
    if (img === this.image && !anchor) return;
    if (this.gesture?.kind === 'stroke') this.gesture = null;
    const sizeChanged = img.width !== this.image.width || img.height !== this.image.height;
    this.work = null;
    this.floating = null;
    this.image = img;
    if (anchor) {
      this.anchorX = anchor.x;
      this.anchorY = anchor.y;
    }
    if (sizeChanged) {
      this.selection = null;
      this.needsFit = true;
    }
    this.baseDirty = true;
    this.emit();
  }

  private commitImage(img: RasterImage, label: string): void {
    this.work = null;
    if (rastersEqual(img, this.image)) {
      this.baseDirty = true;
      this.emit();
      return;
    }
    this.image = img;
    this.baseDirty = true;
    this.emit();
    this.cb.commit(img, label);
  }

  /* ---------------------------------------------------------------- view */

  setStageSize(w: number, h: number): void {
    if (w === this.stage.w && h === this.stage.h) return;
    this.stage = { w, h };
    if (this.needsFit) this.fit();
    this.emit();
  }

  /** Zooms so the whole canvas is visible (integer zoom for crisp pixels). */
  fit(): void {
    if (this.stage.w <= 0 || this.stage.h <= 0) return;
    const margin = Math.min(48, Math.max(12, Math.min(this.stage.w, this.stage.h) * 0.06));
    let zoom = Math.min(
      (this.stage.w - margin * 2) / this.width,
      (this.stage.h - margin * 2) / this.height,
    );
    if (zoom >= 1) zoom = Math.floor(zoom);
    zoom = Math.max(0.25, Math.min(64, zoom));
    this.view = {
      zoom,
      panX: Math.round((this.stage.w - this.width * zoom) / 2),
      panY: Math.round((this.stage.h - this.height * zoom) / 2),
    };
    this.needsFit = false;
    this.emit();
  }

  zoomTo(zoom: number, sx = this.stage.w / 2, sy = this.stage.h / 2): void {
    const z = Math.max(0.25, Math.min(64, zoom));
    const ix = (sx - this.view.panX) / this.view.zoom;
    const iy = (sy - this.view.panY) / this.view.zoom;
    this.view = { zoom: z, panX: Math.round(sx - ix * z), panY: Math.round(sy - iy * z) };
    this.emit();
  }

  zoomStep(dir: 1 | -1, sx?: number, sy?: number): void {
    const z = this.view.zoom;
    const next =
      dir > 0
        ? (ZOOM_STEPS.find((s) => s > z + 1e-6) ?? 64)
        : ([...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) ?? 0.25);
    this.zoomTo(next, sx, sy);
  }

  toImage(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.view.panX) / this.view.zoom, y: (sy - this.view.panY) / this.view.zoom };
  }

  private pixelAt(sx: number, sy: number): { x: number; y: number } {
    const p = this.toImage(sx, sy);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  }

  cursor(): string {
    if (this.gesture?.kind === 'pan') return 'grabbing';
    if (this.spaceDown || this.tool === 'pan') return 'grab';
    if (this.tool === 'select') {
      const h = this.hover;
      if (h && this.floating && this.inRect(h.x, h.y, this.floatingRect()!)) return 'move';
      if (h && this.selection && !this.floating && this.inRect(h.x, h.y, this.selection))
        return 'move';
    }
    return 'crosshair';
  }

  /* ------------------------------------------------------------- helpers */

  private inRect(x: number, y: number, r: Rect): boolean {
    return x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
  }

  floatingRect(): Rect | null {
    const f = this.floating;
    return f ? { x: f.x, y: f.y, width: f.image.width, height: f.image.height } : null;
  }

  private clampRect(r: Rect): Rect | null {
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(this.width, r.x + r.width);
    const y1 = Math.min(this.height, r.y + r.height);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
  }

  /* ------------------------------------------------------------ pointers */

  pointerDown(p: PointerInfo): void {
    this.pointers.set(p.id, { x: p.x, y: p.y });
    if (this.pointers.size === 2) {
      // Second finger: abort a stroke that just started and pinch instead.
      if (this.gesture?.kind === 'stroke') {
        this.work = null;
        this.baseDirty = true;
      }
      const [a, b] = [...this.pointers.values()];
      this.gesture = {
        kind: 'pinch',
        dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        zoom: this.view.zoom,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        panX: this.view.panX,
        panY: this.view.panY,
      };
      this.emit();
      return;
    }
    if (this.pointers.size > 2) return;
    if (p.button === 1 || this.tool === 'pan' || this.spaceDown) {
      this.gesture = {
        kind: 'pan',
        startX: p.x,
        startY: p.y,
        panX: this.view.panX,
        panY: this.view.panY,
      };
      this.emit();
      return;
    }
    const px = this.pixelAt(p.x, p.y);
    switch (this.tool) {
      case 'pencil':
      case 'eraser': {
        if (p.altKey) {
          this.pick(px.x, px.y);
          return;
        }
        const erase = this.tool === 'eraser' || p.button === 2;
        this.work = cloneRaster(this.displayed === this.image ? this.image : this.composite());
        if (this.floating) this.floating = null;
        this.gesture = {
          kind: 'stroke',
          lastX: px.x,
          lastY: px.y,
          erase,
          label: erase ? 'Erase' : 'Paint',
        };
        this.paint(px.x, px.y, erase);
        break;
      }
      case 'fill':
        this.fill(px.x, px.y);
        break;
      case 'picker':
        this.pick(px.x, px.y);
        break;
      case 'select':
        this.selectDown(px.x, px.y, p.altKey);
        break;
      default:
        break;
    }
  }

  pointerMove(p: PointerInfo): void {
    if (this.pointers.has(p.id)) this.pointers.set(p.id, { x: p.x, y: p.y });
    if (p.pointerType !== 'touch') {
      const h = this.pixelAt(p.x, p.y);
      if (!this.hover || h.x !== this.hover.x || h.y !== this.hover.y) {
        this.hover = h;
        if (!this.gesture) this.emit();
      }
    }
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const zoom = Math.max(0.25, Math.min(64, g.zoom * (dist / g.dist)));
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const ix = (g.midX - g.panX) / g.zoom;
      const iy = (g.midY - g.panY) / g.zoom;
      this.view = { zoom, panX: Math.round(midX - ix * zoom), panY: Math.round(midY - iy * zoom) };
      this.emit();
      return;
    }
    if (g.kind === 'pan') {
      this.view = {
        ...this.view,
        panX: g.panX + (p.x - g.startX),
        panY: g.panY + (p.y - g.startY),
      };
      this.emit();
      return;
    }
    const px = this.pixelAt(p.x, p.y);
    if (g.kind === 'stroke') {
      if (px.x === g.lastX && px.y === g.lastY) return;
      bresenham(g.lastX, g.lastY, px.x, px.y, (x, y) => this.paint(x, y, g.erase, false));
      g.lastX = px.x;
      g.lastY = px.y;
      this.baseDirty = true;
      this.emit();
    } else if (g.kind === 'select') {
      const x0 = Math.max(0, Math.min(this.width - 1, g.startX));
      const y0 = Math.max(0, Math.min(this.height - 1, g.startY));
      const x1 = Math.max(0, Math.min(this.width - 1, px.x));
      const y1 = Math.max(0, Math.min(this.height - 1, px.y));
      g.moved = g.moved || px.x !== g.startX || px.y !== g.startY;
      this.selection = {
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        width: Math.abs(x1 - x0) + 1,
        height: Math.abs(y1 - y0) + 1,
      };
      this.emit();
    } else if (g.kind === 'move' && this.floating) {
      this.floating = {
        ...this.floating,
        x: g.origX + (px.x - g.startX),
        y: g.origY + (px.y - g.startY),
      };
      this.emit();
    }
  }

  pointerUp(p: PointerInfo): void {
    this.pointers.delete(p.id);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (this.pointers.size === 0) this.gesture = null;
      return;
    }
    this.gesture = null;
    if (g.kind === 'stroke' && this.work) {
      this.commitImage(this.work, g.label);
    } else if (g.kind === 'select' && !g.moved) {
      this.selection = null;
      this.emit();
    } else {
      this.emit();
    }
  }

  pointerCancel(p: PointerInfo): void {
    this.pointers.delete(p.id);
    if (this.gesture?.kind === 'stroke') {
      this.work = null;
      this.baseDirty = true;
    }
    if (this.pointers.size === 0) this.gesture = null;
    this.emit();
  }

  pointerLeave(): void {
    if (this.hover) {
      this.hover = null;
      this.emit();
    }
  }

  wheel(deltaY: number, sx: number, sy: number, ctrlKey: boolean): void {
    if (ctrlKey) {
      // Trackpad pinch: smooth zoom.
      this.zoomTo(this.view.zoom * Math.exp(-deltaY * 0.01), sx, sy);
    } else {
      this.zoomStep(deltaY < 0 ? 1 : -1, sx, sy);
    }
  }

  /* -------------------------------------------------------------- tools */

  private paint(x: number, y: number, erase: boolean, notify = true): void {
    if (!this.work) return;
    stamp(this.work, x, y, {
      size: this.brushSize,
      color: this.color,
      erase,
      clip: this.selection,
      mirrorAxis: this.mirrorPaint ? this.anchorX : null,
    });
    this.baseDirty = true;
    if (notify) this.emit();
  }

  private fill(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.commitFloating();
    const base = this.image;
    const mask = colorRegionMask(base, x, y, { contiguous: this.fillContiguous });
    if (this.selection) {
      const s = this.selection;
      for (let p = 0; p < mask.length; p++) {
        const px = p % base.width;
        const py = (p - px) / base.width;
        if (px < s.x || py < s.y || px >= s.x + s.width || py >= s.y + s.height) mask[p] = 0;
      }
    }
    const out = cloneRaster(base);
    fillMaskInPlace(out, mask, this.color);
    this.commitImage(out, 'Fill');
  }

  pick(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const c = getPixel(this.composite(), x, y);
    this.color = c;
    this.cb.colorPicked(c);
    this.emit();
  }

  private selectDown(x: number, y: number, duplicate: boolean): void {
    const fr = this.floatingRect();
    if (this.floating && fr && this.inRect(x, y, fr)) {
      this.gesture = {
        kind: 'move',
        startX: x,
        startY: y,
        origX: this.floating.x,
        origY: this.floating.y,
      };
      return;
    }
    if (!this.floating && this.selection && this.inRect(x, y, this.selection)) {
      this.lift(duplicate);
      this.gesture = {
        kind: 'move',
        startX: x,
        startY: y,
        origX: this.floating!.x,
        origY: this.floating!.y,
      };
      this.emit();
      return;
    }
    this.commitFloating();
    this.gesture = { kind: 'select', startX: x, startY: y, moved: false };
    const cx = Math.max(0, Math.min(this.width - 1, x));
    const cy = Math.max(0, Math.min(this.height - 1, y));
    this.selection = { x: cx, y: cy, width: 1, height: 1 };
    this.emit();
  }

  /** Turns the selected pixels into a floating layer that can be moved. */
  private lift(duplicate = false): void {
    if (!this.selection || this.floating) return;
    const sel = this.selection;
    this.floating = {
      image: crop(this.image, sel),
      x: sel.x,
      y: sel.y,
      base: duplicate ? this.image : clearRect(this.image, sel),
      label: duplicate ? 'Duplicate selection' : 'Move selection',
    };
    this.baseDirty = true;
  }

  commitFloating(): void {
    const f = this.floating;
    if (!f) return;
    this.floating = null;
    this.selection = this.clampRect({
      x: f.x,
      y: f.y,
      width: f.image.width,
      height: f.image.height,
    });
    this.commitImage(blit(f.base, f.image, f.x, f.y, 'over'), f.label);
  }

  cancelFloating(): boolean {
    if (!this.floating) return false;
    this.floating = null;
    this.baseDirty = true;
    this.emit();
    return true;
  }

  /* ---------------------------------------------------------- operations */

  setTool(tool: Tool): void {
    if (tool !== 'select') this.commitFloating();
    this.tool = tool;
    this.emit();
  }

  selectAll(): void {
    this.commitFloating();
    this.selection = { x: 0, y: 0, width: this.width, height: this.height };
    this.tool = 'select';
    this.emit();
  }

  deselect(): void {
    this.commitFloating();
    this.selection = null;
    this.emit();
  }

  deleteSelection(): void {
    if (this.floating) {
      const { base, label } = this.floating;
      this.floating = null;
      if (label === 'Paste') {
        this.baseDirty = true;
        this.emit();
      } else this.commitImage(base, 'Delete selection');
      return;
    }
    if (this.selection) this.commitImage(clearRect(this.image, this.selection), 'Delete selection');
  }

  copy(): boolean {
    let img: RasterImage | null = null;
    let x = 0;
    let y = 0;
    if (this.floating) {
      img = this.floating.image;
      x = this.floating.x;
      y = this.floating.y;
    } else if (this.selection) {
      img = crop(this.image, this.selection);
      x = this.selection.x;
      y = this.selection.y;
    } else {
      img = this.image;
    }
    clipboard.image = img;
    clipboard.x = x;
    clipboard.y = y;
    this.emit();
    return true;
  }

  cut(): void {
    if (!this.selection && !this.floating) {
      this.cb.notify?.('Select an area to cut.');
      return;
    }
    this.copy();
    this.deleteSelection();
  }

  /** Pastes as a floating layer (internal clipboard keeps the copied position). */
  paste(external?: RasterImage): void {
    this.commitFloating();
    const img = external ?? clipboard.image;
    if (!img) {
      this.cb.notify?.('The clipboard is empty.');
      return;
    }
    let x: number;
    let y: number;
    if (external) {
      const feet = findFeet(img);
      x = Math.round(this.anchorX - (feet?.feetX ?? img.width / 2));
      y = Math.round(this.anchorY - (feet?.groundY ?? img.height));
    } else if (this.selection) {
      x = this.selection.x;
      y = this.selection.y;
    } else {
      x = clipboard.x;
      y = clipboard.y;
    }
    this.floating = { image: img, x, y, base: this.image, label: 'Paste' };
    this.tool = 'select';
    this.baseDirty = true;
    this.emit();
  }

  /** Applies `fn` to the floating layer, the selection, or the whole frame. */
  private transform(
    label: string,
    fn: (img: RasterImage) => RasterImage,
    frameFn?: (img: RasterImage) => RasterImage,
  ): void {
    if (this.floating) {
      const f = this.floating;
      const out = fn(f.image);
      this.floating = {
        ...f,
        image: out,
        x: Math.round(f.x + (f.image.width - out.width) / 2),
        y: Math.round(f.y + (f.image.height - out.height) / 2),
      };
      this.emit();
      return;
    }
    if (this.selection) {
      const sel = this.selection;
      const out = fn(crop(this.image, sel));
      const x = Math.round(sel.x + (sel.width - out.width) / 2);
      const y = Math.round(sel.y + (sel.height - out.height) / 2);
      const same = out.width === sel.width && out.height === sel.height;
      const next = blit(clearRect(this.image, sel), out, x, y, same ? 'replace' : 'over');
      this.selection = this.clampRect({ x, y, width: out.width, height: out.height });
      this.commitImage(next, `${label} selection`);
      return;
    }
    this.commitImage((frameFn ?? fn)(this.image), `${label} frame`);
  }

  flip(axis: 'h' | 'v'): void {
    if (axis === 'h')
      this.transform('Flip', flipHorizontal, (img) => mirrorAroundAxis(img, this.anchorX));
    else this.transform('Flip', flipVertical);
  }

  rotate(degrees: number): void {
    this.transform(
      `Rotate ${degrees}°`,
      (img) => rotateArbitrary(img, degrees, { expand: true }),
      (img) =>
        rotateArbitrary(img, degrees, {
          pivotX: this.anchorX,
          pivotY: this.anchorY - (contentBounds(img)?.height ?? 0) / 2,
        }),
    );
  }

  scale(factor: number): void {
    const f = Math.max(0.05, Math.min(16, factor));
    const resample = (img: RasterImage) => {
      const w = Math.max(1, Math.round(img.width * f));
      const h = Math.max(1, Math.round(img.height * f));
      return this.overlays.pixelated ? scaleNearest(img, w, h) : scaleSmooth(img, w, h);
    };
    // Whole frame: scale the character around its feet so it stays on the ground.
    const frameFn = (img: RasterImage) => {
      const b = contentBounds(img);
      if (!b) return img;
      const scaled = resample(crop(img, b));
      const feet = findFeet(img)!;
      const out = createRaster(img.width, img.height);
      const sx = Math.round(feet.feetX - (feet.feetX - b.x) * f);
      const sy = Math.round(feet.groundY - scaled.height);
      return blit(out, scaled, sx, sy, 'replace');
    };
    this.transform(`Scale ${Math.round(f * 100)}%`, resample, frameFn);
  }

  opacity(factor: number): void {
    if (this.floating) {
      this.floating = { ...this.floating, image: multiplyAlpha(this.floating.image, factor) };
      this.emit();
      return;
    }
    this.commitImage(
      multiplyAlpha(this.image, factor, this.selection ?? undefined),
      `Opacity ${Math.round(factor * 100)}%`,
    );
  }

  cropToSelection(): void {
    this.commitFloating();
    if (!this.selection) {
      this.cb.notify?.('Select the area to keep first.');
      return;
    }
    this.commitImage(clearOutside(this.image, this.selection), 'Crop to selection');
  }

  nudge(dx: number, dy: number): void {
    if (!this.floating && this.selection) this.lift();
    if (this.floating) {
      this.floating = { ...this.floating, x: this.floating.x + dx, y: this.floating.y + dy };
      this.baseDirty = true;
      this.emit();
      return;
    }
    this.commitImage(translate(this.image, dx, dy), 'Nudge frame');
  }

  symmetrize(keep: 'left' | 'right'): void {
    this.commitFloating();
    this.commitImage(symmetrize(this.image, this.anchorX, keep), `Symmetrize (keep ${keep})`);
  }

  clearFrame(): void {
    this.floating = null;
    this.selection = null;
    this.commitImage(createRaster(this.width, this.height), 'Clear frame');
  }

  /* -------------------------------------------------------------- render */

  private ensureBase(): HTMLCanvasElement {
    if (!this.baseCanvas) this.baseCanvas = createCanvas(this.width, this.height);
    const r = this.displayed;
    if (this.baseDirty || r !== this.baseRaster) {
      putRaster(this.baseCanvas, r);
      this.baseRaster = r;
      this.baseDirty = false;
    }
    return this.baseCanvas;
  }

  render(ctx: CanvasRenderingContext2D, dpr: number): void {
    const { w, h } = this.stage;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0e1014';
    ctx.fillRect(0, 0, w, h);
    const z = this.view.zoom;
    const x0 = this.view.panX;
    const y0 = this.view.panY;
    const W = this.width * z;
    const H = this.height * z;
    const view: View = { x0, y0, scale: z, width: this.width, height: this.height };

    if (!checkerPattern) {
      const c = createCanvas(16, 16);
      const cctx = c.getContext('2d')!;
      cctx.fillStyle = '#2b2f3a';
      cctx.fillRect(0, 0, 16, 16);
      cctx.fillStyle = '#232731';
      cctx.fillRect(0, 0, 8, 8);
      cctx.fillRect(8, 8, 8, 8);
      checkerPattern = ctx.createPattern(c, 'repeat');
    }
    if (checkerPattern) {
      ctx.fillStyle = checkerPattern;
      ctx.fillRect(x0, y0, W, H);
    }
    const pixelated = this.overlays.pixelated;
    if (this.overlays.silhouette)
      drawGuideImage(ctx, view, this.overlays.silhouette, 0.24, pixelated);
    if (this.overlays.onion) {
      ctx.save();
      ctx.globalAlpha = this.overlays.onionAlpha;
      ctx.imageSmoothingEnabled = !pixelated;
      ctx.drawImage(tinted(this.overlays.onion), x0, y0, W, H);
      ctx.restore();
    }
    ctx.imageSmoothingEnabled = !pixelated || z < 1;
    ctx.drawImage(this.ensureBase(), x0, y0, W, H);
    const f = this.floating;
    if (f)
      ctx.drawImage(
        rasterCanvas(f.image),
        x0 + f.x * z,
        y0 + f.y * z,
        f.image.width * z,
        f.image.height * z,
      );

    if (this.overlays.grid && z >= 6) {
      ctx.save();
      ctx.beginPath();
      const left = Math.max(0, Math.floor(-x0 / z));
      const right = Math.min(this.width, Math.ceil((w - x0) / z));
      const top = Math.max(0, Math.floor(-y0 / z));
      const bottom = Math.min(this.height, Math.ceil((h - y0) / z));
      for (let x = left; x <= right; x++) {
        const sx = Math.round(x0 + x * z) + 0.5;
        ctx.moveTo(sx, y0 + top * z);
        ctx.lineTo(sx, y0 + bottom * z);
      }
      for (let y = top; y <= bottom; y++) {
        const sy = Math.round(y0 + y * z) + 0.5;
        ctx.moveTo(x0 + left * z, sy);
        ctx.lineTo(x0 + right * z, sy);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    if (this.overlays.guides) drawGuides(ctx, view, this.overlays.guides);

    const sel = this.floatingRect() ?? this.selection;
    if (sel) {
      const rx = Math.round(x0 + sel.x * z) + 0.5;
      const ry = Math.round(y0 + sel.y * z) + 0.5;
      const rw = Math.round(sel.width * z);
      const rh = Math.round(sel.height * z);
      ctx.save();
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.lineDashOffset = 4;
      ctx.strokeStyle = '#000000';
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }
    const hv = this.hover;
    if (
      hv &&
      !this.gesture &&
      (this.tool === 'pencil' ||
        this.tool === 'eraser' ||
        this.tool === 'fill' ||
        this.tool === 'picker')
    ) {
      const r =
        this.tool === 'pencil' || this.tool === 'eraser'
          ? brushRect(hv.x, hv.y, this.brushSize)
          : { x: hv.x, y: hv.y, width: 1, height: 1 };
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeRect(
        Math.round(x0 + r.x * z) - 0.5,
        Math.round(y0 + r.y * z) - 0.5,
        r.width * z + 1,
        r.height * z + 1,
      );
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeRect(
        Math.round(x0 + r.x * z) + 0.5,
        Math.round(y0 + r.y * z) + 0.5,
        r.width * z - 1,
        r.height * z - 1,
      );
      ctx.restore();
    }
  }
}
