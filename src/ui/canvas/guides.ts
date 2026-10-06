import { sidePlacement, type BodySide } from '../../core/asymmetry';
import type { Proportions } from '../../core/character';
import type { Direction } from '../../core/directions';
import type { WorkingCell } from '../../core/project';
import type { RasterImage } from '../../core/sprite';
import { rasterCanvas } from '../../platform/canvas';
import type { View } from './SpriteCanvas';

export interface GuideSpec {
  cell: WorkingCell;
  direction: Direction;
  proportions: Proportions | null;
  /** Height of the reference character in cell pixels. */
  referenceHeight: number | null;
  showProportions: boolean;
  showSideMarkers: boolean;
  compact: boolean;
}

export const SIDE_COLORS: Record<BodySide, string> = { right: '#ff9f5a', left: '#5ac8ff' };

const LANDMARKS: Array<[string, keyof Proportions | null]> = [
  ['top', null],
  ['neck', 'neckY'],
  ['shoulders', 'shoulderY'],
  ['hips', 'hipY'],
  ['knees', 'kneeY'],
];

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Construction guides: ground line, centre line, body landmarks and R/L side markers. */
export function drawGuides(ctx: CanvasRenderingContext2D, v: View, g: GuideSpec): void {
  const X = (x: number) => v.x0 + x * v.scale;
  const Y = (y: number) => v.y0 + y * v.scale;
  const { cell } = g;
  ctx.save();
  ctx.lineWidth = 1;
  // Ground line + anchor.
  ctx.strokeStyle = 'rgba(124,156,255,0.6)';
  line(ctx, X(0), Math.round(Y(cell.anchorY)) + 0.5, X(cell.width), Math.round(Y(cell.anchorY)) + 0.5);
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(124,156,255,0.32)';
  line(ctx, Math.round(X(cell.anchorX)) + 0.5, Y(0), Math.round(X(cell.anchorX)) + 0.5, Y(cell.height));
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(124,156,255,0.9)';
  ctx.beginPath();
  ctx.arc(X(cell.anchorX), Y(cell.anchorY), g.compact ? 2 : 3, 0, Math.PI * 2);
  ctx.fill();

  const H = g.referenceHeight;
  if (g.showProportions && g.proportions && H) {
    const top = cell.anchorY - H;
    const half = Math.max(g.proportions.widthPx * 0.6, H * 0.3);
    ctx.setLineDash([2, 3]);
    ctx.font = `600 ${g.compact ? 8 : 10}px system-ui, sans-serif`;
    for (const [label, key] of LANDMARKS) {
      const frac = key ? (g.proportions[key] as number) : 0;
      const y = Math.round(Y(top + frac * H)) + 0.5;
      ctx.strokeStyle = label === 'top' ? 'rgba(242,184,75,0.45)' : 'rgba(255,255,255,0.16)';
      line(ctx, X(cell.anchorX - half), y, X(cell.anchorX + half), y);
      if (!g.compact) {
        ctx.fillStyle = 'rgba(255,255,255,0.38)';
        ctx.fillText(label, X(cell.anchorX - half) + 2, y - 3);
      }
    }
    ctx.setLineDash([]);
  }

  if (g.showSideMarkers) {
    const shoulder = H && g.proportions ? cell.anchorY - H + g.proportions.shoulderY * H : cell.anchorY - cell.height * 0.5;
    const spread = Math.max(cell.width * 0.32, (g.proportions?.widthPx ?? 0) * 0.5);
    const r = g.compact ? 7 : 10;
    for (const side of ['right', 'left'] as const) {
      const p = sidePlacement(g.direction, side);
      const cx = X(cell.anchorX + p.screenX * spread);
      // Near side drawn lower/in front, far side higher/behind.
      const cy = Y(shoulder) + (p.placement === 'near' ? r * 0.9 : p.placement === 'far' ? -r * 0.9 : 0);
      ctx.globalAlpha = p.placement === 'far' ? 0.55 : 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (p.placement === 'far') {
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = SIDE_COLORS[side];
        ctx.lineWidth = 1.5;
        ctx.fillStyle = 'rgba(10,12,16,0.75)';
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = SIDE_COLORS[side];
        ctx.fill();
      }
      ctx.fillStyle = p.placement === 'far' ? SIDE_COLORS[side] : '#14161b';
      ctx.font = `800 ${g.compact ? 9 : 12}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(side === 'right' ? 'R' : 'L', cx, cy + 0.5);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

/** Draws a raster (e.g. the opposite-view outline) as a translucent guide. */
export function drawGuideImage(ctx: CanvasRenderingContext2D, v: View, img: RasterImage, alpha: number, pixelated: boolean): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = !pixelated;
  ctx.drawImage(rasterCanvas(img), v.x0, v.y0, img.width * v.scale, img.height * v.scale);
  ctx.restore();
}
