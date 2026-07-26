/**
 * Defines serializable domain models and cross-process application contracts.
 */

import {
  DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS,
  DEFAULT_OPENROUTER_TRANSCRIPTION_SETTINGS,
  type TranscriptionProvider,
  type TranscriptionProviderSettings,
  type TranscriptionProviderSettingsPatch,
} from './transcription'
import type { OpenRouterSpeechModel } from './openrouter'
import type { DeepgramSpeechModel } from './deepgram'
import type { TranslationProvider, TranslationTargetLanguage } from './translation'

export const AUDIO_SOURCES = ['microphone', 'speaker'] as const
export const APP_LOCALES = ['en', 'tr', 'de', 'fr', 'pt', 'zh', 'es', 'ru', 'ja', 'ko'] as const
export const THEME_MODES = ['system', 'light', 'dark'] as const
export const NAVBAR_POSITIONS = ['left', 'top'] as const
/** Defines the supported page zoom range and control increment. */
export const PAGE_ZOOM_LIMITS = { min: 0.5, max: 2, step: 0.1, default: 1 } as const
export const TIME_FORMATS = ['24-hour', '12-hour'] as const
export const SESSION_FORMATS = ['txt', 'json'] as const
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'verbose'] as const

export type AudioSource = (typeof AUDIO_SOURCES)[number]
export type AppLocale = (typeof APP_LOCALES)[number]
export type ThemeMode = (typeof THEME_MODES)[number]
export type NavbarPosition = (typeof NAVBAR_POSITIONS)[number]
export type TimeFormat = (typeof TIME_FORMATS)[number]
export type SessionFormat = (typeof SESSION_FORMATS)[number]
export type LogLevel = (typeof LOG_LEVELS)[number]
export type DesktopPlatform = 'win32' | 'darwin' | 'linux'

export interface AppSettings {
  settingsRevision: 1
  uiLanguage: AppLocale
  theme: ThemeMode
  navbarPosition: NavbarPosition
  pageZoom: number
  timeFormat: TimeFormat
  transcriptionProvider: TranscriptionProvider
  transcriptionProviderSettings: TranscriptionProviderSettings
  translationProvider: TranslationProvider
  translationEnabled: boolean
  translationTargetLanguage: TranslationTargetLanguage
  microphoneDeviceId: string
  microphoneEnabled: boolean
  speakerDeviceId: string
  speakerEnabled: boolean
  alwaysOnTop: boolean
  showTrayIcon: boolean
  minimizeToTrayOnClose: boolean
  autoUpdate: boolean
  logLevel: LogLevel
}

export type AppSettingsPatch = {
  [Key in keyof Omit<AppSettings, 'settingsRevision' | 'transcriptionProviderSettings'>]?:
    AppSettings[Key] | undefined
} & {
  transcriptionProviderSettings?: TranscriptionProviderSettingsPatch | undefined
}

export const DEFAULT_SETTINGS: AppSettings = {
  settingsRevision: 1,
  uiLanguage: 'en',
  theme: 'system',
  navbarPosition: 'top',
  pageZoom: PAGE_ZOOM_LIMITS.default,
  timeFormat: '24-hour',
  transcriptionProvider: 'deepgram',
  transcriptionProviderSettings: {
    deepgram: DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS,
    openrouter: DEFAULT_OPENROUTER_TRANSCRIPTION_SETTINGS,
  },
  translationProvider: 'google',
  translationEnabled: false,
  translationTargetLanguage: 'tr',
  microphoneDeviceId: 'default',
  microphoneEnabled: true,
  speakerDeviceId: 'default',
  speakerEnabled: true,
  alwaysOnTop: false,
  showTrayIcon: true,
  minimizeToTrayOnClose: true,
  autoUpdate: true,
  logLevel: 'info',
}

export interface TranscriptSegment {
  id: string
  source: AudioSource
  text: string
  confidence: number
  createdAt: string
  offsetMs: number
}

export interface TranslationSegment {
  id: string
  provider: TranslationProvider
  sourceText: string
  text: string
  sourceLanguage: string
  targetLanguage: TranslationTargetLanguage
  sourceSegmentIds: string[]
  sourceStartIndex: number
  sourceEndIndex: number
  createdAt: string
}

export interface SessionDocument {
  id: string
  title: string
  isDefaultTitle: boolean
  language: string
  createdAt: string
  updatedAt: string
  durationMs: number
  segments: TranscriptSegment[]
  translations: TranslationSegment[]
}

export interface SessionSummary {
  id: string
  title: string
  isDefaultTitle: boolean
  language: string
  createdAt: string
  updatedAt: string
  durationMs: number
  segmentCount: number
  preview: string
}

export interface BootstrapPayload {
  settings: AppSettings
  sessions: SessionSummary[]
  currentSession: SessionDocument
  hasApiKeys: Record<TranscriptionProvider, boolean>
  deepgramModels: DeepgramSpeechModel[]
  openRouterModels: OpenRouterSpeechModel[]
  platform: DesktopPlatform
  version: string
}

export interface StartSessionRequest {
  settings: AppSettings
  transcriptId?: string
  title?: string
}

export interface StartSessionResult {
  session: SessionDocument
  activeSources: AudioSource[]
}

export interface DeleteSessionResult {
  deleted: boolean
  replacement?: SessionDocument
}

/** Provider-neutral account balance amount and billing unit. */
export interface ApiBalance {
  amount: number
  units: string
}

