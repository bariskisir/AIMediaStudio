# AI Media Studio -- Development Guide

## Project Overview

AI Media Studio is a secure, Electron-based desktop application for generating images, videos, text-to-speech, and speech-to-text through OpenRouter's dedicated media APIs. Each media workflow (image, video, TTS, STT) has independent API credential scopes encrypted by the operating system. All generation jobs are persisted as local sessions with private media assets stored under `%AppData%\AIMediaStudio`.

## Tech Stack

| Layer             | Technology                                                          |
| ----------------- | ------------------------------------------------------------------- |
| Desktop Shell     | Electron 43 (with `vite-plugin-electron`)                           |
| Build             | Vite 8 (main, preload, and renderer bundles)                        |
| Language          | TypeScript 7.0                                                      |
| UI Framework      | React 19.2                                                          |
| State             | Redux Toolkit 2.12                                                  |
| Component Library | Ant Design 6.5                                                      |
| Styling           | SCSS Modules                                                        |
| Media Generation  | OpenRouter Images, Videos, TTS, and STT APIs                        |
| Localization      | i18next + react-i18next (en, tr, de, fr, pt, zh, es, ru, ja, ko)    |
| Validation        | Zod 4.4                                                             |
| Logging           | electron-log (main), custom log bridge (renderer)                   |
| Linting           | Biome (lint), Prettier (format)                                     |
| Testing           | Vitest 4.1                                                          |
| Packaging         | electron-builder (NSIS on Windows, DMG on macOS, AppImage on Linux) |

## Directory Structure

