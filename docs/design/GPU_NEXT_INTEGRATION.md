# GPU-Next Integration and HDR Refactoring

**Date**: 2026-01-19

## Overview

This document records the migration from the traditional `vo_opengl` / manual `vo_libmpv` HDR handling to the modern `gpu-next` (libplacebo) backend. The goal is to leverage `libplacebo`'s superior HDR tone mapping and Dolby Vision handling on macOS, simplifying the native integration layer.

## Key Changes

### 1. Build System & Dependencies
- **libmpv Compilation**:
  - Enabled `gpu-next` support in `libmpv` build.
  - **Vulkan Disabled**: explicitly set `-Dvulkan=disabled` in meson configuration to resolve missing header errors on macOS (`vulkan/vulkan.h` not found).
  - **RPATH Fix**: Added `LD_RUNPATH_SEARCH_PATHS` in `binding.gyp` and used `install_name_tool` to ensure `libmpv.2.dylib` can be loaded by the Electron app.

### 2. Native Code Refactoring (`native/mpv_render_gl.mm`)
- **Removed Manual HDR Logic**:
  - Deleted code that manually set `target-prim`, `target-trc`, and `target-peak` on the mpv render context.
  - Removed manual `CALayer` colorspace assignment (e.g., creating PQ colorspaces manually) in `update_hdr_mode`.
- **New Approach**:
  - Relies entirely on `gpu-next` (libplacebo) to handle swapchain configuration, colorspace signaling, and EDR (Extended Dynamic Range) management.
  - The native layer now acts as a thinner wrapper, primarily passing the FBO/Context to mpv.

### 3. Core Code Adaptations
- **Vertical Flip Fix**:
  - Modified `video.c` (in `gpu-next` port) to flip the Y-axis of `target_frame.crop`. This resolves the coordinate system mismatch between libplacebo (top-left origin) and OpenGL FBOs (bottom-left origin).
- **Backend Integration**:
  - Ported `render_backend_gpu_next` from `fork-mpv` to the current source tree.
  - Replaced `ra_next` abstraction with standard `ra` + `ra_pl` interface.

## Current Behavior

- **Dolby Vision**: Handled by `libplacebo`'s internal tone mapping (mapping DV metadata to the target display's HDR/SDR capabilities).
- **HDR on macOS**: The `gpu-next` backend automatically detects and utilizes the macOS EDR capabilities (when available and correctly configured in the windowing system).

## Resolved Issues (v1.3+)

- **HDR Overexposure**: ✅ **Resolved** - Implemented conservative `target-peak` calculation based on display EDR capability and proper tone mapping (`bt.2390` for HDR10, `st2094-10` for Dolby Vision).
- **Green/Purple Artifacts**: ✅ **Resolved** - Fixed through proper libplacebo configuration and Dolby Vision profile support (Profile 5 & 8).
- **Subtitle Rendering Issues**: ✅ **Resolved** - Fixed Y-coordinate flip in `gpu-next` backend when using `FLIP_Y=1` render parameter.
- **Video Rotation Problems**: ✅ **Resolved** - Proper rotation metadata handling in `gpu-next` backend.
- **SDR Colors Too Gray**: ✅ **Resolved** - Explicit `target-trc=srgb` configuration with proper primaries detection.

## Usage

The application now defaults to using the `gpu-next` backend logic embedded within `vo_libmpv`. No special `--vo` flag is needed as the priority has been adjusted in the source code.

---

## Update History

| Date | Changes | Version |
|------|---------|---------|
| 2026-01-25 | Updated issue status from "Pending" to "Resolved", matching README.md | v1.4 |
| 2026-01-19 | Initial documentation of GPU-Next integration | v1.3 |

## Related Documents

- [README.md](../README.md) - Project overview and current status
- [TROUBLESHOOTING.md](../development/TROUBLESHOOTING.md) - Problem solving guide
- [ARCHITECTURE.md](../ARCHITECTURE.md) - Complete system architecture
