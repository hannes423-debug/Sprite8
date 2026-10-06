# Roadmap

## Phase 1 — MVP ✅

- Image upload (file picker, drag & drop, paste), source preview, background removal, pixel-art
  upscale detection, trimming.
- Symmetric / asymmetric selection, source-direction selection.
- 8-direction grid (compass and sheet order) with turntable preview.
- Deterministic processing: guides, opposite-view outlines, symmetry shortcut, consistency checks.
- Pixel editor (paint, erase, fill, pick, select/move, crop, scale, rotate, mirror, opacity,
  copy/paste across directions, undo/redo, onion skin, compare).
- Sprite sheet export (PNG, individual PNGs, JSON, ZIP) with layout, cell size, padding, spacing,
  anchor, background and export scale options.
- Autosave and portable project files.

## Phase 2 — AI-assisted generation ✅

- `ImageGenerationProvider` abstraction: guides (no AI), ComfyUI, Stable Diffusion WebUI,
  Sprite8 HTTP protocol (reference servers in Node and Python/diffusers).
- Persistent character model and per-direction prompts with side rules.
- Consistency system: conform pipeline (background, scale, palette, outline, anchor) and
  per-direction reports, including mirrored-hand detection.
- Regenerate or vary a single direction; earlier views are sent as references.

## Phase 3 — Animation (data model in place)

Already working: `animation × direction × frame` data model, frame duplication/deletion in the
editor, multi-frame sheet layouts and metadata, per-frame export files.

Next:
- Animation presets (idle, walk, run, attack, skate, hurt, death, custom) with frame counts
  (3, 4, 6, 8) and playback preview.
- Pose control and a simple skeleton/reference system (key landmarks per frame) to keep limbs
  consistent across directions.
- Generating frames with providers (pose-conditioned workflows). *Started:* per-direction pose
  guides and SD 1.5 + ControlNet workflows exist for the standing pose
  ([local-ai.md](local-ai.md)); animated poses are next.
- Importing frame sequences and sheets ("slice a turnaround sheet into directions").

## Phase 4 — Local models and advanced controls

- In-browser models via WebGPU (ONNX Runtime Web / transformers.js) behind the same provider
  interface: background removal for painted art, captioning for descriptions, and — when
  feasible — novel-view generation.
- ComfyUI workflow presets for multi-view and instruction-editing models, WebSocket progress.
- Advanced character controls: per-part colour ramps, light direction for symmetric mirroring,
  protected regions (logos, text), camera elevation presets.
- Offline support (service worker) and installable PWA polish.
