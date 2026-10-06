# Local AI with ComfyUI

This guide gets Sprite8 generating the eight directions with a model that runs **on your own
computer** — free, private, no account. It is written for modest hardware (a 6 GB GPU such as the
GTX 1060 6 GB) and uses only Stable Diffusion 1.5-class models.

> **Be realistic.** Sprite8 can only *ask* a model to draw sides of the character it has not seen.
> Small local models often get the colours and outfit right but the pose, the held item or the
> side wrong. Plan on regenerating a view a few times and fixing details in the editor — that is
> what the consistency checks, *Vary*, *Regenerate* and the pixel editor are for.

## What your hardware can run

| GPU memory | What works |
| --- | --- |
| **No GPU** | Everything below, on the CPU. Slow: about 3–4 minutes per view at 512 px on a 4-core CPU (measured). |
| **4–6 GB** (GTX 1060 6 GB, GTX 1650, RTX 3050 …) | **Stable Diffusion 1.5 + pose ControlNet + IP-Adapter** at 512 px — the setup in this guide. Expect very roughly 20–40 seconds per view on a GTX 1060 (an estimate — Pascal cards have no tensor cores). |
| **8–12 GB** | The same, faster; SDXL-class models become practical (set *Generation size* to 1024 and build an SDXL workflow). |
| **16 GB and more** | Image-editing models (Qwen-Image-Edit, FLUX Kontext …) via your own workflow with the *Instruction* prompt style. |

## How the pose-guided workflow works

An image model cannot be asked "show the back of this character" and be trusted. Sprite8 gives the
model more to hold on to:

1. **Pose guide** — for every direction Sprite8 draws an *OpenPose-style skeleton*: a stick figure
   built from the proportions it measured on your sprite, turned to face that direction. Colours
   mark the character's right and left side, so the right hand stays the right hand. Faces are
   hidden from behind, the far eye and ear disappear in profile. A **pose ControlNet** forces the
   model to follow this skeleton.
2. **Repaint mask** — small models like to paint a whole scene around the character (an ice rink,
   mountains), and a scene cannot be cut out again. Sprite8 therefore starts every new view from a
   *blank background* and lets the sampler repaint only an area around the new pose (ComfyUI's
   stock *Set Latent Noise Mask*); everything else stays the plain background. (Setting *Keep the
   background plain* in *Advanced* turns this off.)
3. **Identity** (optional preset) — an **IP-Adapter** shows the model your source sprite as an
   *image prompt*, so colours, outfit and hair carry over. Without it the model only knows what the
   text prompt says ("red jersey").
