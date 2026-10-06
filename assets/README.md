# Assets

| File | Description | License |
| --- | --- | --- |
| `examples/hockey-player.png` | 37×54 pixel-art ice hockey player, front view (S). **Asymmetric**: right-handed shot, so the stick blade is on the character's right side (the viewer's left); the jersey number "9" exposes any accidental mirroring. | CC0 1.0 |
| `examples/robot.png` | 30×47 pixel-art robot, front view (S). **Symmetric** around its centre line. | CC0 1.0 |

Both sprites are generated from code by [`scripts/build-example-assets.mjs`](../scripts/build-example-assets.mjs)
(`npm run assets`), which also writes the PWA icons in `public/` and the test fixture
`tests/fixtures/hockey-player-4x-white.png` (the hockey player upscaled 4× on an opaque white background,
used to test pixel-scale detection and background removal).

They are dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/): use them for anything, no attribution required.
