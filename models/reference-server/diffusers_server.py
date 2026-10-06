#!/usr/bin/env python3
"""Sprite8 HTTP protocol v1 server backed by Hugging Face diffusers.

A starting point for running a real image model locally:

    pip install "diffusers>=0.30" transformers accelerate torch pillow
    python models/reference-server/diffusers_server.py \
        --model stabilityai/stable-diffusion-xl-base-1.0 --port 7861

Then choose "Custom server (Sprite8 HTTP protocol)" in Sprite8 and enter
http://127.0.0.1:7861.

The protocol layer (HTTP, CORS, JSON) only uses the Python standard library,
so `--backend echo` runs anywhere and is useful for checking connectivity.
The diffusers backend uses plain image-to-image: it re-draws the source view
with the direction prompt. That keeps colours and style but often keeps the
source pose, too — good direction changes need a model or workflow made for
it (multi-view models, ControlNet pose guidance, IP-Adapter, or an
instruction-based image editing model). Swap `DiffusersBackend.generate` for
your own pipeline; the request already contains everything Sprite8 knows
(prompt, instruction, side rules, character model, reference views).

Model weights have their own licences — check the model card before use.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROTOCOL = "sprite8/1"
VERSION = "0.1.0"


class EchoBackend:
    """Returns the input image unchanged (connectivity test)."""

    name = "echo"

    def generate(self, request: dict) -> dict:
        image = request.get("baseImage") if request.get("mode") == "variation" else None
        return {
            "image": image or request["sourceImage"],
            "seed": request.get("seed"),
            "notes": ["echo backend: returned the input unchanged"],
        }


class DiffusersBackend:
    """Image-to-image with any diffusers checkpoint (SD 1.5, SDXL, ...)."""

    def __init__(self, model: str, device: str | None, strength: float, steps: int, guidance: float):
        import torch  # noqa: PLC0415 — heavy imports only when this backend is used
        from diffusers import AutoPipelineForImage2Image  # noqa: PLC0415

        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
        dtype = torch.float16 if self.device in ("cuda", "mps") else torch.float32
        self.pipe = AutoPipelineForImage2Image.from_pretrained(model, torch_dtype=dtype).to(self.device)
        self.name = f"diffusers:{model}"
        self.strength = strength
        self.steps = steps
        self.guidance = guidance

    def generate(self, request: dict) -> dict:
        from PIL import Image  # noqa: PLC0415

        variation = request.get("mode") == "variation" and request.get("baseImage")
        source_b64 = request["baseImage"] if variation else request["sourceImage"]
        init = Image.open(io.BytesIO(base64.b64decode(source_b64))).convert("RGB")
        seed = int(request.get("seed") or 0)
        generator = self.torch.Generator(device="cpu").manual_seed(seed)
        strength = float(request.get("strength", 0.45)) if variation else self.strength
        result = self.pipe(
            prompt=request.get("prompt", ""),
            negative_prompt=request.get("negativePrompt") or None,
            image=init,
            strength=strength,
            num_inference_steps=self.steps,
            guidance_scale=self.guidance,
            generator=generator,
        ).images[0]
        buffer = io.BytesIO()
        result.save(buffer, format="PNG")
        return {
            "image": base64.b64encode(buffer.getvalue()).decode("ascii"),
            "seed": seed,
            "notes": [f"{self.name} img2img, strength {strength}"],
        }


def make_handler(backend):
    class Handler(BaseHTTPRequestHandler):
        server_version = f"Sprite8DiffusersServer/{VERSION}"

        def _headers(self, status: int, length: int | None = None) -> None:
            self.send_response(status)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            if length is not None:
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(length))
            self.end_headers()

        def _json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload).encode("utf-8")
            self._headers(status, len(body))
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:  # noqa: N802 — http.server naming
            self._headers(204)

        def do_GET(self) -> None:  # noqa: N802
            if self.path.rstrip("/") in ("", "/health"):
                self._json(200, {
                    "name": "Sprite8 diffusers server",
                    "version": VERSION,
                    "protocol": PROTOCOL,
                    "model": backend.name,
                    "capabilities": ["generate", "variation"],
                })
            else:
                self._json(404, {"error": f"Not found: {self.path}"})

        def do_POST(self) -> None:  # noqa: N802
            if self.path.rstrip("/") != "/generate":
                self._json(404, {"error": f"Not found: {self.path}"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                request = json.loads(self.rfile.read(length) or b"{}")
                if request.get("protocol") != PROTOCOL:
                    self._json(400, {"error": f"Unsupported protocol {request.get('protocol')!r}"})
                    return
                if not isinstance(request.get("sourceImage"), str):
                    self._json(400, {"error": "Missing sourceImage"})
                    return
                self._json(200, backend.generate(request))
            except Exception as exc:  # report every failure to the client
                self._json(500, {"error": str(exc)})

        def log_message(self, fmt: str, *args) -> None:
            sys.stderr.write(f"[sprite8] {fmt % args}\n")

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7861)
    parser.add_argument("--backend", choices=["diffusers", "echo"], default="diffusers")
    parser.add_argument("--model", default="stable-diffusion-v1-5/stable-diffusion-v1-5")
    parser.add_argument("--device", default=None, help="cuda, mps or cpu (auto by default)")
    parser.add_argument("--strength", type=float, default=0.8, help="img2img strength for new directions")
    parser.add_argument("--steps", type=int, default=30)
    parser.add_argument("--guidance", type=float, default=7.0)
    args = parser.parse_args()

    if args.backend == "echo":
        backend = EchoBackend()
    else:
        backend = DiffusersBackend(args.model, args.device, args.strength, args.steps, args.guidance)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(backend))
    print(f"Sprite8 server ({backend.name}) on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