```
src/
├── shared/                          # Cross-process contracts (no runtime deps)
│   ├── appInfo.ts                    # App identity constants (author, repo URL)
│   ├── IpcChannel.ts                 # Enumerated IPC channel names (colon-delimited)
│   ├── openrouter.ts                 # OpenRouter media model contracts and capabilities
│   ├── speech.ts                     # Provider-neutral speech language choices
│   ├── types.ts                      # Domain types, settings schema, generation events, API bridge
│   └── video.ts                      # Provider-neutral video failure helpers
├── main/                             # Electron main process
│   ├── index.ts                      # App lifecycle, single-instance lock, service composition
│   ├── ipc.ts                        # IPC handler registration with Zod validation
│   ├── ApplicationPaths.ts           # AppData directory layout (Data, Logs, Runtime)
│   ├── settingsSchema.ts             # Zod schemas for settings (with migration support)
│   ├── security/
│   │   └── RendererNavigationPolicy.ts  # Allow-list for renderer navigations
│   └── services/
│       ├── AppUpdater.ts                  # GitHub Releases update check + installer launch
│       ├── AudioInputService.ts           # STT audio validation and session-owned staging
│       ├── CredentialService.ts           # OS-encrypted OpenRouter API key storage (per scope)
│       ├── ExportService.ts               # Renders session metadata as portable JSON
│       ├── GenerationService.ts           # Parallel media job coordinator with lifecycle persistence
│       ├── GitHubReleaseClient.ts         # GitHub Releases API client with verified downloads
│       ├── LoggerService.ts               # Daily rolling file logger (electron-log)
│       ├── MediaAssetService.ts           # Owns generated output files and asset resolution
│       ├── MediaProtocolService.ts        # Stream-capable custom protocol for secure media serving
│       ├── MediaRange.ts                  # HTTP byte-range parsing for media playback and seeking
│       ├── OpenRouterAccountService.ts    # OpenRouter credit balance verification
│       ├── OpenRouterCatalogService.ts    # Model discovery with last-successful local cache
│       ├── OpenRouterMediaService.ts      # Image, video, TTS, and STT transport for OpenRouter
│       ├── ReferenceImageService.ts       # Local reference image validation with opaque tokens
│       ├── StorageService.ts              # JSON file persistence for settings and sessions
│       ├── TrayService.ts                 # Optional system tray icon and close-to-tray behavior
│       └── WindowService.ts               # Hardened BrowserWindow creation and navigation policy
├── preload/
│   └── index.ts                      # Context bridge exposing AIMediaStudioApi to renderer
└── renderer/src/
    ├── entryPoint.tsx                # i18n init, React mount with Provider stack
    ├── App.tsx                       # Shell layout, page routing, update notice
    ├── App.module.scss               # App-level shell styles
    ├── assets/styles/                # Global SCSS (variables, resets, theme tokens)
    ├── components/
    │   ├── app/
    │   │   ├── AppNavigationActions.tsx   # Global window and settings actions
    │   │   ├── AppSidebar.tsx             # Persistent left nav with session list
    │   │   ├── Titlebar.tsx               # Custom draggable title bar with workspace nav
    │   │   └── WindowControls.tsx         # Frameless minimize/maximize/close controls
    │   └── sidebar/
    │       └── SessionsSidebar.tsx        # Session list creation, rename, and deletion
    ├── context/
    │   ├── AntdProvider.tsx           # Ant Design theme tokens and locale
    │   └── ThemeProvider.tsx          # Dark/light/system theme resolution
    ├── hooks/
    │   ├── useAppInit.ts              # Bootstrap + IPC event subscriptions
    │   ├── useDesktopActions.ts       # External links, logs, updates
    │   ├── useGenerationActions.ts    # Submit generation jobs and manage output files
    │   ├── useSessionActions.ts       # Create/rename/delete/export sessions
    │   └── useSettingsActions.ts      # Persisted settings with debounced API credential management
    ├── i18n/
    │   ├── index.ts                   # i18next init with 10 locales
    │   └── locales/                   # en.ts, tr.ts, de.ts, fr.ts, pt.ts, zh.ts, es.ts, ru.ts, ja.ts, ko.ts
    ├── pages/
    │   ├── home/
    │   │   ├── HomePage.tsx            # Left composer + right output workspace with resizable split
    │   │   ├── MediaModeControl.tsx    # Four media workflow selector (image/video/TTS/STT)
    │   │   └── *.module.scss           # Per-component styles
    │   └── settings/
    │       ├── SettingsPage.tsx         # Settings shell with section navigation
    │       ├── components/
    │       │   ├── MediaSettingsSection.tsx  # Reusable provider + model defaults editor
    │       │   └── SettingLabel.tsx          # Reusable labelled setting row
    │       └── sections/
    │           ├── GeneralSettingsSection.tsx
    │           ├── DisplaySettingsSection.tsx
    │           ├── ImageSettingsSection.tsx
    │           ├── VideoSettingsSection.tsx
    │           ├── TextToSpeechSettingsSection.tsx
    │           ├── SpeechToTextSettingsSection.tsx
    │           ├── UpdatesSettingsSection.tsx
    │           ├── LoggingSettingsSection.tsx
    │           └── AboutSettingsSection.tsx
    ├── services/
    │   ├── LoggerService.ts            # Renderer-side log bridge to main
    │   └── SettingsPersistenceQueue.ts # Serialized async settings writes
    ├── store/
    │   ├── index.ts                    # Redux store + typed hooks
    │   └── appSlice.ts                 # Single Redux slice (all app state)
    └── utils/
        ├── formatters.ts              # formatDate, formatPrice, session summary helpers
        ├── generationStatus.ts        # Lifecycle state to Ant Design status color mapping
        └── modelSettings.ts           # Capability-safe model ordering and setting reconciliation
tests/                                  # Vitest test files (19 tests)
├── AppSlice.test.ts
├── AudioInputService.test.ts
├── CredentialPropagation.test.ts
├── GenerationService.test.ts
├── GenerationStatus.test.ts
├── IpcChannel.test.ts
├── Localization.test.ts
├── LoggerService.test.ts
├── MediaRange.test.ts
├── ModelSettings.test.ts
├── OpenRouterAccountService.test.ts
├── OpenRouterCatalogService.test.ts
├── OpenRouterMediaService.test.ts
├── RendererNavigationPolicy.test.ts
├── SettingsPersistenceQueue.test.ts
├── SettingsSchema.test.ts
├── Speech.test.ts
├── StorageService.test.ts
└── TrayService.test.ts
vite.config.ts                          # Main + preload + renderer Vite build
vitest.config.ts                        # Test config with path aliases
tsconfig.json                           # Root config referencing node + web projects
tsconfig.node.json                      # Main/preload/tests TS config (ES2023, NodeNext)
tsconfig.web.json                       # Renderer TS config (ES2022, Bundler, JSX)
package.json
```

