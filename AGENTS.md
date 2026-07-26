# Transcript -- Development Guide

## Project Overview

Transcript is a secure, real-time desktop transcription application built on Electron. It captures microphone and speaker-loopback audio (speaker capture is Windows-only), streams audio to Deepgram's WebSocket API for speech-to-text, and optionally translates completed sentences through Google Translate or Bing Translate. All sessions are persisted locally in the user's AppData directory and can be exported as TXT or JSON.

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
| Speech-to-Text    | Deepgram WebSocket (Nova-3 family)                                  |
| Translation       | Google Translate API, Bing Translate API                            |
| Localization      | i18next + react-i18next (en, tr, de, fr, pt, zh, es)                |
| Validation        | Zod 4.4                                                             |
| Logging           | electron-log (main), custom log bridge (renderer)                   |
| Linting           | Biome (lint), Prettier (format)                                     |
| Testing           | Vitest 4.1                                                          |
| Packaging         | electron-builder (NSIS on Windows, DMG on macOS, AppImage on Linux) |

## Directory Structure

```
transcript/
├── src/
│   ├── shared/                  # Cross-process contracts (no runtime deps)
│   │   ├── appInfo.ts            # App identity constants (author, repo URL)
│   │   ├── deepgram.ts           # Deepgram model catalog, languages, helper functions
│   │   ├── IpcChannel.ts         # Enumerated IPC channel names (colon-delimited)
│   │   ├── pcmWorkletSource.ts   # AudioWorklet processor source (PCM16 conversion)
│   │   ├── transcription.ts      # Transcription provider types + Deepgram settings types
│   │   ├── translation.ts        # Translation providers, target languages, helpers
│   │   └── types.ts              # All domain types, settings schema, event types, TranscriptApi
│   ├── main/                     # Electron main process
│   │   ├── index.ts              # App lifecycle, single-instance lock, service composition
│   │   ├── ipc.ts                # IPC handler registration with Zod validation
│   │   ├── ApplicationPaths.ts   # AppData directory layout (Data, Logs, Runtime)
│   │   ├── settingsSchema.ts     # Zod schemas for settings (with migration support)
│   │   ├── security/
│   │   │   └── RendererNavigationPolicy.ts  # Allow-list for renderer navigations
│   │   └── services/
│   │       ├── AppUpdater.ts          # GitHub Releases update check + installer launch
│   │       ├── BingTranslateService.ts # Bing translation API client
│   │       ├── CredentialService.ts    # OS-encrypted Deepgram API key storage
│   │       ├── DeepgramAccountService.ts # Deepgram project balance verification
│   │       ├── DeepgramConnection.ts   # Single WebSocket connection to Deepgram
│   │       ├── DeepgramEndpoint.ts     # Deepgram WebSocket URL builder
│   │       ├── DeepgramMessageParser.ts# Deepgram streaming message parsing
│   │       ├── DeepgramService.ts      # Manages per-source Deepgram connections
│   │       ├── ExportService.ts        # Renders sessions to TXT/JSON
│   │       ├── GitHubReleaseClient.ts  # GitHub Releases API client
│   │       ├── GoogleTranslateService.ts # Google Translate API client
│   │       ├── LegacyDataMigrationService.ts # Migrates v2 session formats
│   │       ├── LoggerService.ts        # Daily rolling file logger (electron-log)
│   │       ├── StorageService.ts       # JSON file persistence for settings + sessions
│   │       ├── TranscriptSentenceMatcher.ts # Sentence boundary detection for translation
│   │       ├── TranscriptService.ts    # Session coordinator: start/stop/translate
│   │       ├── TranslationProviderService.ts # Provider router (Google vs Bing)
│   │       └── WindowService.ts        # BrowserWindow creation and media permissions
│   ├── preload/
│   │   └── index.ts              # Context bridge exposing TranscriptApi to renderer
│   └── renderer/src/
│       ├── entryPoint.tsx        # i18n init, React mount with Provider stack
│       ├── App.tsx               # Shell layout, page routing, update notice
│       ├── App.module.scss       # App-level shell styles
│       ├── assets/styles/        # Global SCSS (variables, resets, theme vars)
│       ├── audio/
│       │   └── AudioCaptureService.ts  # getUserMedia + AudioWorklet PCM capture
│       ├── components/
│       │   ├── app/
│       │   │   ├── AppSidebar.tsx       # Left nav: sessions list, settings icon
│       │   │   └── Titlebar.tsx         # Custom title bar with recording controls
│       │   └── sidebar/
│       │       └── SessionsSidebar.tsx  # Session list management panel
│       ├── context/
│       │   ├── AntdProvider.tsx   # Ant Design theme tokens + locale
│       │   └── ThemeProvider.tsx  # Dark/light/system theme resolution
│       ├── hooks/
│       │   ├── useAppInit.ts          # Bootstrap + IPC event subscriptions
│       │   ├── useDesktopActions.ts   # External links, logs, updates
│       │   ├── useRecordingActions.ts # Start/stop recording + audio capture
│       │   ├── useSessionActions.ts   # Create/rename/delete/export sessions
│       │   └── useSettingsActions.ts  # Persisted settings with debounce queue
│       ├── i18n/
│       │   ├── index.ts           # i18next init with 7 locales
│       │   └── locales/           # en.ts, tr.ts, de.ts, fr.ts, pt.ts, zh.ts, es.ts
│       ├── pages/
│       │   ├── home/
│       │   │   ├── HomePage.tsx        # Main workspace layout
│       │   │   ├── ControlBar.tsx      # Audio source toggles + record button
│       │   │   ├── TranscriptView.tsx  # Live transcript display surface
│       │   │   └── *.module.scss       # Per-component styles
│       │   └── settings/
│       │       ├── SettingsPage.tsx     # Settings shell with section nav
│       │       ├── components/
│       │       │   └── SettingLabel.tsx # Reusable labelled setting row
│       │       └── sections/
│       │           ├── GeneralSettingsSection.tsx
│       │           ├── TranscriptionSettingsSection.tsx
│       │           ├── TranslationSettingsSection.tsx
│       │           ├── UpdatesSettingsSection.tsx
│       │           ├── LoggingSettingsSection.tsx
│       │           └── AboutSettingsSection.tsx
│       ├── services/
│       │   ├── LoggerService.ts         # Renderer-side log bridge to main
│       │   └── SettingsPersistenceQueue.ts # Serialized async settings writes
│       ├── store/
│       │   ├── index.ts            # Redux store + typed hooks
│       │   └── appSlice.ts         # Single Redux slice (all app state)
│       └── utils/
│           └── formatters.ts       # formatDuration, formatDate, toSessionSummary
├── tests/                          # Vitest test files (14 tests)
│   ├── appSlice.test.ts
│   ├── DeepgramAccountService.test.ts
│   ├── DeepgramConnection.test.ts
│   ├── DeepgramEndpoint.test.ts
│   ├── DeepgramMessageParser.test.ts
│   ├── ExportService.test.ts
│   ├── Formatters.test.ts
│   ├── IpcChannel.test.ts
│   ├── Localization.test.ts
│   ├── LoggerService.test.ts
│   ├── RendererNavigationPolicy.test.ts
│   ├── SettingsPersistenceQueue.test.ts
│   ├── SettingsSchema.test.ts
│   └── StorageService.test.ts
├── vite.config.ts                  # Main + preload + renderer Vite build
├── vitest.config.ts                # Test config with path aliases
├── tsconfig.json                   # Root config referencing node + web projects
├── tsconfig.node.json              # Main/preload/tests TS config (ES2023, NodeNext)
├── tsconfig.web.json               # Renderer TS config (ES2022, Bundler, JSX)
└── package.json
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
npm run package        # Build + electron-builder (unpacked directory)
npm run package:win    # Build + NSIS installers for x64 and arm64
npm run package:win:x64    # Windows x64 NSIS installer only
npm run package:win:arm64  # Windows arm64 NSIS installer only
npm run release        # Alias for package:win
```

