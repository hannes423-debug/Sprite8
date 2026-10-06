# Live tests

These tests send real requests to a model server you run yourself. They are **not** part of
`npm test` or CI — they are for checking a ComfyUI install (or a new workflow) end to end.

```bash
# ComfyUI running on this machine (add --cpu if you have no GPU; it is slow but works)
SPRITE8_COMFYUI_CHECKPOINT=v1-5-pruned-emaonly.safetensors \
SPRITE8_LIVE_PRESET=sd15-pose \
SPRITE8_LIVE_DIRECTIONS=E,N \
SPRITE8_LIVE_OUT=live-out \
npm run test:live
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `SPRITE8_COMFYUI_URL` | `http://127.0.0.1:8188` | ComfyUI address |
| `SPRITE8_COMFYUI_CHECKPOINT` | *(required)* | Checkpoint file name |
| `SPRITE8_LIVE_PRESET` | `sd15-pose` | `basic`, `sd15-pose` or `sd15-pose-lora` |
| `SPRITE8_LIVE_IMAGE` | `assets/examples/hockey-player.png` | Source image to use (any PNG, facing south) |
| `SPRITE8_LIVE_DIRECTIONS` | `E` | Comma-separated directions to generate |
| `SPRITE8_LIVE_STEPS` | `20` | Sampler steps |
| `SPRITE8_LIVE_DENOISE` | *(provider default)* | Denoise override |
| `SPRITE8_LIVE_CONTROL_STRENGTH` | *(provider default)* | Pose strength override |
| `SPRITE8_LIVE_IPA_WEIGHT` | *(provider default)* | IP-Adapter weight override |
| `SPRITE8_LIVE_IPA_MODE` | `standard` | `standard`, `style transfer` or `prompt is more important` |
| `SPRITE8_COMFYUI_LORA` | *(none)* | LoRA file for the `sd15-pose-lora` preset |
| `SPRITE8_LIVE_SIZE` | `512` | Generation canvas size |
| `SPRITE8_LIVE_OUT` | *(none)* | Folder for the source, pose guide, raw model output and conformed result PNGs |
| `SPRITE8_LIVE_EXTRA_PROMPT` | *(none)* | Added to every prompt |

Without `SPRITE8_COMFYUI_CHECKPOINT` the test is skipped.
