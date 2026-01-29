# mpv-player Architecture

> **Note**: This document is the **Single Source of Truth** for the system architecture. All code changes must be reflected here immediately.

## 1. System Overview

**mpv-player** is a high-performance desktop media player built on **Electron**, leveraging **libmpv** via a custom **Node Native Addon** (C++/Objective-C) to deliver cinema-grade rendering (HDR/Dolby Vision) on macOS and Windows.

### 1.1 Core Value Proposition
- **Correct HDR Output**: Uses macOS `CAOpenGLLayer` with EDR (Extended Dynamic Range) support and PQ color space.
- **Modern Tech Stack**: Vue 3 Composition API + TypeScript + Electron + Node-API.
- **Robust Architecture**: Domain-Driven Design (DDD) principles with strict layering and state machine-driven logic.

---

## 2. High-Level Architecture (Architecture Diagram)

The system follows a strict **Layered Architecture**. Dependencies flow **inwards** (or downwards).

```mermaid
graph TB
    subgraph "Renderer Process (UI)"
        UI_Comp[Vue Components]
        UI_Store[Composables/State]
        UI_Comp --> UI_Store
    end

    subgraph "Main Process (Node.js)"
        IPC_Server[IPC Handlers]
        
        subgraph "Application Layer"
            VPA[VideoPlayerApp]
            Config[ConfigManager]
            WM[WindowManager]
        end
        
        subgraph "Core Domain Layer"
            CP[CorePlayer]
            PSM[PlayerStateMachine]
            Models[Media, Playlist, PlaybackSession]
        end
        
        subgraph "Infrastructure Layer"
            MMP[MpvMediaPlayer]
            Log[Logger]
            FS[FileSystemService]
        end
    end

    subgraph "Native Side (C++/Obj-C)"
        NAPI[Node-API Binding]
        Render[OpenGL/EDR Renderer]
        MPV[libmpv Core]
    end

    %% Communications
    UI_Store <-->|IPC JSON| IPC_Server
    IPC_Server --> VPA
    IPC_Server --> CP
    
    VPA --> CP
    VPA --> Config
    VPA --> WM
    
    CP --> MMP
    CP --> PSM
    
    MMP --> NAPI
    NAPI --> MPV
    NAPI --> Render
```

### 2.1 Key Modules Responsibilities

| Layer | Module | Responsibility |
| :--- | :--- | :--- |
| **UI** | `src/renderer` | User interaction, strictly "dumb" components driven by state from Main. |
| **Command** | `ipcHandlers` | **Router**. Decodes IPC messages and dispatches to Application Layer. No business logic. |
| **Application** | `VideoPlayerApp` | **Orchestrator**. Manages Windows, Playlist, Config, and high-level user intents. |
| **Core** | `CorePlayer` | **Engine Facade**. Manages the lifecycle of the playback engine and state machine. |
| **Infrastructure** | `MpvMediaPlayer` | **Adapter**. Translates generic `MediaPlayer` commands into `libmpv` C calls. |
| **Native** | `native/` | **Bridge**. Handles the C++ <-> JS boundary and platform-specific rendering. |

---

## 3. Core Class Design (Class Diagram)

This diagram details the static structure and relationships between the main classes.

```mermaid
classDiagram
    %% Core Interfaces
    class MediaPlayer {
        <<Interface>>
        +play(media)
        +pause()
        +seek()
        +setVolume()
        +getCurrentSession()
        +onStatusChange(cb)
    }

    class CorePlayer {
        <<Interface>>
        +play(media)
        +getPlayerStatus()
        +setVideoWindow(win)
    }

    %% Implementations
    class MpvMediaPlayer {
        -controller: LibMPVController
        -windowId: number
        +initialize(windowId)
        +play(media)
    }

    class CorePlayerImpl {
        -mediaPlayer: MediaPlayer
        -stateMachine: PlayerStateMachine
        -renderManager: RenderManager
        +play(media)
        +updateFromPlayerStatus()
    }

    class VideoPlayerApp {
        -corePlayer: CorePlayer
        -windowManager: WindowManager
        -configManager: ConfigManager
        -playlist: Playlist
        +createMainWindow()
        +handlePlayVideo(path)
    }

    class PlayerStateMachine {
        -state: InternalState
        +getState(): PlayerStatus
        +update(session)
    }

    class ConfigManager {
        -volume: number
        -playbackPositions: Map
        +load()
        +save()
    }

    class WindowManager {
        -windows: Map
        +createWindow(config)
        +getWindow(id)
    }

    %% Relationships
    VideoPlayerApp --> CorePlayer : Owns
    VideoPlayerApp --> WindowManager : Uses
    VideoPlayerApp --> ConfigManager : Uses
    VideoPlayerApp --> Playlist : Manages
    
    CorePlayerImpl ..|> CorePlayer : Implements
    CorePlayerImpl --> MediaPlayer : Uses
    CorePlayerImpl --> PlayerStateMachine : Updates
    
    MpvMediaPlayer ..|> MediaPlayer : Implements
```

---

## 4. Execution Flows (Flowcharts & Sequence Diagrams)

### 4.1 Application Startup Flow