## Architecture

### Three-Layer Separation

The application enforces strict process isolation:

1. **Main Process** (`src/main/`): Full Node.js and Electron APIs. Owns all services (Deepgram WebSocket, file I/O, credential encryption, translation HTTP clients, auto-updater). Never exposes raw Node APIs to the renderer.

2. **Preload** (`src/preload/index.ts`): The sole bridge. Uses `contextBridge.exposeInMainWorld('app', api)` to expose a typed `TranscriptApi` object. Only whitelisted IPC channels and event subscriptions pass through. The renderer has no access to `require`, `process`, or Node built-ins.

3. **Renderer** (`src/renderer/src/`): A sandboxed React application. All system interaction goes through `window.app.*` (the preload bridge). State lives in a single Redux store (`appSlice`). No direct file access, no shell access, no Node APIs.

### IPC Design

- **Channels**: Defined in `src/shared/IpcChannel.ts` as a string enum with `namespace:action` naming (`app:bootstrap`, `session:start`, `event:transcript-result`, etc.).
- **Invoke/Handle**: Commands (settings save, session start, export) use `ipcRenderer.invoke` / `ipcMain.handle` (request-response with Promise).
- **Send/On**: High-frequency data (audio frames) and renderer logs use fire-and-forget `ipcRenderer.send` / `ipcMain.on`.
- **Main-to-Renderer Events**: Recording state changes, transcription results, translation results, errors, and update progress are pushed via `webContents.send` and received by the preload's subscription helpers. Each subscriber returns a cleanup function.
- **Validation**: Every IPC handler in `src/main/ipc.ts` validates its input with Zod schemas before processing. Sender identity is verified by comparing `sender.id` to the main window's `webContents.id`.
- **Security**: External URL navigation is allow-listed (Deepgram, GitHub, author site). Renderer navigations are restricted by `RendererNavigationPolicy.ts`. The Deepgram API key is encrypted with Electron's `safeStorage` API.

