# Directions, symmetry and asymmetry

## The eight directions

A direction is the way the character **faces on screen**. The camera looks "up" the screen from
the south:

```
            N            (back view — facing away)
       NW       NE
     W             E     (profiles — facing screen-left / screen-right)
       SW       SE
            S            (front view — facing the viewer)
```

The default sheet order is `N, NE, E, SE, S, SW, W, NW`. Other presets: clockwise from S,
counter-clockwise from E (math angle order) and counter-clockwise from S, or any custom order.

World axes: `+x` = east (screen right), `+y` = north (away from the camera). Each direction has a
unit facing vector `f`, e.g. `S = (0, −1)`, `NE = (√½, √½)`.

## Where each side of the body appears

For a character facing `f`, its **right** side points along `r = (f.y, −f.x)`:

- `r.x` is the screen position (−1 = viewer's left, +1 = viewer's right),
- `−r.y = f.x` is the depth toward the camera (+1 = nearest to the viewer).

| Facing | right side: screen | right side: depth | left side |
| --- | --- | --- | --- |
| N | right | level | left, level |
| NE | right | **near** | left, far |
| E | centre | **near** (right profile) | hidden |
| SE | left | **near** | right, far |
| S | left | level | right, level |
| SW | left | far | right, near |
| W | centre | far (hidden) | **near** (left profile) |
| NW | right | far | left, near |

`src/core/asymmetry/sides.ts` implements this; the tests in `tests/unit/asymmetry.test.ts` pin the
table down.

## Why mirroring is wrong for asymmetric characters

Flipping an image horizontally maps `screenX → −screenX` but keeps depth. For every direction the
true view of the mirrored direction differs from the flipped image in the screen side *or* the
depth of each body side. Example: flipping the east view (right side near the camera) gives a
"west view" whose **right** side is still near the camera — but a real west view shows the **left**
side. A right-handed hockey player turns into a left-handed one. The unit test
"a mirrored view is NOT the same character" checks this for all eight directions.

Therefore Sprite8:

- never derives a view by mirroring when the character is **asymmetric** — no matter which
  settings are stored;
- for **symmetric** characters mirrors only across the screen's vertical axis
  (`E↔W`, `NE↔NW`, `SE↔SW`) and only when you explicitly enable the *symmetry shortcut*;
- never "mirrors" N from S (the back of a character is not the mirrored front);
- mirrors around the **foot anchor**, so the character keeps its ground position (a naive canvas
  flip would shift characters whose feet are not centred);
- warns about what mirroring still gets wrong even for symmetric characters: lighting flips with
  the image, and text or logos come out reversed.

Switching a project from symmetric to asymmetric offers to remove views that were created by
mirroring.

## Opposite-view outlines

Seen through an orthographic camera, a body viewed from the opposite direction (N↔S, NE↔SW, E↔W,
SE↔NW) projects to exactly the **mirrored outline** — for symmetric *and* asymmetric characters.
Only the interior (face or back of the head, which hand is in front) is unknown. Sprite8 shows this
outline as a guide in empty cells and can stamp it as a base layer in the editor. With an elevated
camera it is an approximation.

## Handedness

- **Guess:** in a front, back or diagonal source view, long one-sided equipment makes the
  silhouette reach further to one side of the feet. The side on screen is translated back to the
  body side with the table above (front view: screen-left = character's right). Profile sources
  hide one side, so no guess is made. The feet themselves are located inside the body's core
  column, so equipment resting on the ground (a hockey blade) does not shift them.
- **Check:** for each generated view the same measurement must reach toward the screen side the
  table predicts. If it reaches the other way the view is flagged: *"This view may be mirrored
  (wrong hand)"* — the most common failure of image generators.

Both are heuristics and labelled as such; you can always set handedness and per-feature sides by
hand in the Analysis panel.

## Side-specific details

Features (clothing, equipment, accessories, markings) carry a body side (`right`, `left`, `centre`,
`both`) and an attachment (hand, shoulder, back, …). For each direction Sprite8 derives a hint such
as:

> Hockey stick (right hand): on the RIGHT side of the image, in front (near side).
> Backpack (on the back): hidden behind the body, maybe peeking out at the edges.

The hints appear in the direction details and the editor, and are added to every AI prompt along
with negative prompts against mirrored output.
