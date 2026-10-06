import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// Sprite8 is a static single-page app. A relative base lets the same build run
// from GitHub Pages (https://<user>.github.io/Sprite8/), any sub-folder, or a
// local file server without changes.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'SPRITE8_');
  const comfyTarget = env.SPRITE8_COMFYUI_URL || 'http://127.0.0.1:8188';
  const a1111Target = env.SPRITE8_A1111_URL || 'http://127.0.0.1:7860';
  const httpTarget = env.SPRITE8_HTTP_PROVIDER_URL || 'http://127.0.0.1:7861';

  // Optional same-origin proxies for local AI servers. They only exist while
  // running `npm run dev` / `npm run preview` and avoid CORS configuration:
  // point a provider at e.g. "/proxy/comfyui" instead of http://127.0.0.1:8188.
  const proxy = {
    '/proxy/comfyui': {
      target: comfyTarget,
      changeOrigin: true,
      ws: true,
      rewrite: (p: string) => p.replace(/^\/proxy\/comfyui/, ''),
    },
    '/proxy/a1111': {
      target: a1111Target,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/proxy\/a1111/, ''),
    },
    '/proxy/sprite8': {
      target: httpTarget,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/proxy\/sprite8/, ''),
    },
  };

  return {
    base: './',
    plugins: [react()],
    build: {
      target: 'es2022',
      sourcemap: true,
      assetsInlineLimit: 0,
    },
    server: { proxy },
    preview: { proxy },
  };
});
