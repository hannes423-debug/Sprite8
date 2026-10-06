/**
 * Sprite Processor — deterministic image processing used everywhere else.
 * No AI happens here: trimming, scaling, background keying, palette work,
 * outlines and geometric transforms only.
 */
export * from './raster';
export * from './color';
export * from './transform';
export * from './bounds';
export * from './floodFill';
export * from './background';
export * from './pixelScale';
export * from './quantize';
export * from './outline';
export * from './normalizeImport';
