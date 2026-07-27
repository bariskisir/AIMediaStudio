/**
 * Defines serializable media-generation domain models and cross-process contracts.
 */

import type {
  ImageBackground,
  ImageOutputFormat,
  ImageQuality,
  MediaKind,
  MediaModel,
  OpenRouterProvider,
  TtsOutputFormat,
} from './openrouter'

export type { MediaKind } from './openrouter'

export const APP_LOCALES = ['en', 'tr', 'de', 'fr', 'pt', 'zh', 'es', 'ru', 'ja', 'ko'] as const
export const THEME_MODES = ['system', 'light', 'dark'] as const
export const NAVBAR_POSITIONS = ['left', 'top'] as const
export const TIME_FORMATS = ['24-hour', '12-hour'] as const
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'verbose'] as const
export const GENERATION_STATUSES = [
  'submitting',
  'pending',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
  'expired',
] as const

/** Defines the supported page zoom range and control increment. */
export const PAGE_ZOOM_LIMITS = { min: 0.5, max: 2, step: 0.1, default: 1 } as const

/** Defines the persisted input-panel share of the resizable generation workspace. */
export const WORKSPACE_INPUT_PERCENT_LIMITS = { min: 25, max: 75, step: 2, default: 40 } as const

export type AppLocale = (typeof APP_LOCALES)[number]
export type ThemeMode = (typeof THEME_MODES)[number]
export type NavbarPosition = (typeof NAVBAR_POSITIONS)[number]
export type TimeFormat = (typeof TIME_FORMATS)[number]
export type LogLevel = (typeof LOG_LEVELS)[number]
export type GenerationStatus = (typeof GENERATION_STATUSES)[number]
export type DesktopPlatform = 'win32' | 'darwin' | 'linux'

/** Stores image defaults independently from every future provider. */
export interface ImageProviderSettings {
  modelId: string
  resolution: string
  aspectRatio: string
  quality: ImageQuality
  outputFormat: ImageOutputFormat
  count: number
  background: ImageBackground
  outputCompression: number
  seed: number | null
}

/** Stores video defaults independently from every future provider. */
export interface VideoProviderSettings {
  modelId: string
  duration: number
  resolution: string
  aspectRatio: string
  size: string
  generateAudio: boolean
  seed: number | null
}

/** Stores text-to-speech defaults independently from every future provider. */
export interface TtsProviderSettings {
  modelId: string
  voice: string
  responseFormat: TtsOutputFormat
  speed: number
}

/** Stores speech-to-text defaults independently from every future provider. */
export interface SttProviderSettings {
  modelId: string
  language: string
  temperature: number
}

/** Persists renderer preferences and provider-scoped generation defaults. */
export interface AppSettings {
  settingsRevision: 1
  uiLanguage: AppLocale
  theme: ThemeMode
  navbarPosition: NavbarPosition
  pageZoom: number
  workspaceInputPercent: number
  timeFormat: TimeFormat
  generationMode: MediaKind
  image: { provider: OpenRouterProvider; providers: { openrouter: ImageProviderSettings } }
  video: { provider: OpenRouterProvider; providers: { openrouter: VideoProviderSettings } }
  tts: { provider: OpenRouterProvider; providers: { openrouter: TtsProviderSettings } }
  stt: { provider: OpenRouterProvider; providers: { openrouter: SttProviderSettings } }
  alwaysOnTop: boolean
  showTrayIcon: boolean
  minimizeToTrayOnClose: boolean
  autoUpdate: boolean
  logLevel: LogLevel
}

export type AppSettingsPatch = {
  [Key in keyof Omit<AppSettings, 'settingsRevision' | 'image' | 'video' | 'tts' | 'stt'>]?:
    AppSettings[Key] | undefined
} & {
  image?:
    | {
        provider?: OpenRouterProvider | undefined
        providers?:
          | {
              openrouter?:
                | { [Key in keyof ImageProviderSettings]?: ImageProviderSettings[Key] | undefined }
                | undefined
            }
          | undefined
      }
    | undefined
  video?:
    | {
        provider?: OpenRouterProvider | undefined
        providers?:
          | {
              openrouter?:
                | { [Key in keyof VideoProviderSettings]?: VideoProviderSettings[Key] | undefined }
                | undefined
            }
          | undefined
      }
    | undefined
  tts?:
    | {
        provider?: OpenRouterProvider | undefined
        providers?:
          | {
              openrouter?:
                | { [Key in keyof TtsProviderSettings]?: TtsProviderSettings[Key] | undefined }
                | undefined
            }
          | undefined
      }
    | undefined
  stt?:
    | {
        provider?: OpenRouterProvider | undefined
        providers?:
          | {
              openrouter?:
                | { [Key in keyof SttProviderSettings]?: SttProviderSettings[Key] | undefined }
                | undefined
            }
          | undefined
      }
    | undefined
}

