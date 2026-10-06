import { useEffect } from 'react';
import type { RasterImage } from '../../core/sprite';
import { rasterCanvas } from '../../platform/canvas';
import { useElementSize } from './useElementSize';

/** Mapping from logical (cell) pixels to CSS pixels inside the canvas. */
export interface View {
  x0: number;
  y0: number;
  scale: number;
  width: number;
  height: number;
}

export type Painter = (ctx: CanvasRenderingContext2D, view: View) => void;

/**
 * Draws a raster scaled to fit, crisp (nearest-neighbour, integer zoom when
 * possible) for pixel art or smooth for painted art, with optional
 * under/overlay painters for guides.
 */
export function SpriteCanvas(props: {
  image: RasterImage | null;
  width?: number;
  height?: number;
  pixelated: boolean;
  className?: string;
  underlay?: Painter;
  overlay?: Painter;
  testId?: string;
  ariaLabel?: string;
  checker?: boolean;
}) {
  const [ref, size] = useElementSize<HTMLCanvasElement>();
  const { image, pixelated, underlay, overlay } = props;
  const lw = props.width ?? image?.width ?? 1;
  const lh = props.height ?? image?.height ?? 1;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const bw = Math.round(size.w * dpr);
    const bh = Math.round(size.h * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    let scale = Math.min(size.w / lw, size.h / lh);
    if (pixelated && scale >= 2) scale = Math.floor(scale);
    const view: View = {
      x0: Math.round((size.w - lw * scale) / 2),
      y0: Math.round((size.h - lh * scale) / 2),
      scale,
      width: lw,
      height: lh,
    };
    underlay?.(ctx, view);
    if (image && image.width > 0 && image.height > 0) {
      ctx.imageSmoothingEnabled = !pixelated;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        rasterCanvas(image),
        view.x0,
        view.y0,
        image.width * scale,
        image.height * scale,
      );
    }
    overlay?.(ctx, view);
  }, [ref, size, image, pixelated, underlay, overlay, lw, lh]);

  return (
    <canvas
      ref={ref}
      className={`${props.className ?? ''}${props.checker === false ? '' : ' checker'}`}
      data-testid={props.testId}
      aria-label={props.ariaLabel}
      role={props.ariaLabel ? 'img' : undefined}
    />
  );
}
