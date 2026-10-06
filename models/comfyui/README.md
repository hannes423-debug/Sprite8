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
Expect it to keep the source pose unless the denoise is high (and identity then drifts) — for real
direction changes build a workflow around a multi-view model, ControlNet pose guidance, IP-Adapter
references or an image-editing model, and paste it into **Provider → Advanced → Workflow**.

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
