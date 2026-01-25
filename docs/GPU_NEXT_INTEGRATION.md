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

## Pending / Known Issues

- **HDR Overexposure**: Initial tests showed potential overexposure in DV/HDR content. This is currently under investigation (likely related to how `libplacebo` detects the peak brightness of the `CALayer` vs the reported display metadata).
- **Green/Purple Artifacts**: Some DV content may exhibit color artifacts, pointing to potential colorspace conversion mismatches or missing DV profile support in the current `libplacebo` version/configuration.

## Usage

The application now defaults to using the `gpu-next` backend logic embedded within `vo_libmpv`. No special `--vo` flag is needed as the priority has been adjusted in the source code.