## Commands

```bash
npm run dev            # Start Vite dev server + Electron (hot reload for renderer)
npm run start          # Preview production build from out/
npm run build          # Typecheck + full Vite build (main, preload, renderer)
npm run typecheck      # Typecheck both node and web configs (no emit)
npm run typecheck:node # Typecheck main/preload/tests only
npm run typecheck:web  # Typecheck renderer only
npm run test           # Run Vitest suite once (node environment)
npm run test:watch     # Run Vitest in watch mode
npm run lint           # Biome lint on src, tests, and config files
npm run format         # Prettier format all files
npm run format:check   # Prettier check (CI)
npm run icons          # Generate PNG and ICO from SVG mark
npm run package        # Build + electron-builder (unpacked directory)
npm run package:win    # Build + NSIS installers for x64 and arm64
npm run package:win:x64    # Windows x64 NSIS installer only
npm run package:win:arm64  # Windows arm64 NSIS installer only
npm run release        # Alias for package:win
```

## Architecture

### Three-Layer Separation

The application enforces strict process isolation:

1. **Main Process** (`src/main/`): Full Node.js and Electron APIs. Owns all services (OpenRouter HTTP clients, file I/O, credential encryption, catalog caching, media protocol, auto-updater). Never exposes raw Node APIs to the renderer.

2. **Preload** (`src/preload/index.ts`): The sole bridge. Uses `contextBridge.exposeInMainWorld('app', api)` to expose a typed `AIMediaStudioApi` object. Only whitelisted IPC channels and event subscriptions pass through. The renderer has no access to `require`, `process`, or Node built-ins.

3. **Renderer** (`src/renderer/src/`): A sandboxed React application. All system interaction goes through `window.app.*` (the preload bridge). State lives in a single Redux store (`appSlice`). No direct file access, no shell access, no Node APIs.

### IPC Design

- **Channels**: Defined in `src/shared/IpcChannel.ts` as a string enum with `namespace:action` naming (`app:bootstrap`, `generation:start`, `event:session-updated`, etc.).
- **Invoke/Handle**: Commands (settings save, credential management, generation start, session export) use `ipcRenderer.invoke` / `ipcMain.handle` (request-response with Promise).
- **Send/On**: Renderer log entries use fire-and-forget `ipcRenderer.send` / `ipcMain.on`.
- **Main-to-Renderer Events**: Session state changes, errors, update progress, and window maximize changes are pushed via `webContents.send` and received by the preload's subscription helpers. Each subscriber returns a cleanup function.
- **Validation**: Every IPC handler in `src/main/ipc.ts` validates its input with Zod schemas before processing. Sender identity is verified by comparing `sender.id` to the main window's `webContents.id`.
- **Security**: External URL navigation is allow-listed (OpenRouter, GitHub, author site). Renderer navigations are restricted by `RendererNavigationPolicy.ts`. OpenRouter API keys are encrypted with Electron's `safeStorage` API.

### State Flow

```
User Action (renderer)
  -> hook (useGenerationActions)
  -> window.app.generate(request) [preload bridge]
  -> ipcRenderer.invoke('generation:start', payload) [IPC]
  -> ipcMain.handle + Zod validation [main]
  -> GenerationService.submit(generationRequest) [main service]
  -> OpenRouterMediaService (image/video/TTS/STT HTTP calls) [OpenRouter API]
  <- GenerationService handles job polling and lifecycle transitions
  <- webContents.send('event:session-updated') [main -> renderer]
  <- Preload subscription -> dispatch(setActiveSession())
  <- Redux updates sessions collection
  <- HomePage output panel re-renders
```