export const DEFAULT_SETTINGS: AppSettings = {
  settingsRevision: 1,
  uiLanguage: 'en',
  theme: 'system',
  navbarPosition: 'top',
  pageZoom: PAGE_ZOOM_LIMITS.default,
  workspaceInputPercent: WORKSPACE_INPUT_PERCENT_LIMITS.default,
  timeFormat: '24-hour',
  generationMode: 'image',
  image: {
    provider: 'openrouter',
    providers: {
      openrouter: {
        modelId: '',
        resolution: '1K',
        aspectRatio: '1:1',
        quality: 'auto',
        outputFormat: 'png',
        count: 1,
        background: 'auto',
        outputCompression: 90,
        seed: null,
      },
    },
  },
  video: {
    provider: 'openrouter',
    providers: {
      openrouter: {
        modelId: '',
        duration: 5,
        resolution: '720p',
        aspectRatio: '16:9',
        size: '',
        generateAudio: true,
        seed: null,
      },
    },
  },
  tts: {
    provider: 'openrouter',
    providers: {
      openrouter: {
        modelId: '',
        voice: '',
        responseFormat: 'mp3',
        speed: 1,
      },
    },
  },
  stt: {
    provider: 'openrouter',
    providers: {
      openrouter: {
        modelId: '',
        language: '',
        temperature: 0,
      },
    },
  },
  alwaysOnTop: false,
  showTrayIcon: true,
  minimizeToTrayOnClose: true,
  autoUpdate: true,
  logLevel: 'info',
}

/** Identifies one encrypted credential independently for every media workflow. */
export interface CredentialScope {
  kind: MediaKind
  provider: OpenRouterProvider
}

/** Describes a provider-neutral account balance amount and billing unit. */
export interface ApiBalance {
  amount: number
  units: string
}

/** Reports the validated balance and credential scopes changed by one key save. */
export interface ApiKeySaveResult {
  balance: ApiBalance[]
  updatedKinds: MediaKind[]
}

/** References a selected local image without exposing its file-system path. */
export interface ReferenceImage {
  token: string
  name: string
  mediaType: string
  previewUrl: string
}

/** Represents one validated local audio selection without exposing its path. */
export interface AudioInputSelection {
  token: string
  name: string
  mediaType: string
  format: import('./openrouter').AudioInputFormat
  size: number
}

/** Stores a session-owned audio input so STT history can be regenerated safely. */
export interface PersistedAudioInput {
  originalName: string
  fileName: string
  mediaType: string
  format: import('./openrouter').AudioInputFormat
  size: number
}

/** Records an application-owned output that can be served through the media protocol. */
export interface MediaAsset {
  id: string
  fileName: string
  mediaType: string
  size: number
  url: string
}

/** Stores the exact image request settings used by a generation. */
export interface ImageGenerationOptions {
  resolution?: string
  aspectRatio?: string
  quality?: ImageQuality
  outputFormat?: ImageOutputFormat
  count?: number
  background?: ImageBackground
  outputCompression?: number
  seed?: number
}

/** Stores the exact video request settings used by a generation. */
export interface VideoGenerationOptions {
  duration?: number
  resolution?: string
  aspectRatio?: string
  size?: string
  generateAudio?: boolean
  seed?: number
}

/** Stores the exact text-to-speech request settings used by a generation. */
export interface TtsGenerationOptions {
  voice: string
  responseFormat: TtsOutputFormat
  speed: number
}

/** Stores the exact speech-to-text request settings used by a generation. */
export interface SttGenerationOptions {
  language?: string
  temperature?: number
}

/** Discriminates image reference roles accepted by the media APIs. */
export interface GenerationReference {
  token: string
  role: 'reference' | 'first_frame' | 'last_frame'
}

/** Submits one media job without exposing provider credentials or local paths. */
export type GenerateRequest =
  | {
      kind: 'image'
      prompt: string
      modelId: string
      options: ImageGenerationOptions
      references: GenerationReference[]
      sessionId?: string
    }
  | {
      kind: 'tts'
      prompt: string
      modelId: string
      options: TtsGenerationOptions
      sessionId?: string
    }
  | {
      kind: 'stt'
      modelId: string
      options: SttGenerationOptions
      audio: { token: string } | { sourceSessionId: string }
      sessionId?: string
    }
  | {
      kind: 'video'
      prompt: string
      modelId: string
      options: VideoGenerationOptions
      references: GenerationReference[]
      sessionId?: string
    }

