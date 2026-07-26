/**
 * Exposes a typed, capability-limited IPC API to the sandboxed renderer.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel } from '@shared/IpcChannel'
import type {
  AppErrorEvent,
  SessionStateEvent,
  TranscriptApi,
  TranscriptResultEvent,
  TranslationResultEvent,
  UpdateStateEvent,
} from '@shared/types'

/** Subscribes to one approved event and returns a cleanup callback. */
const subscribe = <T>(channel: IpcChannel, listener: (payload: T) => void): (() => void) => {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: TranscriptApi = {
  /** Loads settings, transcript history, credential status, and application metadata. */
  bootstrap: () => ipcRenderer.invoke(IpcChannel.AppBootstrap),
  /** Atomically merges validated application settings fields. */
  saveSettings: (patch) => ipcRenderer.invoke(IpcChannel.SettingsSave, patch),
  /** Validates, encrypts, and saves one transcription provider API key. */
  saveApiKey: (provider, apiKey) =>
    ipcRenderer.invoke(IpcChannel.CredentialsSave, provider, apiKey),
  /** Retrieves one decrypted provider API key only when requested by settings. */
  getApiKey: (provider) => ipcRenderer.invoke(IpcChannel.CredentialsGet, provider),
  /** Deletes one encrypted transcription provider API key. */
  deleteApiKey: (provider) => ipcRenderer.invoke(IpcChannel.CredentialsDelete, provider),
  /** Retrieves optional balance data for one encrypted provider API key. */
  getApiBalance: (provider) => ipcRenderer.invoke(IpcChannel.CredentialsBalance, provider),
  /** Retrieves public Deepgram streaming speech models without using the saved API key. */
  getDeepgramModels: () => ipcRenderer.invoke(IpcChannel.DeepgramModels),
  /** Retrieves duration-priced OpenRouter speech models. */
  getOpenRouterModels: () => ipcRenderer.invoke(IpcChannel.OpenRouterModels),
  /** Opens one transcription pipeline for every enabled audio source. */
  startSession: (request) => ipcRenderer.invoke(IpcChannel.SessionStart, request),
  /** Flushes and closes the active transcription session. */
  stopSession: () => ipcRenderer.invoke(IpcChannel.SessionStop),
  /** Sends one bounded source-specific PCM16 frame. */
  sendAudio: (source, samples) =>
    ipcRenderer.send(IpcChannel.AudioChunk, { source, samples: new Uint8Array(samples) }),
  /** Creates one empty local session. */
  createSession: (language) => ipcRenderer.invoke(IpcChannel.SessionCreate, language),
  /** Loads one complete local session. */
  getSession: (id) => ipcRenderer.invoke(IpcChannel.SessionGet, id),
  /** Renames one local session. */
  renameSession: (id, title) => ipcRenderer.invoke(IpcChannel.SessionRename, { id, title }),
  /** Deletes one local session. */
  deleteSession: (id) => ipcRenderer.invoke(IpcChannel.SessionDelete, id),
  /** Changes the provider/target and schedules existing transcript text for translation. */
  translateSession: (id, enabled, provider, targetLanguage) =>
    ipcRenderer.invoke(IpcChannel.SessionTranslate, id, enabled, provider, targetLanguage),
  /** Opens a native dialog and exports one session. */
  exportSession: (id, format, dialogTitle, includeTranslation, provider, targetLanguage) =>
    ipcRenderer.invoke(
      IpcChannel.SessionExport,
      id,
      format,
      dialogTitle,
      includeTranslation,
      provider,
      targetLanguage,
    ),
  /** Changes the native always-on-top window state. */
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke(IpcChannel.WindowAlwaysOnTop, enabled),
  /** Minimizes the main application window. */
  minimizeWindow: () => ipcRenderer.invoke(IpcChannel.WindowMinimize),
  /** Toggles the main application window between maximized and restored states. */
  toggleMaximizeWindow: () => ipcRenderer.invoke(IpcChannel.WindowToggleMaximize),
  /** Closes the main application window. */
  closeWindow: () => ipcRenderer.invoke(IpcChannel.WindowClose),
  /** Retrieves the main application window's maximized state. */
  isWindowMaximized: () => ipcRenderer.invoke(IpcChannel.WindowIsMaximized),
  /** Synchronizes native title-bar colors with the renderer theme. */
  setTheme: (theme) => ipcRenderer.invoke(IpcChannel.ThemeSet, theme),
  /** Opens one allow-listed HTTPS URL in the system browser. */
  openExternal: (url) => ipcRenderer.invoke(IpcChannel.ShellOpenExternal, url),
  /** Opens the AppData log directory in the operating-system file manager. */
  openLogsDirectory: () => ipcRenderer.invoke(IpcChannel.LogsOpenDirectory),
  /** Forwards one renderer diagnostic to the configured main logger. */
  writeLog: (entry) => ipcRenderer.send(IpcChannel.LogWrite, entry),
  /** Checks GitHub Releases for a newer application version. */
  checkForUpdates: () => ipcRenderer.invoke(IpcChannel.UpdatesCheck),
  /** Restarts and installs a downloaded update. */
  installUpdate: () => ipcRenderer.invoke(IpcChannel.UpdatesInstall),
  /** Subscribes to recording lifecycle events. */
  onSessionState: (listener) => subscribe<SessionStateEvent>(IpcChannel.SessionState, listener),
  /** Subscribes to interim and final transcript results. */
  onTranscriptResult: (listener) =>
    subscribe<TranscriptResultEvent>(IpcChannel.TranscriptResult, listener),
  /** Subscribes to persisted sentence translations. */
  onTranslationResult: (listener) =>
    subscribe<TranslationResultEvent>(IpcChannel.TranslationResult, listener),
  /** Subscribes to recoverable application errors. */
  onError: (listener) => subscribe<AppErrorEvent>(IpcChannel.AppError, listener),
  /** Subscribes to updater lifecycle progress. */
  onUpdateState: (listener) => subscribe<UpdateStateEvent>(IpcChannel.UpdateState, listener),
  /** Subscribes to maximize and restore state changes. */
  onWindowMaximizedChange: (listener) =>
    subscribe<boolean>(IpcChannel.WindowMaximizedChanged, listener),
  /** Subscribes to settings navigation requested by the tray menu. */
  onSettingsOpenRequested: (listener) =>
    subscribe<void>(IpcChannel.SettingsOpenRequested, listener),
}

contextBridge.exposeInMainWorld('app', api)
