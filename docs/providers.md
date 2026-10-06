# Generation providers

Sprite8 never talks to a model directly. Every backend implements one interface,
`ImageGenerationProvider` (`src/core/providers/types.ts`), and is listed in
`src/core/providers/registry.ts`. Choose and configure providers with the provider button in the
**8-direction generator** panel. Provider settings are stored in your browser (localStorage), never
in project files.

| Provider | Kind | Needs |
| --- | --- | --- |
| **Guides only (no AI)** — default | deterministic, offline | nothing |
| **ComfyUI (local)** | local AI | ComfyUI + a workflow + model weights |
| **Stable Diffusion WebUI (A1111 / Forge API)** | local AI | AUTOMATIC1111, Forge or SD.Next with `--api` |
| **Custom server (Sprite8 HTTP protocol)** | local or remote AI | any server implementing the protocol below |

Whatever the provider returns goes through the **consistency pipeline** before it reaches a
direction: background removal, scale to the reference height, palette/outline locks, feet on the
shared anchor. Then the direction is checked (height, ground, palette, main colours, handedness).

## Guides only (no AI)

Always available. For each direction it

- places the source sprite in the source direction,
- for **symmetric** characters with the *symmetry shortcut* enabled, mirrors the partner view
  (E→W, NE→NW, SE→SW) around the foot anchor,
- otherwise marks the direction as *guide only*: the cell shows proportion lines, R/L side markers
  and — when the opposite direction exists — its exact mirrored outline.

It does not invent unseen sides. Draw them in the editor, import images, or use an AI provider.

## ComfyUI

1. Start ComfyUI so that browsers may call it:

   ```bash
   python main.py --enable-cors-header            # allow any origin
   # or restrict it: --enable-cors-header http://localhost:5173
   ```

2. In Sprite8 choose **ComfyUI (local)**, keep `http://127.0.0.1:8188` (or use `/proxy/comfyui`,
   see below), press **Test connection** — it lists your installed checkpoints — and enter one
   under **Checkpoint**.
3. Generate.

### Workflows

Choose a bundled workflow under **Workflow** in the provider settings:

| Preset | |
| --- | --- |
| *Basic image-to-image* (default) | `sprite8-img2img-basic.json` — stock nodes only; a connectivity test (img2img tends to keep the source pose) |
| *SD 1.5 + pose ControlNet* | `sprite8-sd15-pose.json` — Sprite8 draws a pose skeleton per direction |
| *… + IP-Adapter identity* | `sprite8-sd15-pose-ipadapter.json` — adds identity from the source view (custom nodes) |
| *… + style LoRA* | `sprite8-sd15-pose-lora.json` — adds a LoRA, e.g. for pixel art |

The pose presets are described in [local-ai.md](local-ai.md) (setup for a 6 GB GPU). Anything else —
a multi-view model, an instruction-based image-editing model — you build yourself and paste under
**Advanced → Workflow** (a pasted workflow overrides the preset):

1. Build and test it in ComfyUI, using a **Load Image** node for the source view and a
   **Save Image** node for the result.
2. Export it in API format (**Workflow → Export (API)**; older versions: enable *Dev mode* in the
   settings and use *Save (API Format)*).
3. Replace values with placeholders. A string that is exactly `"{{SEED}}"` becomes a number.

| Placeholder | Value |
| --- | --- |
| `{{SOURCE_IMAGE}}` | uploaded source view (square canvas, plain background) — for variations the current view of the direction |
| `{{REFERENCE_IMAGE_1}}` … `{{REFERENCE_IMAGE_4}}` | other finished views, nearest directions first (falls back to the source) |
| `{{PROMPT}}` | prompt in the chosen style (tags or instruction) |
| `{{NEGATIVE_PROMPT}}` | negative prompt (includes "mirrored, flipped, left-handed" for right-handed characters) |
| `{{INSTRUCTION}}` | natural-language instruction (for image-editing models) |
| `{{SEED}}` `{{STEPS}}` `{{CFG}}` `{{DENOISE}}` | sampler settings (denoise = variation strength for variations) |
| `{{WIDTH}}` `{{HEIGHT}}` | size of the uploaded canvas |
| `{{CHECKPOINT}}` | checkpoint from the provider settings |
| `{{POSE_IMAGE}}` | OpenPose-style skeleton of the character turned to the requested direction, aligned to the character on the canvas (uploaded only when the workflow uses it) |
| `{{MASK_IMAGE}}` | repaint mask for *Set Latent Noise Mask*: white where the character may appear (hull of the pose skeleton) |
| `{{INIT_IMAGE}}` | starting image: a blank background for new views, the current view for variations |
| `{{CONTROLNET}}` `{{CONTROL_STRENGTH}}` | pose ControlNet file name and strength from the provider settings |
| `{{LORA}}` `{{LORA_STRENGTH}}` `{{IPADAPTER_WEIGHT}}` | style LoRA and IP-Adapter settings |
| `{{DIRECTION}}` `{{SOURCE_DIRECTION}}` | e.g. `NE`, `S` |