### State Flow

```
User Action (renderer)
  -> hook (useRecordingActions etc.)
  -> window.app.startSession() [preload bridge]
  -> ipcRenderer.invoke('session:start', payload) [IPC]
  -> ipcMain.handle + Zod validation [main]
  -> TranscriptService.start() [main service]
  -> DeepgramService.start() -> DeepgramConnection [WebSocket to Deepgram]
  <- DeepgramConnection parses streaming messages
  <- TranscriptService.handleResult() -> webContents.send('event:transcript-result')
  <- Preload subscription -> dispatch(receiveTranscriptResult())
  <- Redux updates currentSession.segments
  <- TranscriptView re-renders
```

Settings follow a similar path but use `SettingsPersistenceQueue` in the renderer to serialize concurrent writes before they reach `storage.updateSettings()`.

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
- **Ant Design token overrides**: Color, border radius, control heights, and motion duration are set in `AntdProvider.tsx` via `ConfigProvider` theme tokens. Primary color is `#00b96b`.
- **Linting**: Biome for lint rules, Prettier for formatting. No ESLint.
- **No console**: Diagnostics use the custom `LoggerService` (main) or `createLogger()` (renderer), never `console.log`.

### React

- **Redux-first**: All shared state goes through the single `appSlice`. No prop drilling for cross-component data.
- **Hooks**: Business logic is extracted into custom hooks (`useAppInit`, `useRecordingActions`, `useSessionActions`, `useSettingsActions`, `useDesktopActions`). Components are mostly presentation.
- **Lazy loading**: The Settings page uses `React.lazy` + `Suspense` since it is secondary UI. Home page is eager.
- **No class components**: Everything is functional with hooks.
- **Ant Design v6**: Uses `AntdApp` wrapper for `message`/`notification` APIs (hook-based instead of static).

