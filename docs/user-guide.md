# User guide

## 1. Source

Drop an image on the Source panel, tap it to choose a file, or paste an image (Ctrl/⌘+V). PNG, GIF,
WebP, JPEG and BMP are accepted. On import Sprite8:

- detects **upscaled pixel art** (e.g. a 32×48 sprite saved at 400 %) and works at the native
  resolution, so nothing gets blurred;
- removes a **solid background** (flood fill from the border; classic chroma-key colours such as
  magenta or green are also removed inside enclosed gaps). Painted art gets soft, decontaminated
  edges; pixel art keeps hard edges;
- trims the sprite and places it on the shared **working canvas** with its feet on the anchor.

Tags under the preview show what happened (native size, "upscaled 4× → native", "background
removed", "no transparency"). Images with neither transparency nor a uniform background keep their
background — use a transparent PNG for best results. Very large images are reduced to 512 px for
editing.

**Character symmetry.** *Symmetric*: left and right look the same (generic NPC, robot, plain
knight). *Asymmetric*: the sides differ (weapon hand, hockey stick, one shoulder pad, scars,
different gloves). Asymmetric characters are never mirrored. See [directions.md](directions.md).

**Source direction.** The direction the uploaded image faces. You can change it later; the source
moves to the new direction.

## 2. Analysis

**Analyze** measures the source and creates the **character model** — the persistent reference used
for every direction. Every value can be corrected; the small label under each name tells you how it
was obtained (*detected*, *likely*, *guess*, *not measurable*).

- Character type, symmetry (with what the image itself suggests), dominant hand, camera
  (elevated 2.5D by default — it cannot be measured from a single sprite), art style, shading,
  pixel art on/off, outline colour, proportions.
- Palette and main colours.
- **Description** — used in AI prompts. Describe outfit, equipment and anything distinctive.
- **Side-specific details** — clothing, equipment, accessories and markings with the body side they
  belong to (e.g. *Hockey stick · Equipment · Right side · Hand*). They produce placement hints for
  every direction and go into prompts.
- **Character model** — a tree view of the whole reference.

With a provider that can describe images (Stable Diffusion WebUI's CLIP interrogate, or a custom
server with `/analyze`) the first analysis also suggests a description.

## 3. Generate

The provider button shows which backend produces missing views; **Generate 8 directions** runs it
for every unlocked direction, starting next to the source. Directions with edited or imported
pixels are protected: you choose whether to skip or overwrite them. The whole run is one undo step;
**Stop** cancels it.

- **Symmetry shortcut** (symmetric characters only): mirror E→W, NE→NW, SE→SW. Lighting and
  text flip with the image — check the result.
- **Style locks**: palette, outline, shading, resolution, proportions, character scale, visual
  style. Palette lock snaps generated colours to the source palette (default for pixel art);
  outline lock re-applies the source outline colour; scale lock matches the reference height.
- **Advanced**: base seed, generation size (512/768/1024), prompt style (*tags* for Stable
  Diffusion, *instruction* for image-editing models), scale normalisation, variation strength,
  references, extra (negative) prompt and a live preview of the prompt for the selected direction.

## 4. Inspect, regenerate, edit

All eight directions are visible at once — in a compass layout with a **turntable** preview in the
centre (click to pause), or in sheet order. Each cell shows a status badge (*Source, AI generated,
Mirrored, Imported, Edited, Guide only, Empty*), a lock icon, and a ✓ or ⚠ for its consistency
report. Click a cell to select it, double-click to edit.

The details panel for the selected direction offers **Edit**, **Regenerate** (only this direction —
the others never change), **Variation** (AI providers), **Import image** (use a view drawn elsewhere
or made with another tool; it is scaled to the character height, aligned on the feet and matched to
the palette lock), **Mirror** (symmetric only), **Lock**, **PNG** and **Clear**. It also lists where
each body side and side-specific detail must appear and the consistency checks.

**Import views…** imports several files at once; the direction is read from the file name
(`hero_NE.png`, `hero-north-west.png`, `hero_back.png`).

## 5. Editor

| Tool | Key | Notes |
| --- | --- | --- |
| Pencil | B | Right mouse button erases; Alt+click picks a colour |
| Eraser | E | |
| Fill | G | Contiguous by default; can replace a colour everywhere; respects the selection |
| Eyedropper | I | |
| Select / move | M | Drag to select, drag inside to move, Alt+drag to duplicate, click to deselect |
| Pan | H or hold Space | Two-finger drag on touch screens |

- Brush size `[` / `]`, mirror painting (paints around the centre line).
- Selection (or whole frame): flip **F** / **Shift+F**, rotate **R** / **Shift+R** or any angle,
  scale (the whole character scales around its feet), opacity, copy/cut/paste
  (**Ctrl+C / X / V** — pasting keeps the position, so details can be moved between directions), delete,
  crop to selection, select all **Ctrl+A**, nudge with the arrow keys (**Shift** = 10 px),
  **Enter** applies a floating selection, **Esc** cancels it.
- Frame: symmetrize (front/back views of symmetric characters), **Stamp outline** (fills the
  opposite view's mirrored outline with the current colour as a base layer), clear.
- Reference & onion skin (**O**): overlay or compare any direction or the source.
- Zoom with the wheel, pinch, **+ / −**, fit with **0**.
- Undo/redo (**Ctrl+Z / Ctrl+Shift+Z**) is shared with the rest of the app.
- The strip at the bottom shows all eight directions live; tap one to switch. Frame controls
  duplicate the current frame in all directions (animation groundwork).

On phones the tools sit at the bottom and the panel opens as a bottom sheet (sliders button).

## 6. Export

The sprite sheet preview updates live. Settings: layout (8×1, 4×2, 2×4, 1×8, compass, custom), cell
size (original, 32–128 px or custom), pixel preservation (integer scaling only, hard edges),
nearest-neighbour scaling, export scale (1–4×), and under *Order, padding, anchor & background*:
direction order, padding, spacing, anchor point, centring (re-centre on the feet or keep positions),
transparent or coloured background, and the frame layout for animations.

Downloads: **Download all (ZIP)** (sheet + one PNG per direction + JSON), **Sheet PNG**,
**8 PNGs** (ZIP), **JSON**, **Copy JSON**. Format: [export-format.md](export-format.md).

## Saving your work

Projects are autosaved in the browser (IndexedDB) and restored on the next visit. **Save project**
downloads a portable `*.sprite8.json` file (all images embedded as PNG); **Open project** loads one.
**New project** clears the browser copy.

## Main-screen shortcuts

| Key | Action |
| --- | --- |
| 1 – 8 | Select N, NE, E, SE, S, SW, W, NW |
| Arrow keys | Move around the compass |
| Enter or E | Edit the selected direction |
| Shift+R / Shift+G | Regenerate the selected direction / generate all |
| Ctrl/⌘+Z, Ctrl/⌘+Shift+Z | Undo, redo |
| Ctrl/⌘+S, Ctrl/⌘+O | Save, open project file |
| ? | Help |

## Tips

- Pixel art: keep *Pixel preservation* on and use *Original* or a cell size that is an integer
  multiple of the sprite; otherwise the exporter reduces by whole factors and warns you.
- Painted / high-resolution art: turn pixel art off in the analysis to get smooth scaling and soft
  edges; consider unlocking the palette.
- Hockey sticks, spears and tails resting on the ground do not disturb alignment — the feet are
  found inside the body's core column.
- If an AI view swaps hands, the cell gets a ⚠ and the handedness check explains it. Regenerate
  that one direction, or fix it in the editor (select the item, cut, paste on the other side).
