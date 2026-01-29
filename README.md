# mpv-player

An Electron + Vue + TypeScript desktop player that embeds libmpv via a native addon, with a focus on getting macOS HDR (EDR/PQ) output to look correct.

If you're working on "Electron + libmpv embedding (render API)" or "macOS HDR (PQ) semantics done right", this repo is a practical, reusable reference implementation.

## Highlights

- Electron + Vue3 UI
- libmpv render API embedding (native addon)
- macOS HDR pipeline: CAOpenGLLayer + PQ colorspace + EDR enablement
- Advanced Dolby Vision support (Profile 5 & 8) with intelligent tone mapping
- **gpu-next backend** (libplacebo) for superior HDR rendering quality
- Fixed subtitle rendering issues (rotation/flip) for all content types
- Proper SDR color space handling (no more gray/washed out colors)

## Status

- Primary target: macOS
- Native rendering: OpenGL (CAOpenGLLayer)
- Backend: **gpu-next** (libplacebo) - recommended for best HDR quality
- This repo is actively used to validate HDR behavior against real displays and HDR sources

## Quick Start

Requirements:

- Node.js (recommended 20.x)
- macOS (HDR/EDR logic is macOS-focused)
- Xcode Command Line Tools (clang/make for node-gyp)
- Python (required by node-gyp)
- Meson & Ninja (for building mpv submodule)

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

Build mpv submodule:

```bash
./build_mpv.sh
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

We use the **`gpu-next`** (libplacebo) backend for handling HDR and Dolby Vision, which provides superior tone mapping and color accuracy compared to the legacy `gpu` backend.

### Key Features

- **Intelligent Tone Mapping**:
  - Automatically switches to **`st2094-10`** for Dolby Vision content.
  - Uses **`bt.2390`** (ITU-R recommended) for standard HDR10 to avoid overexposure.
  - Disables **`hdr-compute-peak`** for stable, consistent brightness (prevents dynamic peak detection issues).
  
- **Peak Brightness Configuration**:
  - **Industry Standard**: `target-peak` should be set to the **actual measured peak brightness** of the display (in nits/cd/m²).
  - **Current Implementation**: Uses conservative estimates based on display EDR capability to prevent overexposure:
    - EDR ≤ 2.0: 500 nits
    - EDR ≤ 3.0: 700 nits
    - EDR > 3.0: 1000 nits
  - **Note**: The `auto` mode would ideally query the display's reported peak brightness via `target-colorspace-hint=yes`, but macOS may report overly high values (e.g., 10000 nits nominal), which can cause overexposure. The conservative estimates provide a safer default.
  - **Best Practice**: For accurate tone mapping, `target-peak` should match the display's actual measured peak brightness. Users with calibrated displays should set this value accordingly.

- **Dolby Vision Profile Support**:
  - **Profile 5** (Streaming): Full support with correct colors via `libplacebo` dynamic metadata.
  - **Profile 8** (iPhone): Properly handled with correct rotation and subtitle rendering.

- **Native macOS Integration**:
  - Uses `target-colorspace-hint=yes` to pass accurate metadata to macOS's ColorSync and EDR pipeline.
  - Properly sets `CAOpenGLLayer.wantsExtendedDynamicRangeContent = YES` for HDR content.
  - Configures correct PQ colorspace (`kCGColorSpaceITUR_2100_PQ` or `kCGColorSpaceDisplayP3_PQ`).

### SDR Color Accuracy

- **Explicit SDR Configuration**:
  - Sets `target-trc=srgb` for correct gamma curve (prevents gray/washed out colors).
  - Auto-detects display primaries (`bt.709` or `display-p3`).
  - Enables `target-colorspace-hint=yes` for proper system color management.
  - Uses ICC profile for accurate color reproduction.

### Implementation Details

**HDR Mode** (`native/mpv_render_gl.mm`):
- Detects HDR content via `video-params/gamma` (pq/hlg) and `video-params/primaries`.
- Enables EDR on `CAOpenGLLayer` (macOS 14.0+).
- Sets conservative `target-peak` based on display EDR capability.
- Uses `bt.2390` tone mapping for HDR10, `st2094-10` for Dolby Vision.
- Disables `hdr-compute-peak` for stability.

**SDR Mode**:
- Explicitly sets `target-trc=srgb` to prevent gray colors.
- Auto-detects display primaries (bt.709 or display-p3).
- Enables ICC profile for color management.

**Subtitle Rendering** (`mpv/video/out/gpu_next/video.c`):
- Fixed Y-coordinate flip issue when using `FLIP_Y=1` (libmpv render API).
- Properly handles subtitle coordinates in reversed crop coordinate system.
- Ensures subtitles render correctly for all content, including rotated iPhone videos.

**Video Rotation** (`mpv/video/out/gpu_next/video.c`):
- Properly handles video rotation metadata (`video-params/rotate`).
- Correctly applies rotation to source frames via libplacebo.
- Fixed iPhone MOV file rotation issues.

Key files:

- [native/mpv_render_gl.mm](native/mpv_render_gl.mm) (HDR/SDR configuration)
- [mpv/video/out/gpu_next/video.c](mpv/video/out/gpu_next/video.c) (libplacebo rendering & subtitle fixes)
- [docs/design/GPU_NEXT_INTEGRATION.md](docs/design/GPU_NEXT_INTEGRATION.md) (Migration details)

## Known Issues (Resolved)

### ✅ HDR Overexposure
**Status**: Fixed
- **Solution**: Conservative `target-peak` calculation + `bt.2390` tone mapping + disabled `hdr-compute-peak`.

### ✅ Subtitle Rotation/Flip Issues
**Status**: Fixed
- **Solution**: Fixed Y-coordinate handling in `gpu-next` backend when using `FLIP_Y=1` render parameter.

### ✅ iPhone Video Rotation
**Status**: Fixed
- **Solution**: Proper rotation metadata handling in `gpu-next` backend.

### ✅ SDR Colors Too Gray
**Status**: Fixed
- **Solution**: Explicit `target-trc=srgb` configuration + proper primaries detection.

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
│   ├── binding.cc         # Node.js addon API bridge
│   ├── mpv_render_gl.mm   # macOS OpenGL rendering + HDR/SDR config
│   └── binding.gyp        # node-gyp build config
├── mpv/                    # mpv submodule (gpu-next backend)
│   └── video/out/gpu_next/ # libplacebo rendering backend
├── src/
│   ├── main/               # Electron main process
│   ├── preload/            # preload scripts
│   └── renderer/           # Vue renderer
├── vendor/                 # Built libmpv libraries
├── build_mpv.sh            # Script to build mpv submodule
├── NATIVE_DEVELOPMENT.md   # native dev notes
├── electron.vite.config.ts
├── tsconfig*.json
└── package.json
```

