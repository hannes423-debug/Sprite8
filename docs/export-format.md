# Export format

## Files

| File | Content |
| --- | --- |
| `<name>_sheet.png` | The sprite sheet |
| `<name>_<DIR>.png` | One cell per direction (single-frame animations) |
| `<name>_<animation>_<DIR>_<frame>.png` | One cell per direction and frame (multi-frame animations) |
| `<name>.json` | Metadata (below) |

`<name>` is the character name made file-system safe (letters, digits, `_`, `-`). **Download all**
packs everything into `<name>_sprite8.zip` (store-only ZIP — PNGs are already compressed).

## Cells, anchor and scale

- Every cell has the same size. Every character is drawn with the **same scale**, so it never
  changes size between directions.
- The **anchor** is the point between the feet on the ground line. With *bottom centre* (default)
  it is `(cellWidth / 2, cellHeight − padding)`; *cell centre* and custom anchors are available.
  Use it as the sprite origin/pivot in your engine.
- *Centring → auto-centre on the feet* moves each direction so its feet sit on the anchor (the
  first frame of each direction defines the offset for all its frames, so animations do not
  jitter). *Keep positions as edited* uses the working-canvas positions unchanged.
- **Cell size "Original"** keeps native pixels: the cell is the union of all directions plus
  padding, symmetric around the anchor.
- **Fixed cell sizes** (32, 48, 64, 96, 128 or custom) fit the largest direction into the cell.
  With *pixel preservation* the scale is an integer (2×, 3×, …) or an integer reduction (½, ⅓, …,
  with a warning), and alpha stays binary. Without it, scaling is smooth (area averaging) unless
  *nearest-neighbour* is enabled.
- **Export scale** multiplies the final output (cell size, anchor, spacing and every coordinate in
  the JSON are in exported pixels).

## Layouts

Single frame: `8x1` (default), `4x2`, `2x4`, `1x8`, `compass` (3×3 with an empty centre) or
`custom` columns × rows (rows grow to fit eight cells). Directions are placed row by row in the
chosen **order** (default `N, NE, E, SE, S, SW, W, NW`).

Several frames: one row per direction (frames left to right) or one column per direction (frames
top to bottom).

Optional **spacing** puts transparent (or background-coloured) gaps between cells.

## JSON metadata

The first keys follow the simple format engines and scripts expect; `sheet` and `animation` add
atlas rectangles.

```json
{
  "character": "hockey_player",
  "directions": {
    "N": "hockey_player_N.png",
    "NE": "hockey_player_NE.png",
    "E": "hockey_player_E.png",
    "SE": "hockey_player_SE.png",
    "S": "hockey_player_S.png",
    "SW": "hockey_player_SW.png",
    "W": "hockey_player_W.png",
    "NW": "hockey_player_NW.png"
  },
  "cellWidth": 64,
  "cellHeight": 64,
  "anchor": { "x": 32, "y": 60 },
  "sheet": {
    "image": "hockey_player_sheet.png",
    "width": 512,
    "height": 64,
    "columns": 8,
    "rows": 1,
    "spacing": 0,
    "order": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
  },
  "animation": {
    "name": "Idle",
    "kind": "idle",
    "frameCount": 1,
    "fps": 4,
    "loop": true,
    "frames": {
      "N": [{ "x": 0, "y": 0, "w": 64, "h": 64, "file": "hockey_player_N.png" }],
      "NE": [{ "x": 64, "y": 0, "w": 64, "h": 64, "file": "hockey_player_NE.png" }]
    }
  },
  "symmetry": "asymmetric",
  "handedness": "right",
  "sourceDirection": "S",
  "pixelArt": true,
  "scale": 1,
  "generator": { "name": "Sprite8", "version": "0.1.0", "url": "https://github.com/hannes423-debug/Sprite8" }
}
```

| Key | Meaning |
| --- | --- |
| `character` | File-safe character name |
| `directions` | Individual PNG per direction (first frame) |
| `cellWidth`, `cellHeight` | Cell size in exported pixels |
| `anchor` | Foot anchor inside each cell |
| `sheet` | Sheet image, size, grid and direction order |
| `animation.frames` | Per direction: rectangle on the sheet and individual file, one entry per frame |
| `symmetry`, `handedness`, `sourceDirection` | From the character setup |
| `pixelArt` | Pixel preservation was on |
| `scale` | Working pixels → exported pixels |

## Project files

`*.sprite8.json` stores the complete project (setup, source, analysis, character model, all frames
with their status and origin, export and generation settings). Rasters are embedded as PNG data
URLs. Files from older versions are upgraded on load; files from newer versions are rejected with a
message.
