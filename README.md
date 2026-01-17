# mpv-player

An Electron + Vue + TypeScript desktop player that embeds libmpv via a native addon, with a focus on getting macOS HDR (EDR/PQ) output to look correct.

If you're working on “Electron + libmpv embedding (render API)” or “macOS HDR (PQ) semantics done right”, this repo is a practical, reusable reference implementation.

## Highlights

- Electron + Vue3 UI
- libmpv render API embedding (native addon)
- macOS HDR pipeline: CAOpenGLLayer + PQ colorspace + EDR enablement
- One-shot HDR debug print via IPC (mpv properties + native layer/display state)

## Status

- Primary target: macOS
- Native rendering: OpenGL (CAOpenGLLayer)
- This repo is actively used to validate HDR behavior against real displays and HDR sources

## Quick Start

Requirements:

- Node.js (recommended 20.x)
- macOS (HDR/EDR logic is macOS-focused)
- Xcode Command Line Tools (clang/make for node-gyp)
- Python (required by node-gyp)

Install:

```bash
npm install
```

If Electron download is slow:

```bash
# macOS/Linux
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install

# Windows (PowerShell)
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

Build native addon:

```bash
npm run build:native
```

Dev:

```bash
npm run dev
```

Build:

```bash
npm run build
```

## macOS HDR (What matters)

On macOS, “HDR looks correct” is not only about mpv `target-*` options. It heavily depends on whether the system recognizes your render surface as HDR/EDR and applies the correct PQ semantics.

What we do here:

- Use `CAOpenGLLayer` as the render surface
- When HDR is active:
  - Enable EDR on the layer (guarded by OS availability)
  - Set a PQ colorspace on the layer (e.g. DisplayP3_PQ / ITUR_2100_PQ)
  - Align mpv settings (`target-trc=pq`, `target-prim`, etc.)
- Centralize HDR detection/switching in native code

Key implementation:

- [native/mpv_render_gl.mm](native/mpv_render_gl.mm)

## HDR Debug (IPC one-shot print)

Send IPC `debug-hdr-status` and the main process prints:

- mpv-side: `video-params/*`, `target-*`, `tone-mapping`, etc.
- native-side: display EDR capability and layer EDR/PQ state

Entry points:

- [src/main/ipcHandlers.ts](src/main/ipcHandlers.ts)
- [src/main/corePlayer.ts](src/main/corePlayer.ts)
- [src/main/libmpv.ts](src/main/libmpv.ts)
- [native/binding.cc](native/binding.cc)

## Project Layout

```
.
├── native/                 # node-gyp native addon (libmpv binding + rendering)
├── src/
│   ├── main/               # Electron main process
│   ├── preload/            # preload scripts
│   └── renderer/           # Vue renderer
├── NATIVE_DEVELOPMENT.md   # native dev notes
├── electron.vite.config.ts
├── tsconfig*.json
└── package.json
```

## Contributing

- Issues/PRs are welcome, especially for macOS HDR, color management, and embedding stability.
- When reporting HDR issues, include the output of `debug-hdr-status` and your display model / macOS version.

## FAQ

### vue-tsc crash

This project pins `typescript` to `5.3.3` to avoid known compatibility issues with `vue-tsc@1.x`.