```mermaid
flowchart TD
    Start[main.ts: runApp] --> Bootstrap[bootstrap.ts]
    Bootstrap --> CreateCore[createCorePlayer]
    Bootstrap --> CreateApp[new VideoPlayerApp]
    Bootstrap --> SetupIPC[setupIpcHandlers]
    
    CreateApp --> LoadConfig[ConfigManager.load]
    CreateApp --> InitPlaylist[Playlist.init]
    
    Bootstrap --> CreateWin[VideoPlayerApp.createMainWindow]
    CreateWin --> WM[WindowManager.createWindow]
    WM --> ElectronWin[new BrowserWindow]
    
    Bootstrap --> ListenApp[registerAppListeners]
    ListenApp --> Ready[App Ready]
```

### 4.2 Play Video Sequence (User Interaction)

```mermaid
sequenceDiagram
    participant UI as Renderer (Vue)
    participant IPC as IPC Handler
    participant App as VideoPlayerApp
    participant Core as CorePlayer
    participant MPV as MpvMediaPlayer
    participant Native as Native Addon

    UI->>IPC: send('play-video', path)
    IPC->>App: handlePlayVideo(path)
    
    rect rgb(240, 248, 255)
    note right of App: Window Preparation
    App->>App: Check if video window exists
    App->>App: create/focus VideoWindow
    App->>Core: setVideoWindow(win)
    Core->>MPV: setWindowId(win.id)
    end
    
    App->>Core: ensureMediaPlayerReady()
    
    App->>UI: broadcast('play-video-start')
    
    App->>Core: play(Media)
    Core->>MPV: play(Media)
    MPV->>Native: command("loadfile", path)
    
    loop Playback Loop
        Native->>MPV: Event (Property Change)
        MPV->>Core: emit('session-change')
        Core->>Core: StateMachine.update()
        Core->>App: emit('player-state')
        App->>UI: broadcast('player-state')
    end
```

### 4.3 State Update Flow (Data Flow)

How data bubbles up from the low-level engine to the UI.

```mermaid
flowchart BT
    MPV_Core[libmpv Core] -- "Events (C++)" --> NAPI[Node-API Binding]
    NAPI -- "Events (JS)" --> MMP[MpvMediaPlayer]
    
    subgraph "Infrastructure"
        MMP -- "Raw PlaybackSession" --> CP[CorePlayer]
    end
    
    subgraph "Domain Logic"
        CP -- "Session Data" --> PSM[PlayerStateMachine]
        PSM -- "Sanitized PlayerStatus" --> CP
    end
    
    subgraph "Application"
        CP -- "player-status Event" --> VPA[VideoPlayerApp]
    end
    
    subgraph "UI Boundary"
        VPA -- "IPC Broadcast" --> Renderer[Vue UI]
    end
```

---

## 5. State Management

The player logic is driven by a finite state machine to ensure deterministic behavior.

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> LOADING : play()
    LOADING --> PLAYING : playback_start
    PLAYING --> PAUSED : pause()
    PAUSED --> PLAYING : resume()
    
    %% Stop transitions (Strict flow: Active -> STOPPED)
    LOADING --> STOPPED : stop() / play(new)
    PLAYING --> STOPPED : stop() / play(new)
    PAUSED --> STOPPED : stop() / play(new)
    
    %% Lifecycle ends
    PLAYING --> ENDED : end_of_file
    
    %% Error handling
    LOADING --> ERROR : error
    PLAYING --> ERROR : error
    
    %% Reset path (Only from terminal states)
    STOPPED --> IDLE : reset()
    ENDED --> IDLE : reset()
    ERROR --> IDLE : reset()
    
    note right of PLAYING
        Auxiliary States (Orthogonal):
        * Seeking (Active in PLAYING/PAUSED)
        * Buffering (Network Status)
    end note
```

### 5.1 State Synchronization Strategy
*   **Source of Truth**: `libmpv` internal state.
*   **Polling/Events**: `MpvMediaPlayer` listens to `libmpv` events (via Native Addon) and updates `PlaybackSession`.
*   **Sanitization**: `PlayerStateMachine` takes raw `PlaybackSession` and derives a clean `PlayerStatus` (handling edge cases like "seeking while paused").
*   **Broadcast**: The sanitized `PlayerStatus` is broadcast to the UI via IPC. **UI never queries state directly; it only reacts to broadcasts.**

---

## 6. Directory Structure Mapping

```mermaid
graph LR
    src[src] --> main[main]
    src --> renderer[renderer]
    
    main --> app[application]
    main --> domain[domain]
    main --> infra[infrastructure]
    
    app --> core[core]
    app --> commands[command]
    app --> windows[windows]
    
    domain --> models[models]
    
    infra --> mpv[mpv]
    infra --> platform[platform]
    infra --> rendering[rendering]
```

## 7. Development Guidelines

### 7.1 Modifying Architecture
*   **Strict Layering**: Never import `VideoPlayerApp` into `CorePlayer`. Dependencies point down.
*   **Interface First**: If changing `CorePlayer` functionality, update the `MediaPlayer` interface first if it affects the contract.
*   **Single Source of Truth**: Update this document before merging any architectural changes.
