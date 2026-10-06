/** Small stroke icon set drawn for Sprite8 (24×24 grid, 2px strokes). */
const PATHS = {
  upload: 'M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  sparkles:
    'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
  shuffle: 'M4 7h4l8 10h4M4 17h4l2-2.5M14 9.5L16 7h4M18 5l2 2-2 2M18 15l2 2-2 2',
  pencil: 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3',
  eraser: 'M3 16l8-8 7 7-5 5H8zM13 20h8M7 12l7 7',
  bucket: 'M5 11l7-7 7 7-7 7zM5 11h14M20 15.5c0 1.6 1 2.4 1 3.5a1 1 0 0 1-2 0c0-1.1 1-1.9 1-3.5z',
  eyedropper: 'M15 4l5 5M13 6l5 5-9 9H4v-5z',
  select: 'M4 4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4M4 7V4',
  move: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
  hand: 'M8 13V6a1.5 1.5 0 0 1 3 0v5V4.5a1.5 1.5 0 0 1 3 0V11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 14.5a1.6 1.6 0 0 1 2.6-1.8z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  onion: 'M9 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z',
  flipH: 'M12 3v18M9 7l-6 5 6 5zM15 7l6 5-6 5z',
  flipV: 'M3 12h18M7 9l5-6 5 6zM7 15l5 6 5-6z',
  rotateCw: 'M20 12a8 8 0 1 1-8-8h5M14 1l3 3-3 3',
  rotateCcw: 'M4 12a8 8 0 1 0 8-8H7M10 1L7 4l3 3',
  crop: 'M6 2v16h16M2 6h16v16',
  scale: 'M4 14v6h6M20 10V4h-6M4 20l7-7M20 4l-7 7',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  scissors:
    'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12',
  paste: 'M9 3h6v3H9zM7 4H5v17h14V4h-2',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.6-1.8',
  download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  fullscreenExit: 'M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4',
  sliders: 'M4 7h16M4 17h16M9 4v6M15 14v6',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.9-.9 1.5v.7M12 17h.01',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  play: 'M7 5l12 7-12 7z',
  pause: 'M8 5v14M16 5v14',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  mirror: 'M12 3v18M4 7l5 5-5 5zM20 7l-5 5 5 5z',
  folder: 'M3 6h6l2 2h10v11H3z',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  filePlus: 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6',
  warning: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  sheet: 'M3 5h18v14H3zM9 5v14M15 5v14M3 12h18',
  stop: 'M6 6h12v12H6z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  symmetry: 'M12 3v18M7 8a3 4 0 0 0 0 8M17 8a3 4 0 0 1 0 8',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  stamp: 'M9 4h6v6l3 3v3H6v-3l3-3zM5 20h14',
  opacity: 'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18',
  wand: 'M4 20L15 9M17 3v3M20 6h-3M19 3l-1.5 1.5M13 5l1 1M20 11l-1-1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  title,
  className,
}: {
  name: IconName;
  size?: number;
  title?: string;
  className?: string;
}) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
