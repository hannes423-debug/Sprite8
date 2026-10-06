# Sprite8 reference servers

Servers implementing the [Sprite8 HTTP protocol v1](../../docs/providers.md#sprite8-http-protocol-v1).
Use one as a starting point to connect any model to Sprite8.

## `server.mjs` (Node, no dependencies)

```bash
node models/reference-server/server.mjs --backend echo            # returns the input unchanged
node models/reference-server/server.mjs --backend mock --port 7861 # test double
```

| Option | Default | |
| --- | --- | --- |
| `--port` | 7861 | |
| `--host` | 127.0.0.1 | |
| `--backend` | echo | `echo` or `mock` |
| `--delay` | 0 | artificial latency in ms |
| `--mirror-bug` | — | e.g. `NE,SW`: the mock swaps hands in these directions (to test Sprite8's handedness check) |
| `--out-scale` | 1 | the mock returns images N× larger than requested |

The **mock backend is not an AI model.** It distorts the source (offset, scale, colour noise,
squeezed or flipped silhouette) to imitate imperfect model output so the consistency pipeline can be
tested end-to-end — Sprite8's own e2e tests use it.

`png.mjs` is a small zlib-based PNG encoder/decoder used by the server and the tests.

## `diffusers_server.py` (Python)

```bash
pip install "diffusers>=0.30" transformers accelerate torch pillow
python models/reference-server/diffusers_server.py --model stabilityai/stable-diffusion-xl-base-1.0
python models/reference-server/diffusers_server.py --backend echo     # no ML packages needed
```

The HTTP layer uses only the Python standard library. The `diffusers` backend runs image-to-image
with the prompt Sprite8 sends; replace `DiffusersBackend.generate` with your own pipeline (multi-view
model, ControlNet, IP-Adapter, image-editing model …). The request contains the prompt, negative
prompt, instruction, seed, source view, reference views and the full character model.

Untested here against a GPU; the protocol layer is exercised with `--backend echo`.

Both servers send permissive CORS headers (`Access-Control-Allow-Origin: *`) and answer the
`Access-Control-Allow-Private-Network` preflight. Restrict them if you expose them beyond your own
machine.