## Building mpv Submodule

The project includes mpv as a git submodule with custom modifications for the `gpu-next` backend:

```bash
# Initialize submodule (if not already done)
git submodule update --init --recursive

# Build mpv
./build_mpv.sh

# The script will:
# 1. Configure mpv with meson
# 2. Build libmpv.2.dylib
# 3. Copy to vendor/mpv/darwin-arm64/lib/
```

The submodule tracks `release/0.41` branch from `git@github.com:Lucas-lgm/mpv.git`.

## Documentation

The project includes comprehensive documentation in the `docs/` directory:

- **[ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md)** - Complete system architecture, interfaces, and design patterns (1700+ lines)
- **[ARCHITECTURE_UPDATE_GUIDE.md](docs/architecture/ARCHITECTURE_UPDATE_GUIDE.md)** - Guide for keeping architecture documentation synchronized with code

### Development
- **[SETUP_GUIDE.md](docs/guides/SETUP_GUIDE.md)** - Development environment setup and configuration
- **[API_REFERENCE.md](docs/reference/API_REFERENCE.md)** - Quick reference for core APIs and usage examples
- **[TROUBLESHOOTING.md](docs/guides/TROUBLESHOOTING.md)** - Common problems and solutions

### Features & Plans
- **[GPU_NEXT_INTEGRATION.md](docs/design/GPU_NEXT_INTEGRATION.md)** - Migration to gpu-next (libplacebo) backend for HDR
- **[PLANNING_SEMANTIC_REFACTORING.md](docs/plans/PLANNING_SEMANTIC_REFACTORING.md)** - Plan for semantic refactoring (domain-driven design)

### Deployment
- **[DEPLOYMENT.md](docs/build/DEPLOYMENT.md)** - Complete guide for packaging and distribution

### Workflow
- **[workflow/](docs/workflow/)** - AI-assisted development workflow and templates
  - `PROMPT_TEMPLATES.md` - Standardized prompt templates
  - `WORKFLOW_CHECKLIST.md` - Development workflow checklist
  - `EXAMPLES.md` - Real-world usage examples
  - `PLANNING_TEMPLATE.md` - Planning document template

## Contributing

- Issues/PRs are welcome, especially for macOS HDR, color management, and embedding stability.
- When reporting HDR issues, include the output of `debug-hdr-status` and your display model / macOS version.
- When reporting rendering issues, include:
  - Video format (codec, container, HDR type)
  - Subtitle format (if applicable)
  - macOS version
  - Display model and EDR capability

## FAQ

### vue-tsc crash

This project pins `typescript` to `5.3.3` to avoid known compatibility issues with `vue-tsc@1.x`.

### HDR content looks overexposed

This has been fixed. If you still experience issues:
1. Check your display's EDR capability: `screen.maximumPotentialExtendedDynamicRangeColorComponentValue`
2. Verify `target-peak` is set correctly (should be conservative: 500-1000 nits)
3. Ensure `tone-mapping=bt.2390` for HDR10 content

### Subtitles are rotated or flipped

This has been fixed. If you still experience issues:
1. Check video rotation metadata: `video-params/rotate`
2. Verify subtitle format (ASS/SSA vs bitmap)
3. Report with video sample and subtitle file

### SDR content looks gray/washed out

This has been fixed. The player now explicitly sets `target-trc=srgb` for SDR content. If you still see issues, check your display's color profile.

## License

MIT
