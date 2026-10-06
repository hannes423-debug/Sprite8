# Architecture

Sprite8 is a static single-page application (React + TypeScript + Vite). All image processing runs
in the browser on plain RGBA buffers; nothing requires a server except an optional image model.

The code is split so that the interesting parts can be tested without a browser:

```
src/core/      framework-free logic — every module unit-tested in Node (tests/unit)
src/editor/    pixel-editor engine (no React; driven by pointer/keyboard calls)
src/app/       application state (tiny external store) and actions
src/ui/        React components, canvases and styles
src/platform/  browser glue: canvas ⇄ RasterImage, PNG encode/decode, downloads, fullscreen
```

## Subsystems

| Subsystem | Folder | Responsibility |
| --- | --- | --- |
| **UI** | `src/ui` | Pipeline layout (Source → Analysis → Generator → Directions → Sprite sheet), dialogs, toasts, the editor overlay. Components only call actions; they never mutate state. |
| **Character Analysis** | `src/core/analysis` | Measures the source: silhouette, width profile → neck/shoulders/hips/knees, heads-tall, palette (exact or median-cut), dominant colours with names, outline colour/thickness, shading style, image symmetry (mask IoU + colour agreement on the best mirror axis), one-sided reach, handedness guess, character-type guess. Everything is labelled with a confidence; camera elevation is honestly reported as not measurable. |
| **Character Representation** | `src/core/character` | The persistent **character model** (`CharacterModel`): proportions, anatomy regions (head, torso, arms, hands, legs, feet), side-specific features (clothing / equipment / accessories / markings with body side and attachment), colours, style, handedness and style locks. Re-analysis refreshes measurements but keeps user edits. |
| **Direction System** | `src/core/directions` | The eight facing directions, their facing vectors, opposite and mirrored directions, compass positions, file-name parsing, sheet order presets and grid layouts (including multi-frame layouts). |
| **Direction Generator** | `src/core/generation` | Builds one prompt per direction from the character model (tag style for Stable Diffusion, instruction style for image-edit models), prepares provider inputs (integer upscale for pixel art, feet centred, contrasting plain background) and orchestrates generation of exactly one direction. |
| **Consistency System** | `src/core/consistency` | `conformToCharacter`: background removal → (undo pixel upscale) → trim → scale to the reference height → palette lock → outline lock → hard alpha → feet on the shared anchor. `consistencyReport`: height, ground line, centring, palette, main colours and handedness checks per direction. |
| **Symmetry System** | `src/core/symmetry` | Mirror rules (only across the screen's vertical axis, only for symmetric characters, only with the explicit shortcut), mirroring around the foot anchor, symmetrize, opposite-view outlines. |
| **Asymmetry System** | `src/core/asymmetry` | Side-visibility geometry (where the right/left side appears and whether it is near or far), feature placement hints, handedness guess from the source and the mirrored-hand check for generated views. |
| **Pose System** | `src/core/pose` | A 3D stick figure built from the measured proportions, turned to each direction (same geometry as the asymmetry system) and drawn as an OpenPose-style guide image. Sent to pose ControlNets (ComfyUI `{{POSE_IMAGE}}`, HTTP protocol `poseImage`). Deterministic; no model involved. |
| **Sprite Processor** | `src/core/sprite` | Raster primitives: flips, axis mirroring, rotations, nearest/area/bilinear/mode scaling, cropping, compositing, flood fill, background keying and defringing, pixel-scale detection, palette extraction and OKLab quantisation, outline detection/application, import normalisation. |
| **Animation System** | `src/core/animation` | `Animation → DirectionTrack (×8) → Frame[]`. Every track always has the same number of frames. Version 0.1 uses one `idle` frame per direction; generation, editing, export and storage already address `(animation, direction, frame)`. |
| **Sprite Sheet Exporter** | `src/core/export` | Computes one cell size, one anchor and one character scale for all cells (integer scale under pixel preservation), composes the sheet, renders per-cell PNGs, builds JSON metadata and writes store-only ZIP files. |
| **AI Provider** | `src/core/providers` | The `ImageGenerationProvider` interface and the built-in providers: *Guides only* (deterministic), ComfyUI, Stable Diffusion WebUI, Sprite8 HTTP protocol. |
| **Local Storage** | `src/core/storage` | IndexedDB autosave, localStorage preferences, portable `*.sprite8.json` project files, validation/migration of stored projects. |

## Data model

```
Project
├── setup            name · symmetry (symmetric | asymmetric) · source direction
├── source           trimmed native-resolution sprite + import facts
├── analysis         measurements (SpriteAnalysis)
├── character        CharacterModel (persistent reference, user-editable)
├── cell             shared working canvas: width, height, anchor (feet point)
├── animations[]     Animation → tracks[N…NW] → frames[] → { image, status, origin }
├── sheet            export settings
└── generation       seed, prompt style, extra prompts, scale mode, …
```

Every frame lives on the same **working cell** with the same **anchor** (the point between the feet
on the ground line). This is what keeps scale and ground position identical in all directions:
generated or imported views are conformed onto the cell, the editor edits the cell, the exporter
crops all cells with one shared transform.

Frame `status` records how pixels came to be: `empty`, `source`, `guide` (no pixels — guides only),
`ai`, `mirror`, `imported` or `edited`. It drives badges, protection prompts ("overwrite manual
work?") and the mirroring rules.

## Immutability, regeneration and undo

Rasters and frames are immutable. Replacing one direction creates new objects only along that
path; every other direction keeps the same object identity. Consequences:

- *Regenerate NE* replaces exactly one frame — the e2e test checks the other seven by identity.
- Undo/redo stores whole-document snapshots that share unchanged rasters, so a step costs only
  what changed. History is capped by entry count and memory (`src/core/project/history.ts`).
- The editor paints into a private copy and commits a finished raster per stroke.

## Generation flow

```
CharacterModel + setup ──► buildDirectionPrompt(direction)        (side rules for asymmetric)
source sprite ───────────► prepareProviderInput()                 (square canvas, plain background)
finished views ──────────► references (nearest directions first)
                     │
                     ▼
     provider.generateDirection(request)          — guides / ComfyUI / A1111 / HTTP / your own
                     │
         ┌───────────┴─────────────┐
   kind: ai                  kind: guide · mirror · source
         │                          │ (already on the working cell)
 conformToCharacter()               │
         └───────────┬─────────────┘
                     ▼
          one frame replaced (+ undo step) → consistencyReport() → badges & warnings
```

"Generate all" processes directions nearest to the source first so earlier results can serve as
references for later ones, skips locked directions, asks before overwriting edited or imported
work, and records the whole batch as one undo step.

## State management

`src/app/store.ts` is a ~60-line external store used through `useSyncExternalStore`. Actions in
`src/app/actions/*` are the only code that changes state:

- `document.ts` — `commitDoc` (pixel/frame changes with history), `updateProject` (settings
  without history), `undo`, `redo`.
- `project.ts`, `frames.ts`, `generation.ts`, `export.ts`, `settings.ts`, `persistence.ts`, `ui.ts`.

`window.sprite8.getState()` exposes the state read-only for debugging and automated tests.

## Testing

- `tests/unit` (Vitest, Node): sprite processing, analysis on synthetic and bundled sprites,
  direction/asymmetry geometry, symmetry rules, consistency pipeline, prompts, providers against
  mocked HTTP (ComfyUI, A1111, Sprite8 protocol), exporter + ZIP validity, history, storage, editor
  engine.
- `tests/e2e` (Playwright, Chromium): the complete workflow, the AI path through the reference
  server's mock backend, symmetric mirroring rules, persistence, keyboard shortcuts and a phone
  session with touch painting.
