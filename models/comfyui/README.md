# ComfyUI templates

## `sprite8-img2img-basic.json`

A minimal image-to-image workflow made only of stock ComfyUI nodes:

```
Load Checkpoint ({{CHECKPOINT}})
Load Image ({{SOURCE_IMAGE}}) → VAE Encode ─┐
CLIP Text Encode ({{PROMPT}}) ──────────────┼─ KSampler (seed {{SEED}}, steps {{STEPS}}, cfg {{CFG}}, denoise {{DENOISE}})
CLIP Text Encode ({{NEGATIVE_PROMPT}}) ─────┘       → VAE Decode → Save Image (sprite8_{{DIRECTION}})
```

It is Sprite8's default ComfyUI workflow and a quick way to check that everything is connected.
Expect it to keep the source pose unless the denoise is high (and identity then drifts). For real
direction changes use the pose-guided presets below, or build a workflow around a multi-view model
or an image-editing model and paste it into **Provider → Advanced → Workflow**.

## Pose-guided presets (SD 1.5, 6 GB friendly)

These presets make Sprite8 draw an **OpenPose-style skeleton** for the requested direction (see
`src/core/pose/`) and upload it as `{{POSE_IMAGE}}`. A pose ControlNet makes the model follow it.
Select them in the provider settings (**Workflow**); setup steps and model downloads are in
[docs/local-ai.md](../../docs/local-ai.md).

| File | Adds | Needs |
| --- | --- | --- |
| `sprite8-sd15-pose.json` | pose ControlNet | SD 1.5 checkpoint, `control_v11p_sd15_openpose*` in `models/controlnet` |
| `sprite8-sd15-pose-ipadapter.json` | + IP-Adapter Plus identity from the source view | the above, `ip-adapter-plus_sd15` in `models/ipadapter`, `CLIP-ViT-H-14-laion2B-s32B-b79K` in `models/clip_vision`, and the custom nodes [ComfyUI_IPAdapter_plus](https://github.com/cubiq/ComfyUI_IPAdapter_plus) (GPL-3.0) |
| `sprite8-sd15-pose-lora.json` | + a style LoRA (`{{LORA}}`, `{{LORA_STRENGTH}}`) | the pose files and a LoRA in `models/loras` |

Besides the pose guide the presets use a **repaint mask** (`{{MASK_IMAGE}}` → *Load Image (as Mask)* →
*Set Latent Noise Mask*) and a **starting image** (`{{INIT_IMAGE}}`: a blank background for new
views, the current view for variations). The mask is the convex hull of the pose skeleton,
inflated; everything outside it keeps the plain background, so the result can be cut out again.
The *Keep the background plain* setting replaces the mask with an all-white one.

Placeholders used in addition to the basic ones: `{{POSE_IMAGE}}`, `{{MASK_IMAGE}}`, `{{INIT_IMAGE}}`, `{{CONTROLNET}}`,
`{{CONTROL_STRENGTH}}`, `{{LORA}}`, `{{LORA_STRENGTH}}`, `{{IPADAPTER_WEIGHT}}`. The pose image is
only rendered and uploaded when a workflow contains `{{POSE_IMAGE}}`, so older workflows are
unaffected. Pose workflows repaint the whole image (denoise 1.0); the source view still reaches the
sampler as the starting latent, which is what makes *Vary* (denoise = variation strength) work.

The files were validated against a real ComfyUI (node names, inputs, links) and run end to end with
SD 1.5 — see [tests/live/README.md](../../tests/live/README.md) to repeat that on your machine.

## Making your own template

1. Build the workflow in ComfyUI with a **Load Image** node for the view Sprite8 uploads and a
   **Save Image** (or Preview Image) node for the result.
2. Export it in API format (*Workflow → Export (API)*; in older versions enable *Dev mode* and use
   *Save (API Format)*).
3. Replace values with placeholders — see the table in
   [docs/providers.md](../../docs/providers.md#workflows). A value that is exactly `"{{SEED}}"`
   (with quotes) becomes a number, so the file stays valid JSON.
4. Paste it in Sprite8. If several nodes save images, set **Output node id**.

Reference views (`{{REFERENCE_IMAGE_1}}` … `{{REFERENCE_IMAGE_4}}`) are already-finished directions,
nearest to the requested one first — wire them into IP-Adapter or multi-image nodes to improve
identity consistency.
