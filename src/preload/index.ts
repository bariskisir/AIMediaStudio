/**
 * Exposes a typed, capability-limited media-generation API to the sandboxed renderer.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel } from '@shared/IpcChannel'
import type {
  AIMediaStudioApi,
  AppErrorEvent,
  SessionUpdatedEvent,
  UpdateStateEvent,
} from '@shared/types'

/** Subscribes to one approved main-process event and returns its cleanup callback. */
const subscribe = <T>(channel: IpcChannel, listener: (payload: T) => void): (() => void) => {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: AIMediaStudioApi = {
  bootstrap: () => ipcRenderer.invoke(IpcChannel.AppBootstrap),
  saveSettings: (patch) => ipcRenderer.invoke(IpcChannel.SettingsSave, patch),
  saveApiKey: (scope, apiKey) => ipcRenderer.invoke(IpcChannel.CredentialsSave, scope, apiKey),
  getApiKey: (scope) => ipcRenderer.invoke(IpcChannel.CredentialsGet, scope),
  deleteApiKey: (scope) => ipcRenderer.invoke(IpcChannel.CredentialsDelete, scope),
  getApiBalance: (scope) => ipcRenderer.invoke(IpcChannel.CredentialsBalance, scope),
  getModels: (kind, refresh) => ipcRenderer.invoke(IpcChannel.ModelsGet, kind, refresh),
  selectReferenceImages: (kind) => ipcRenderer.invoke(IpcChannel.ReferencesSelect, kind),
  releaseReferenceImages: (tokens) => ipcRenderer.invoke(IpcChannel.ReferencesRelease, tokens),
  selectAudioInput: () => ipcRenderer.invoke(IpcChannel.AudioInputSelect),
  releaseAudioInput: (token) => ipcRenderer.invoke(IpcChannel.AudioInputRelease, token),
  generate: (request) => ipcRenderer.invoke(IpcChannel.GenerationStart, request),
  createSession: () => ipcRenderer.invoke(IpcChannel.SessionCreate),
  getSession: (id) => ipcRenderer.invoke(IpcChannel.SessionGet, id),
  renameSession: (id, title) => ipcRenderer.invoke(IpcChannel.SessionRename, { id, title }),
  deleteSession: (id) => ipcRenderer.invoke(IpcChannel.SessionDelete, id),
  exportSession: (id) => ipcRenderer.invoke(IpcChannel.SessionExport, id),
  saveMedia: (sessionId, assetId) =>
    ipcRenderer.invoke(IpcChannel.MediaSave, { sessionId, assetId }),
  showMediaInFolder: (sessionId, assetId) =>
    ipcRenderer.invoke(IpcChannel.MediaShowInFolder, { sessionId, assetId }),
  copyText: (text) => ipcRenderer.invoke(IpcChannel.ClipboardWrite, text),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke(IpcChannel.WindowAlwaysOnTop, enabled),
  minimizeWindow: () => ipcRenderer.invoke(IpcChannel.WindowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.invoke(IpcChannel.WindowToggleMaximize),
  closeWindow: () => ipcRenderer.invoke(IpcChannel.WindowClose),
  isWindowMaximized: () => ipcRenderer.invoke(IpcChannel.WindowIsMaximized),
  setTheme: (theme) => ipcRenderer.invoke(IpcChannel.ThemeSet, theme),
  openExternal: (url) => ipcRenderer.invoke(IpcChannel.ShellOpenExternal, url),
  openLogsDirectory: () => ipcRenderer.invoke(IpcChannel.LogsOpenDirectory),
  writeLog: (entry) => ipcRenderer.send(IpcChannel.LogWrite, entry),
  checkForUpdates: () => ipcRenderer.invoke(IpcChannel.UpdatesCheck),
  installUpdate: () => ipcRenderer.invoke(IpcChannel.UpdatesInstall),
  onSessionUpdated: (listener) =>
    subscribe<SessionUpdatedEvent>(IpcChannel.SessionUpdated, listener),
  onError: (listener) => subscribe<AppErrorEvent>(IpcChannel.AppError, listener),
  onUpdateState: (listener) => subscribe<UpdateStateEvent>(IpcChannel.UpdateState, listener),
  onWindowMaximizedChange: (listener) =>
    subscribe<boolean>(IpcChannel.WindowMaximizedChanged, listener),
  onSettingsOpenRequested: (listener) =>
    subscribe<void>(IpcChannel.SettingsOpenRequested, listener),
}

contextBridge.exposeInMainWorld('app', api)
