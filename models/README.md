# models/

Integrations with image models. **No model weights are stored here** — Sprite8 connects to models
that you install and run yourself.

| Path | What it is |
| --- | --- |
| [`comfyui/`](comfyui/README.md) | ComfyUI workflow templates (API format) with Sprite8 placeholders |
| [`reference-server/`](reference-server/README.md) | Sprite8 HTTP protocol servers: Node (echo / mock test double) and Python (`diffusers`) |

## Choosing a model

What matters for 8-direction sprites:

- **Changing the view while keeping identity.** Plain image-to-image keeps colours and style but
  tends to keep the source pose. Better results come from models or workflows made for new views:
  multi-view diffusion models, pose guidance (ControlNet with an 8-direction pose set), identity
  guidance (IP-Adapter / reference images) or instruction-based image-editing models (use the
  *Instruction* prompt style).
- **Handedness.** Most models confuse left and right. Sprite8's prompts state where every one-sided
  item must appear and include "mirrored, flipped, left-handed" in the negative prompt; its
  handedness check flags views that still came out mirrored.
- **Starting point for a 6 GB GPU.** SD 1.5 + OpenPose ControlNet (+ IP-Adapter): Sprite8 draws the
  pose skeleton for every direction itself — see [docs/local-ai.md](../docs/local-ai.md).
- **Pixel art.** Generate at a high resolution; Sprite8 reduces the result to the sprite's native
  resolution with a majority-vote downscale and snaps it to the source palette (palette lock).

## Licences of common model families

Model licences change and differ between versions — **always read the model card**. As of writing:

| Model family | Typical licence | Commercial use |
| --- | --- | --- |
| Stable Diffusion 1.5 | CreativeML OpenRAIL-M | Allowed with use-based restrictions |
| Stable Diffusion XL 1.0 | CreativeML Open RAIL++-M | Allowed with use-based restrictions |
| FLUX.1 [schnell] | Apache-2.0 | Allowed |
| FLUX.1 [dev], FLUX.1 Kontext [dev] | FLUX.1 [dev] Non-Commercial License | Not without a separate licence |
| Qwen-Image / Qwen-Image-Edit | Apache-2.0 | Allowed |
| ControlNet 1.1 (OpenPose etc., lllyasviel) | CreativeML OpenRAIL-M | Allowed with use-based restrictions |
| IP-Adapter (h94) | Apache-2.0 | Allowed |
| CLIP ViT-H/14 image encoder (LAION) | MIT | Allowed |

Community fine-tunes, LoRAs and ControlNet/IP-Adapter weights each have their own licence, which
may be stricter than the base model's.