4. **Prompt** — view first ("back view, seen from behind"), then style, colours and the
   left/right rules from the asymmetry system, with the common mistakes as negatives ("face, eyes,
   front view").
5. **Consistency system** — whatever comes back is scaled to the reference height, snapped to the
   source palette and outline, put on the shared ground line and checked (including *mirrored
   hand* detection).

The skeleton is a neutral standing pose with the arms down: it carries direction and body
proportions, **not** equipment. Held items come from the source image (IP-Adapter) and the prompt.

## Setup (Windows, GTX 10-series)

1. **Update the NVIDIA driver** (the ComfyUI builds below need a recent one).
2. **Download the right ComfyUI.** The default download supports 20-series cards and newer only.
   For a GTX 10-series card use the **CUDA 12.6 build**:
   [`ComfyUI_windows_portable_nvidia_cu126.7z`](https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia_cu126.7z)
   (ComfyUI's README: *"Supports Nvidia 10 series and older GPUs"*). Extract it with 7-Zip.
3. **Download the models** and put them in the folders under `ComfyUI_windows_portable\ComfyUI\`:

   | File | Folder | Size | Source |
   | --- | --- | --- | --- |
   | `v1-5-pruned-emaonly.safetensors` (SD 1.5) | `models\checkpoints` | 4.3 GB | [stable-diffusion-v1-5 on Hugging Face](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5) |
   | `control_v11p_sd15_openpose_fp16.safetensors` | `models\controlnet` | 0.7 GB | [ControlNet-v1-1_fp16_safetensors](https://huggingface.co/comfyanonymous/ControlNet-v1-1_fp16_safetensors) |
   | `ip-adapter-plus_sd15.safetensors` *(identity)* | `models\ipadapter` | 0.1 GB | [h94/IP-Adapter → models](https://huggingface.co/h94/IP-Adapter/tree/main/models) |
   | `model.safetensors` from `models/image_encoder`, **renamed** `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors` *(identity)* | `models\clip_vision` | 2.5 GB | [h94/IP-Adapter → image_encoder](https://huggingface.co/h94/IP-Adapter/tree/main/models/image_encoder) |

   Only the first two are needed for the plain pose workflow.
4. **Identity preset only:** install the custom nodes
   [`ComfyUI_IPAdapter_plus`](https://github.com/cubiq/ComfyUI_IPAdapter_plus) — either through
   ComfyUI-Manager, or download the repository as a ZIP and extract it to
   `ComfyUI\custom_nodes\ComfyUI_IPAdapter_plus`. (It is licensed GPL-3.0 and its author has put it
   in maintenance-only mode; it works with the current ComfyUI at the time of writing.)
5. **Let the browser talk to ComfyUI.** Edit `run_nvidia_gpu.bat` and add `--enable-cors-header`:

   ```bat
   .\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --enable-cors-header
   pause
   ```

   Start it by double-clicking the file. When it prints `To see the GUI go to:
   http://127.0.0.1:8188`, it is ready. If it runs out of memory, add `--lowvram`.
6. **Connect Sprite8.** Open the app (the live site or `npm run dev`) **on the same computer**:
   - Press the provider button in the *8-direction generator* panel → **ComfyUI (local)**.
   - **Workflow:** *SD 1.5 + pose ControlNet + IP-Adapter identity* (or the plain pose workflow if
     you skipped the identity files).
   - **Checkpoint:** `v1-5-pruned-emaonly.safetensors`.
   - Press **Test connection**. It lists your checkpoints, ControlNets and whether the IP-Adapter
     nodes are installed, and warns about names that do not match.
7. **Generate.** Upload your sprite → *Analyze* → *Generate 8 directions*. Keep *Generation size*
   at **512 px** — that is what SD 1.5 was trained on, and larger sizes often produce duplicated
   figures.

On Linux or macOS, run `python main.py --enable-cors-header` from your ComfyUI folder. With a
10-series NVIDIA card on Linux, install a PyTorch build for CUDA 12.6 if you see *"no kernel image
is available"*.

### Using the hosted site

The Sprite8 page on GitHub Pages is served over HTTPS but can call ComfyUI on `127.0.0.1`.
Chrome and Edge may ask once whether the site may *connect to devices on your local network* —
allow it. Browsers refuse a page on `https://` calling a ComfyUI on another computer's address
(`http://192.168…`); in that case run Sprite8 itself on the machine that has the GPU, or use
`npm run dev` and the `/proxy/comfyui` URL (see [providers.md](providers.md#browsers-cors-and-local-servers)).

## What testing showed

The pose-guided workflow was run end to end against a real SD 1.5 + OpenPose ControlNet +
IP-Adapter install (on a CPU — about 3.5 minutes per view; a GPU is much faster) with two very
different characters: the pixel-art example hockey player and a painted, anime-style one that is
crouching with a stick. Honest summary:

- **It works for the hard part:** from a front-facing source the model produced back, side and
  three-quarter views that still look like the same character — helmet, jersey colours and stripes,
  gloves, skates — in the right direction, standing on the shared ground line at the reference
  height, on a removable plain background.
- **It is a neutral standing pose.** The crouch, the stick and other held items of the source are
  not carried over (the pose guide has no equipment), so Sprite8's handedness check warns on views
  where one-sided equipment is expected but missing. Add held items in the editor (copy/paste from
  the source direction, then mirror/transform the selection if needed).
- **Hallucinations happen:** invented jersey numbers and text, a stray belt, oversized sleeves,
  now and then a scene behind the character (the repaint mask removes most of those). One view in
  three may need a different seed. The consistency checks measure position, colour and
  handedness — not anatomy — so look at every view.
- **Tuning matters:** an IP-Adapter weight of 0.8 made back views show the face; 0.5 fixed that
  (it is the default). "Style transfer" mode kept less of the character's shape.

## The workflows

| Preset | Needs | Use it when |
| --- | --- | --- |
| **Basic image-to-image** | any checkpoint | checking the connection; keeps the source pose |
| **SD 1.5 + pose ControlNet** | SD 1.5 checkpoint, OpenPose ControlNet | the character is simple and the prompt can describe it |
| **… + IP-Adapter identity** | + IP-Adapter files and custom nodes | **recommended** — colours, outfit and hair carry over |
| **… + style LoRA** | + a LoRA (e.g. a pixel-art LoRA for SD 1.5) | you want crisper pixel-art output; set *Style LoRA* in the settings |

Settings that matter (provider dialog, some under *Advanced*):

- **Pose strength** (default 1.0) — how strictly the skeleton is followed. Lower it if the figure
  looks stiff or distorted.
- **IP-Adapter weight** (default 0.5) — how much of the source's look is copied. This is the most
  important knob for **back and side views**: the source is usually a front view, and a high weight
  copies that front-facing composition too, so a "back view" comes out showing the face. Raise it
  (0.7–0.9) if the outfit drifts; lower it if the character keeps facing the camera.
- **IP-Adapter mode** (*Advanced*) — *Standard* is the default. *Style transfer* copies colours but
  not the composition; in testing it also lost more of the character's shape, so it is an option
  for experiments rather than a recommendation.
- **Denoise** — leave at 0 (automatic: 1.0 for pose workflows). Lower values keep more of the
  source image and therefore more of its pose.
- **Steps** 20–30 and **CFG** 6–8 are good starting points. Every view has its own seed — press
  *Regenerate* (or *Vary* for a gentle variation of the current view) until one is right.

## Check your install

From the repository, with ComfyUI running:

```bash
SPRITE8_COMFYUI_CHECKPOINT=v1-5-pruned-emaonly.safetensors \
SPRITE8_LIVE_PRESET=sd15-pose-ipadapter \
SPRITE8_LIVE_DIRECTIONS=E,N \
SPRITE8_LIVE_OUT=live-out \
npm run test:live
```

It runs the example hockey player through the real workflow and saves the pose guide, the raw model
output and the conformed sprite for each direction into `live-out/` — see
[tests/live/README.md](../tests/live/README.md).

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| *"CUDA error: no kernel image is available"* on start | The PyTorch build does not include your GPU generation. Use the **cu126** ComfyUI download (10-series). |
| *"Could not reach ComfyUI"* | ComfyUI is not running, or was started without `--enable-cors-header`. |
| *"Value not in list"* for a checkpoint / ControlNet | The name in Sprite8 does not match a file in ComfyUI's model folders — press **Test connection** to see the exact names. |
| *"node … does not exist"* | The IP-Adapter custom nodes are not installed (or ComfyUI was not restarted afterwards). |
| Out-of-memory | Add `--lowvram` to ComfyUI's start command; keep *Generation size* at 512 px. |
| The view faces the wrong way (e.g. a back view shows the face) | Lower **IP-Adapter weight** (0.3–0.5); keep **Pose strength** at 1.0; try another seed. |
| A scene (mountains, floor …) behind the character | Keep **Keep the background plain** on (*Advanced*) — it is on by default — or try another seed. Sprite8 warns *"Could not find a uniform background to remove"* when a view still has one. |
| Two characters / duplicated limbs | *Generation size* is above the model's native size — use 512 px with SD 1.5. |
| Outfit or colours drift | Raise **IP-Adapter weight** a little; the palette lock still snaps colours to the source palette. |
| Blurry, not pixel-like | Use the style-LoRA preset with a pixel-art LoRA; Sprite8 also downsamples and palette-locks the result. |

## Licences

ComfyUI and ComfyUI_IPAdapter_plus are GPL-3.0 programs you run separately. SD 1.5 and the
ControlNet weights use the CreativeML OpenRAIL-M licence (commercial use allowed with
restrictions); IP-Adapter is Apache-2.0; the CLIP image encoder is MIT. Read each model card before
shipping a game with generated art — see [licenses.md](licenses.md) and
[../models/README.md](../models/README.md).