export interface SessionStateEvent {
  state: 'idle' | 'connecting' | 'recording' | 'stopping'
  transcriptId?: string
  startedAt?: string
}

export interface TranscriptResultEvent {
  source: AudioSource
  text: string
  isFinal: boolean
  speechFinal: boolean
  confidence: number
  segment?: TranscriptSegment
}

export interface TranslationResultEvent {
  transcriptId: string
  translation: TranslationSegment
}

export interface AppErrorEvent {
  source?: AudioSource
  context?: 'transcription' | 'translation'
  message: string
  recoverable: boolean
}

export interface RendererLogEntry {
  level: LogLevel
  module: string
  message: string
  details?: string
}

export interface UpdateStateEvent {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'
  version?: string
  percent?: number
  releaseNotes?: string
  message?: string
}

export interface TranscriptApi {
  /** Loads persisted settings, session list, and application metadata. */
  bootstrap(): Promise<BootstrapPayload>
  /** Atomically merges and persists validated application settings fields. */
  saveSettings(patch: AppSettingsPatch): Promise<AppSettings>
  /** Validates, encrypts, and persists one provider key, returning supported balance data. */
  saveApiKey(provider: TranscriptionProvider, apiKey: string): Promise<ApiBalance[]>
  /** Decrypts the selected provider key only when explicitly requested by settings. */
  getApiKey(provider: TranscriptionProvider): Promise<string | null>
  /** Removes one provider's encrypted API key. */
  deleteApiKey(provider: TranscriptionProvider): Promise<void>
  /** Retrieves optional balance data for one encrypted provider key. */
  getApiBalance(provider: TranscriptionProvider): Promise<ApiBalance[]>
  /** Retrieves unauthenticated public Deepgram streaming STT models. */
  getDeepgramModels(): Promise<DeepgramSpeechModel[]>
  /** Retrieves duration-priced OpenRouter speech models ordered by hourly cost. */
  getOpenRouterModels(): Promise<OpenRouterSpeechModel[]>
  /** Starts a new source-separated transcription session. */
  startSession(request: StartSessionRequest): Promise<StartSessionResult>
  /** Flushes and stops the active transcription session. */
  stopSession(): Promise<SessionDocument | null>
  /** Sends one source-specific PCM16 audio frame. */
  sendAudio(source: AudioSource, samples: ArrayBuffer): void
  /** Creates and persists one empty session workspace. */
  createSession(language: string): Promise<SessionDocument>
  /** Loads one complete session. */
  getSession(id: string): Promise<SessionDocument>
  /** Renames one session and returns the updated document. */
  renameSession(id: string, title: string): Promise<SessionDocument>
  /** Deletes one session while preserving the last-workspace invariant. */
  deleteSession(id: string): Promise<DeleteSessionResult>
  /** Changes a session's live provider/target and schedules its existing text for translation. */
  translateSession(
    id: string,
    enabled: boolean,
    provider: TranslationProvider,
    targetLanguage: TranslationTargetLanguage,
  ): Promise<void>
  /** Exports a session through a native save dialog. */
  exportSession(
    id: string,
    format: SessionFormat,
    dialogTitle: string,
    includeTranslation: boolean,
    provider: TranslationProvider,
    targetLanguage: TranslationTargetLanguage,
  ): Promise<boolean>
  /** Changes the native always-on-top state. */
  setAlwaysOnTop(enabled: boolean): Promise<void>
  /** Minimizes the main application window. */
  minimizeWindow(): Promise<void>
  /** Toggles maximized state and returns the resulting state. */
  toggleMaximizeWindow(): Promise<boolean>
  /** Closes the main application window through its graceful shutdown path. */
  closeWindow(): Promise<void>
  /** Reports whether the main application window is maximized. */
  isWindowMaximized(): Promise<boolean>
  /** Synchronizes native window chrome with the resolved renderer theme. */
  setTheme(theme: Exclude<ThemeMode, 'system'>): Promise<void>
  /** Opens an allow-listed URL in the system browser. */
  openExternal(url: string): Promise<void>
  /** Opens the application log directory in the operating-system file manager. */
  openLogsDirectory(): Promise<void>
  /** Persists one validated renderer diagnostic through the main logger. */
  writeLog(entry: RendererLogEntry): void
  /** Checks GitHub Releases for an application update. */
  checkForUpdates(): Promise<void>
  /** Restarts and installs a downloaded update. */
  installUpdate(): Promise<void>
  /** Subscribes to recording lifecycle events. */
  onSessionState(listener: (event: SessionStateEvent) => void): () => void
  /** Subscribes to interim and final transcription results. */
  onTranscriptResult(listener: (event: TranscriptResultEvent) => void): () => void
  /** Subscribes to completed live sentence translations. */
  onTranslationResult(listener: (event: TranslationResultEvent) => void): () => void
  /** Subscribes to recoverable application errors. */
  onError(listener: (event: AppErrorEvent) => void): () => void
  /** Subscribes to updater lifecycle events. */
  onUpdateState(listener: (event: UpdateStateEvent) => void): () => void
  /** Subscribes to native maximize and restore state changes. */
  onWindowMaximizedChange(listener: (maximized: boolean) => void): () => void
  /** Subscribes to settings navigation requested from native desktop UI. */
  onSettingsOpenRequested(listener: () => void): () => void
}