### Services

- **Explicit dependency injection**: Main-process services accept their dependencies in constructors (e.g., `TranscriptService` receives `StorageService`, `CredentialService`, `DeepgramService`, etc.). No singletons or global imports.
- **Reusable but isolated**: Each `DeepgramConnection` is one WebSocket per audio source. `DeepgramService` manages the map of source-to-connection.
- **Cancellable operations**: `TranscriptService` supports cancelling in-progress starts via `SessionStartCancelledError`.
- **Batched persistence**: Transcript segments are batched every 250ms before writing to disk. Translation sentences are queued per language pair.

### JSDoc

Every exported class, function, interface, and type alias has a JSDoc comment. File-level JSDoc blocks describe the module's purpose. Comments describe _why_, not _what_ -- the code is self-documenting for mechanics.

## Key Design Decisions

- **Single Redux slice** rather than multiple slices -- the app state is cohesive (transcript results, session state, settings, audio levels are all tightly coupled during recording).
- **Per-source Deepgram connections** -- microphone and speaker each get their own WebSocket to Deepgram, enabling independent source tracking and separate `TranscriptResultEvent.source` fields.
- **Speaker loopback is Windows-only** -- the main process rejects `speakerEnabled` on non-Windows platforms at session start. The renderer disables the speaker toggle on macOS/Linux.
- **Preconnect audio buffering** -- `useRecordingActions` starts capture immediately and buffers up to 20 frames before the Deepgram WebSocket opens, then flushes them to avoid missing early speech.
- **Sentence-level translation** -- translation is not word-by-word; `TranscriptSentenceMatcher` detects completed sentences using punctuation boundaries, and only completed sentences are sent to the translation provider.
- **Settings serialization queue** -- `SettingsPersistenceQueue` ensures that rapid settings changes (e.g., toggling switches) are applied in order and the final Redux state always matches the last successful persistence.
- **Credentials are OS-encrypted** -- the Deepgram API key is stored with Electron's `safeStorage` API (DPAPI on Windows, Keychain on macOS, libsecret on Linux). The plaintext is never written to disk.
- **Session-as-workspace invariant** -- there must always be at least one session. Deleting the last session fails; the app ensures a replacement is returned. Bootstrap creates a session if none exist.
- **Single instance lock** -- prevents multiple application windows. Second launch restores and focuses the existing window.
- **Auto-update via GitHub Releases** -- `AppUpdater` polls the GitHub Releases API, compares semver, downloads the platform-appropriate installer, and launches it with NSIS silent flags.
- **Localization is renderer-only** -- i18next runs in the renderer. i18n locale files are included in `tsconfig.node.json` includes so the main process can validate locale codes, but no UI strings are resolved in main.

## Testing

- **Runner**: Vitest 4.1 with `environment: 'node'` (no jsdom needed for most tests, though jsdom is available as a dev dependency).
- **Path aliases**: Tests use the same `@main`, `@shared`, `@renderer` aliases as the source, configured in `vitest.config.ts`.
- **Test categories**:
  - **Unit**: Pure logic tests (`IpcChannel.test.ts`, `DeepgramEndpoint.test.ts`, `Formatters.test.ts`, `DeepgramMessageParser.test.ts`, `ExportService.test.ts`, `SettingsPersistenceQueue.test.ts`).
  - **Redux**: State transition tests (`appSlice.test.ts`).
  - **Validation**: Schema tests (`SettingsSchema.test.ts`).
  - **Integration**: Service tests with mocked dependencies (`StorageService.test.ts`, `DeepgramAccountService.test.ts`, `DeepgramConnection.test.ts`, `LoggerService.test.ts`, `Localization.test.ts`, `RendererNavigationPolicy.test.ts`).
- **No E2E tests**: The project relies on Vitest unit/integration tests. There is no Playwright or Spectron setup.
- **Running tests**:
  ```bash
  npm run test         # Single run
  npm run test:watch   # Watch mode
  ```
