# AI Skills Library

> **Purpose**: A collection of specialized "personas" or "skill sets" for the AI. You can copy these into your current session or add them to `.trae/rules.md` to enhance specific capabilities.

## 🟢 Vue 3 Composition Expert

**Usage**: Use when working on UI components (`renderer/`).

```markdown
### Skill: Vue 3 Composition Expert
1.  **Script Setup**: Always use `<script setup lang="ts">`.
2.  **Composables**: Extract logic into `composables/useFeature.ts` instead of large components.
3.  **Props/Emits**: Use `defineProps` and `defineEmits` with full type definitions.
4.  **Reactivity**: Prefer `ref` over `reactive` for clarity on what is reactive (requires `.value`).
5.  **Styling**: Use scoped SCSS/CSS or Tailwind (if configured). Avoid global styles in components.
```

## 🔵 Electron IPC Architect

**Usage**: Use when working on communication between Main and Renderer processes.

```markdown
### Skill: Electron IPC Architect
1.  **Type Safety**: All IPC channels must be typed in `src/common/types.ts`.
2.  **Handler/Invoker Separation**: 
    - Main process: `ipcMain.handle` (async) or `ipcMain.on` (sync/event).
    - Renderer: Wrap `ipcRenderer.invoke` in `window.electronAPI`.
3.  **Context Isolation**: Never expose `ipcRenderer` directly to the renderer. Use `contextBridge`.
4.  **Validation**: Validate all inputs in the Main process before use (Zod or runtime checks).
```

## 🟣 Native Addon Bridge (C++/Node-API)

**Usage**: Use when modifying the `native/` directory or `libmpv` bindings.

```markdown
### Skill: Native Bridge Architect
1.  **Thread Safety**: Node.js runs on the main thread. Heavy C++ work must be async (Worker threads or `napi_async_work`).
2.  **Memory Management**: Be careful with `napi_value` scopes. Handle C++ pointers/resources explicitly.
3.  **Error Propagation**: Catch C++ exceptions and convert them to `napi_throw_error`.
4.  **Type Mapping**: Ensure strict mapping between C++ structs and TS interfaces.
```

## 🟠 Technical Documentation Expert

**Usage**: Use when writing architecture docs, API references, or complex logic explanations.

```markdown
### Skill: Technical Documentation Expert
1.  **Visual Communication**: Use Mermaid.js for complex state machines, data flows, and class diagrams.
2.  **API Standardization**: Use JSDoc/TSDoc standards for all code comments.
3.  **Google Style Guide**: Follow "Clear, Concise, Active Voice". Avoid "please", "would", "should".
4.  **Single Source of Truth**: Identify the master document (e.g., `ARCHITECTURE.md`) and ensure all others reference it.
5.  **Code-Doc Sync**: Treat documentation as code. Version it, review it, and fail CI (mentally) if it drifts.
```

## 🔴 TDD Practitioner

**Usage**: Use when fixing bugs or writing complex logic.

```markdown
### Skill: TDD Practitioner
1.  **Red-Green-Refactor**: 
    - Write a failing test first (Red).
    - Write minimal code to pass (Green).
    - Refactor for cleanliness (Refactor).
2.  **Test Location**: Place unit tests next to the source file (e.g., `foo.spec.ts` next to `foo.ts`) or in `tests/`.
3.  **Mocking**: Mock external dependencies (Electron API, file system) to test logic in isolation.
```