Sprite8 uploads images to ComfyUI's `input` folder (`POST /upload/image`), queues the filled
workflow (`POST /prompt`), polls `GET /history/{id}` and downloads the first image output
(`GET /view`), or the node given under **Output node id**. Unknown placeholders and ComfyUI
validation errors are reported in the app.

## Stable Diffusion WebUI (AUTOMATIC1111, Forge, SD.Next)

Start the WebUI with its API enabled and allow the page that runs Sprite8:

```bash
./webui.sh --api --cors-allow-origins=http://localhost:5173
# hosted copy: --cors-allow-origins=https://<user>.github.io
```

Sprite8 uses `POST /sdapi/v1/img2img` (source view as init image, prompt, negative prompt, seed,
steps, CFG, denoising strength, optional checkpoint override), polls `GET /sdapi/v1/progress`, lists
models with `GET /sdapi/v1/sd-models`, and — if enabled — describes the character during analysis
with `POST /sdapi/v1/interrogate` (CLIP).

## Sprite8 HTTP protocol v1

A minimal JSON protocol so that any model — a `diffusers` pipeline, a Hugging Face model, a cloud
API, a WebUI — can be wrapped in a few lines. Reference implementations:

- `models/reference-server/server.mjs` — Node, zero dependencies. `--backend echo` returns the
  input (connectivity test); `--backend mock` is a **test double** that fakes imperfect model output
  for automated tests. Neither is an AI model.
- `models/reference-server/diffusers_server.py` — Python standard-library HTTP layer with a
  `diffusers` image-to-image backend (`--backend echo` works without any ML packages).

### `GET {endpoint}/health`

```json
{ "name": "My server", "version": "1.0", "protocol": "sprite8/1", "model": "sdxl", "capabilities": ["generate", "variation"] }
```

### `POST {endpoint}/generate`

Request (`Content-Type: application/json`; `Authorization: Bearer …` if an API key is configured):

```json
{
  "protocol": "sprite8/1",
  "mode": "direction",
  "direction": "NE",
  "sourceDirection": "S",
  "prompt": "pixel art game sprite, …, three-quarter back view …",
  "negativePrompt": "multiple characters, …, mirrored, flipped, left-handed",
  "instruction": "Redraw the exact same character … Do not mirror or flip the character …",
  "promptStyle": "tags",
  "seed": 123456,
  "width": 768,
  "height": 768,
  "background": "#ffffff",
  "sourceImage": "<base64 PNG>",
  "poseImage": "<base64 PNG>",
  "references": [{ "direction": "E", "image": "<base64 PNG>" }],
  "character": {
    "name": "hockey_player",
    "type": "humanoid",
    "description": "ice hockey player in a red jersey …",
    "symmetry": "asymmetric",
    "handedness": "right",
    "camera": "elevated",
    "sourceDirection": "S",
    "style": { "art": "pixel-art", "shading": "cel", "pixelArt": true, "outline": { "enabled": true, "color": "#1d1b2b", "thickness": 1 } },
    "proportions": { "heightPx": 54, "widthPx": 37, "neckY": 0.24, "shoulderY": 0.31, "hipY": 0.6, "kneeY": 0.8, "headsTall": 4.2, "measured": true },
    "features": [{ "id": "f1", "name": "Hockey stick", "category": "equipment", "side": "right", "attachment": "hand", "notes": "" }],
    "palette": ["#d23b3b", "#1d1b2b", "…"]
  }
}
```