Settings and credential changes follow a similar path. Rapid UI updates use `SettingsPersistenceQueue` in the renderer to serialize concurrent writes before they reach `storage.updateSettings()`.

### Media Workflows

Four independent generation modes share the same composer interface:

- **Image** (`kind: 'image'`): Prompt → OpenRouter Images API (`/api/v1/images/generations`). Supports aspect ratio, resolution, quality, output format, background removal, count, output compression, and optional seed.
- **Video** (`kind: 'video'`): Prompt (+ optional reference images) → OpenRouter Videos API (`/api/v1/videos`). Async job with polling (default 30s interval, up to 240 attempts). Supports duration, resolution, aspect ratio, size, audio toggle, and frame images.
- **TTS** (`kind: 'tts'`): Input text → OpenRouter TTS API (`/api/v1/audio/speech`). Supports voice, speed (0.25-4.0), and MP3/PCM output formats.
- **STT** (`kind: 'stt'`): Input audio file → OpenRouter STT API (`/api/v1/audio/transcriptions`). Supports WAV/MP3/FLAC/M4A/OGG/WebM/AAC formats, optional language code, and temperature.

## Coding Conventions

### TypeScript

- **Strict mode everywhere**: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` in both tsconfig files.
- **Path aliases**: `@shared/*`, `@main/*`, `@renderer/*` -- configured in both tsconfig and Vite aliases.
- **Const assertions**: Domain constants use `as const` arrays then derive union types with `(typeof ARRAY)[number]`.
- **Explicit types**: All function parameters and return types are declared (no inference for public API surfaces).
- **No `any`**: Zod schemas validate unknown IPC input; internal code uses explicit types.

### Style

- **SCSS Modules**: Every component has a co-located `.module.scss` file. No global CSS beyond `assets/styles/index.scss` (variables, resets).
- **CSS Variables**: Theming uses CSS custom properties (`--color-border`, `--modal-background`, `--font-family`) toggled by the `theme-mode` attribute on `<body>`.
- **Ant Design token overrides**: Color, border radius, control heights, and motion duration are set in `AntdProvider.tsx` via `ConfigProvider` theme tokens. Primary color is `#756ef2` (dark) / `#4f46e5` (light).
- **Linting**: Biome for lint rules, Prettier for formatting. No ESLint.
- **No console**: Diagnostics use the custom `LoggerService` (main) or `createLogger()` (renderer), never `console.log`.

### React

- **Redux-first**: All shared state goes through the single `appSlice`. No prop drilling for cross-component data.
- **Hooks**: Business logic is extracted into custom hooks (`useAppInit`, `useGenerationActions`, `useSessionActions`, `useSettingsActions`, `useDesktopActions`). Components are mostly presentation.
- **Lazy loading**: The Settings page uses `React.lazy` + `Suspense` since it is secondary UI. Home page is eager.
- **No class components**: Everything is functional with hooks.
- **Ant Design v6**: Uses `AntdApp` wrapper for `message`/`notification` APIs (hook-based instead of static).
- **Resizable workspace**: The input/output split ratio is persisted as `workspaceInputPercent` (default 40%, range 25-75%) and controlled via drag handle or keyboard shortcuts.

### Services

- **Explicit dependency injection**: Main-process services accept their dependencies in constructors. No singletons or global imports.
- **Scoped credentials**: Each media workflow (image, video, TTS, STT) has an independently encrypted OpenRouter API key file. The `CredentialService.saveApiKeyAndFillEmptyScopes` pattern propagates a verified key to all empty scopes.
- **Async video polling**: `GenerationService` polls video job status at a configurable interval (default 30s) for up to 240 attempts before marking as expired. Restarts after application relaunch via `resumePendingJobs()`.
- **Batched persistence**: Session updates are serialized per document through `StorageService`'s operation queue to prevent interleaved writes.
- **Catalog caching**: `OpenRouterCatalogService` caches model catalogs locally and serves them while background-refreshing to avoid blocking the UI on startup.

### JSDoc

Every exported class, function, interface, and type alias has a JSDoc comment. File-level JSDoc blocks describe the module's purpose. Comments describe _why_, not _what_ -- the code is self-documenting for mechanics.

## Key Design Decisions

- **Single Redux slice** rather than multiple slices -- the app state is cohesive (generation parameters, session history, model catalogs, credentials, settings, and update state are all tightly coupled during media workflows).
- **Per-workflow credential scopes** -- image, video, TTS, and STT each have independent API keys with shared validation and auto-fill semantics.
- **Dedicated media protocol** (`aimedia:` scheme) -- generated media files are served through a custom protocol with HTTP range support for seekable video playback, preventing absolute path leaks.
- **Opaque reference tokens** -- `ReferenceImageService` validates local image files on the main process and returns short-lived opaque tokens to the renderer, never exposing file paths.
- **Settings serialization queue** -- `SettingsPersistenceQueue` ensures that rapid settings changes (e.g., toggling switches) are applied in order and the final Redux state always matches the last successful persistence.
- **Credentials are OS-encrypted** -- API keys are stored with Electron's `safeStorage` API (DPAPI on Windows, Keychain on macOS, libsecret on Linux). The plaintext is never written to disk.
- **Session-as-workspace invariant** -- there must always be at least one session. Bootstrap creates a session if none exist. Deleting the current session auto-selects the nearest available one.
- **Single instance lock** -- prevents multiple application windows. Second launch restores and focuses the existing window.
- **Auto-update via GitHub Releases** -- `AppUpdater` polls the GitHub Releases API, compares semver, downloads the platform-appropriate installer, and launches it with NSIS silent flags.
- **Localization is renderer-only** -- i18next runs in the renderer. i18n locale files are included in `tsconfig.node.json` includes so the main process can validate locale codes, but no UI strings are resolved in main.
- **Video job resilience** -- failed or interrupted video generation jobs are retried on application restart. Completed remote jobs are polled to detect late completion.
- **Capability-aware model switching** -- when a model is selected, `createCompatibleModelPatch` clamps settings to the model's advertised capabilities (enum values clamped to allowed set, numeric ranges clamped to min/max, booleans cleared when unsupported).

## Testing

- **Runner**: Vitest 4.1 with `environment: 'node'` (no jsdom needed for most tests, though jsdom is available as a dev dependency).
- **Path aliases**: Tests use the same `@main`, `@shared`, `@renderer` aliases as the source, configured in `vitest.config.ts`.
- **Test categories**:
  - **Unit**: Pure logic tests (`IpcChannel.test.ts`, `GenerationStatus.test.ts`, `MediaRange.test.ts`, `Speech.test.ts`, `SettingsPersistenceQueue.test.ts`, `ModelSettings.test.ts`).
  - **Redux**: State transition tests (`AppSlice.test.ts`).
  - **Validation**: Schema tests (`SettingsSchema.test.ts`).
  - **Integration**: Service tests with mocked dependencies (`StorageService.test.ts`, `GenerationService.test.ts`, `AudioInputService.test.ts`, `OpenRouterAccountService.test.ts`, `OpenRouterCatalogService.test.ts`, `OpenRouterMediaService.test.ts`, `CredentialPropagation.test.ts`, `LoggerService.test.ts`, `TrayService.test.ts`, `Localization.test.ts`, `RendererNavigationPolicy.test.ts`).
- **No E2E tests**: The project relies on Vitest unit/integration tests. There is no Playwright or Spectron setup.
- **Running tests**:
  ```bash
  npm run test         # Single run
  npm run test:watch   # Watch mode
  ```
