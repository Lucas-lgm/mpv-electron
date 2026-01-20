# mpv-player

An Electron + Vue + TypeScript desktop player that embeds libmpv via a native addon, with a focus on getting macOS HDR (EDR/PQ) output to look correct.

If you're working on “Electron + libmpv embedding (render API)” or “macOS HDR (PQ) semantics done right”, this repo is a practical, reusable reference implementation.

## Highlights

- Electron + Vue3 UI
- libmpv render API embedding (native addon)
- macOS HDR pipeline: CAOpenGLLayer + PQ colorspace + EDR enablement
- Advanced Dolby Vision support (Profile 5 & 8) with intelligent tone mapping
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

## macOS HDR & Dolby Vision

We have migrated to the `gpu-next` (libplacebo) backend for handling HDR and Dolby Vision.

**Key Features:**

- **Intelligent Tone Mapping**:
  - Automatically switches to **`st2094-10`** for Dolby Vision content.
  - Uses **`bt.2390`** (ITU-R recommended) for standard HDR10.
  - Enables **`hdr-compute-peak`** for dynamic scene-by-scene brightness analysis (similar to MadVR).
- **Dolby Vision Profile Support**:
  - **Profile 5** (Streaming): Full support with correct colors via `libplacebo` dynamic metadata.
  - **Profile 8** (iPhone): Smart detection to avoid rotation issues; renders as high-quality HLG/HDR10.
- **Native macOS Integration**:
  - Uses `target-colorspace-hint=yes` to pass accurate metadata to macOS's ColorSync and EDR pipeline.

What we do here:

- Use `CAOpenGLLayer` as the render surface.
- Delegate HDR/EDR handling to `libplacebo` (`gpu-next`), which manages:
  - Tone mapping (including Dolby Vision)
  - Colorspace conversion
  - Peak brightness adaptation
- The native layer (`mpv_render_gl.mm`) no longer manually forces `target-trc` or specific CALayer colorspaces, relying instead on the backend's internal logic.

Key implementation:

- [native/mpv_render_gl.mm](native/mpv_render_gl.mm) (Simplified integration)
- [docs/GPU_NEXT_INTEGRATION.md](docs/GPU_NEXT_INTEGRATION.md) (Migration details)

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