For variations: `"mode": "variation"`, plus `"baseImage"` (the current view of the direction) and
`"strength"` (0–1).

`sourceImage` is a square canvas with the character centred on a plain background (`background`);
pixel art is upscaled by an integer factor. `poseImage` is an OpenPose-style skeleton of the
character turned to `direction` (black background, coloured limbs; the colours tell which side is
the character's right), drawn on the same canvas and aligned to the character — feed it to a pose
ControlNet or ignore it. The response may have any size and any background —
Sprite8 conforms it.

Response:

```json
{ "image": "<base64 PNG>", "seed": 123456, "notes": ["optional messages shown in the app"] }
```

Errors: any non-2xx status, or `{ "error": "message" }`.

### `POST {endpoint}/analyze` (optional)

Request: `{ "protocol": "sprite8/1", "image": "<base64 PNG>", "sourceDirection": "S", "symmetry": "asymmetric" }`.
Response (all optional): `{ "description": "…", "type": "humanoid", "handedness": "right",
"features": [{ "name": "…", "category": "equipment", "side": "right", "attachment": "hand", "notes": "" }], "notes": ["…"] }`.
Use it to plug in a captioning or vision-language model.

## Browsers, CORS and local servers

A web page may only call another origin if that server allows it (CORS). Three options:

1. **Use the dev proxy (simplest).** `npm run dev` (and `npm run preview`) serve same-origin proxy
   routes, so no CORS setup is needed:

   | Use this URL in Sprite8 | Forwards to (override with an environment variable) |
   | --- | --- |
   | `/proxy/comfyui` | `http://127.0.0.1:8188` (`SPRITE8_COMFYUI_URL`) |
   | `/proxy/a1111` | `http://127.0.0.1:7860` (`SPRITE8_A1111_URL`) |
   | `/proxy/sprite8` | `http://127.0.0.1:7861` (`SPRITE8_HTTP_PROVIDER_URL`) |

2. **Enable CORS on the server** (`--enable-cors-header` for ComfyUI, `--cors-allow-origins` for the
   WebUI; the reference servers allow every origin).

3. **Hosted copy (GitHub Pages) + local server.** Browsers treat `http://127.0.0.1` and
   `http://localhost` as trustworthy, so an HTTPS page may call them, but Chromium-based browsers
   may ask for permission to access devices on your local network — allow it. The reference
   servers also answer the older `Access-Control-Allow-Private-Network` preflight. Some browsers
   (notably Safari) block these requests; run Sprite8 locally instead.

## Writing a provider

```ts
import type { ImageGenerationProvider } from './types';

export const myProvider: ImageGenerationProvider = {
  id: 'my-provider',
  label: 'My model',
  kind: 'local-ai',                       // 'deterministic' | 'local-ai' | 'remote-ai'
  description: 'Shown in the provider dialog.',
  capabilities: { generatesNewViews: true, variations: true, analysis: false, references: false, seeds: true },
  settingsFields: [{ key: 'endpoint', label: 'Endpoint', type: 'url', default: 'http://127.0.0.1:9000' }],
  async checkStatus(settings, ctx) { return { ok: true, message: 'Ready.' }; },
  async analyzeCharacter() { return {}; },
  async generateDirection(req, ctx) {
    // req.prompt, req.input.image (RasterImage), req.references, req.character, req.seed …
    const png = await ctx.codec.encodePng(req.input.image);
    // … call your model with ctx.fetch, honour ctx.signal, report ctx.onProgress(0…1) …
    return { kind: 'ai', image: await ctx.codec.decode(resultBlob), seed: req.seed };
  },
  async generateVariation(req, ctx) { /* like generateDirection, starting from req.base */ },
};
```

Add it to `PROVIDERS` in `src/core/providers/registry.ts`. The settings form, connection test,
progress bars, cancellation, conforming and consistency checks come for free. Unit-test it with a
mocked `fetch` and the Node PNG codec, as in `tests/unit/providers.test.ts`.

In-browser (WebGPU) models fit the same interface: implement `generateDirection` with a
`kind: 'local-ai'` provider that runs the model in a worker.