/** Stores one complete generation record without secrets, base64 data, or absolute paths. */
export interface GenerationItem {
  id: string
  kind: MediaKind
  provider: OpenRouterProvider
  modelId: string
  prompt: string
  status: GenerationStatus
  createdAt: string
  updatedAt: string
  options:
    ImageGenerationOptions | VideoGenerationOptions | TtsGenerationOptions | SttGenerationOptions
  assets: MediaAsset[]
  inputAudio?: PersistedAudioInput
  resultText?: string
  costUsd?: number
  error?: string
  remoteJobId?: string
  pollingUrl?: string
}

/** Represents one durable history workspace containing at most one generation. */
export interface SessionDocument {
  id: string
  title: string
  isDefaultTitle: boolean
  createdAt: string
  updatedAt: string
  item: GenerationItem | null
}

/** Provides compact history data for the sessions sidebar. */
export interface SessionSummary {
  id: string
  title: string
  isDefaultTitle: boolean
  createdAt: string
  updatedAt: string
  hasItem: boolean
  mediaKind?: MediaKind
  status?: GenerationStatus
  preview: string
}

/** Reports a delete operation and its invariant-preserving replacement workspace. */
export interface DeleteSessionResult {
  deleted: boolean
  replacement?: SessionDocument
}

/** Hydrates the renderer with durable state and public model catalogs. */
export interface BootstrapPayload {
  settings: AppSettings
  sessions: SessionSummary[]
  currentSession: SessionDocument
  hasApiKeys: Record<MediaKind, boolean>
  models: Record<MediaKind, MediaModel[]>
  platform: DesktopPlatform
  version: string
}

/** Notifies the renderer whenever one background generation changes. */
export interface SessionUpdatedEvent {
  session: SessionDocument
  summary: SessionSummary
}

/** Delivers renderer-safe operational failures. */
export interface AppErrorEvent {
  context: MediaKind | 'storage' | 'system'
  message: string
  recoverable: boolean
}

/** Transfers one validated renderer diagnostic to the main process. */
export interface RendererLogEntry {
  level: LogLevel
  module: string
  message: string
  details?: string
}

/** Describes the desktop updater lifecycle. */
export interface UpdateStateEvent {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'
  version?: string
  percent?: number
  releaseNotes?: string
  message?: string
}

/** Exposes the complete capability-limited bridge to the sandboxed renderer. */
export interface AIMediaStudioApi {
  bootstrap(): Promise<BootstrapPayload>
  saveSettings(patch: AppSettingsPatch): Promise<AppSettings>
  saveApiKey(scope: CredentialScope, apiKey: string): Promise<ApiKeySaveResult>
  getApiKey(scope: CredentialScope): Promise<string | null>
  deleteApiKey(scope: CredentialScope): Promise<void>
  getApiBalance(scope: CredentialScope): Promise<ApiBalance[]>
  getModels(kind: MediaKind, refresh?: boolean): Promise<MediaModel[]>
  selectReferenceImages(kind: Extract<MediaKind, 'image' | 'video'>): Promise<ReferenceImage[]>
  releaseReferenceImages(tokens: string[]): Promise<void>
  selectAudioInput(): Promise<AudioInputSelection | null>
  releaseAudioInput(token: string): Promise<void>
  generate(request: GenerateRequest): Promise<SessionDocument>
  createSession(): Promise<SessionDocument>
  getSession(id: string): Promise<SessionDocument>
  renameSession(id: string, title: string): Promise<SessionDocument>
  deleteSession(id: string): Promise<DeleteSessionResult>
  exportSession(id: string): Promise<boolean>
  saveMedia(sessionId: string, assetId: string): Promise<boolean>
  showMediaInFolder(sessionId: string, assetId: string): Promise<void>
  copyText(text: string): Promise<void>
  setAlwaysOnTop(enabled: boolean): Promise<void>
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<boolean>
  closeWindow(): Promise<void>
  isWindowMaximized(): Promise<boolean>
  setTheme(theme: Exclude<ThemeMode, 'system'>): Promise<void>
  openExternal(url: string): Promise<void>
  openLogsDirectory(): Promise<void>
  writeLog(entry: RendererLogEntry): void
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  onSessionUpdated(listener: (event: SessionUpdatedEvent) => void): () => void
  onError(listener: (event: AppErrorEvent) => void): () => void
  onUpdateState(listener: (event: UpdateStateEvent) => void): () => void
  onWindowMaximizedChange(listener: (maximized: boolean) => void): () => void
  onSettingsOpenRequested(listener: () => void): () => void
}
