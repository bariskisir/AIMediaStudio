/**
 * Defines the validated IPC boundary between the renderer and main-process services.
 */

import { writeFile } from 'node:fs/promises'
import { app, dialog, ipcMain, shell, type BrowserWindow, type WebContents } from 'electron'
import { IpcChannel } from '@shared/IpcChannel'
import { APP_AUTHOR_URL } from '@shared/appInfo'
import { TRANSLATION_PROVIDERS, TRANSLATION_TARGET_LANGUAGES } from '@shared/translation'
import { TRANSCRIPTION_PROVIDERS, type TranscriptionProvider } from '@shared/transcription'
import {
  AUDIO_SOURCES,
  LOG_LEVELS,
  SESSION_FORMATS,
  type StartSessionRequest,
  type UpdateStateEvent,
} from '@shared/types'
import { z } from 'zod'
import { settingsPatchSchema, settingsSchema } from './settingsSchema'
import type AppUpdater from './services/AppUpdater'
import type CredentialService from './services/CredentialService'
import type DeepgramAccountService from './services/DeepgramAccountService'
import type DeepgramCatalogService from './services/DeepgramCatalogService'
import { reconcileDeepgramSettings } from './services/DeepgramCatalogService'
import { renderSession } from './services/ExportService'
import type LoggerService from './services/LoggerService'
import type OpenRouterAccountService from './services/OpenRouterAccountService'
import type OpenRouterCatalogService from './services/OpenRouterCatalogService'
import type StorageService from './services/StorageService'
import type TranscriptService from './services/TranscriptService'
import type TrayService from './services/TrayService'

const startSchema = z.object({
  settings: settingsSchema,
  transcriptId: z.uuid().optional(),
  title: z.string().trim().min(1).max(200).optional(),
})
const audioSchema = z.object({
  source: z.enum(AUDIO_SOURCES),
  samples: z.instanceof(Uint8Array).refine((value) => value.byteLength <= 256_000),
})
const transcriptIdSchema = z.uuid()
const transcriptLanguageSchema = z.string().trim().min(1).max(24)
const transcriptRenameSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(200),
})
const formatSchema = z.enum(SESSION_FORMATS)
const dialogTitleSchema = z.string().trim().min(1).max(120)
const translationProviderSchema = z.enum(TRANSLATION_PROVIDERS)
const translationTargetSchema = z.enum(TRANSLATION_TARGET_LANGUAGES)
const apiKeySchema = z.string().trim().min(20).max(512)
const transcriptionProviderSchema = z.enum(TRANSCRIPTION_PROVIDERS)
const rendererLogSchema = z.object({
  level: z.enum(LOG_LEVELS),
  module: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(1_000),
  details: z.string().max(8_000).optional(),
})

const TRUSTED_EXTERNAL_ORIGINS = new Set([
  'https://deepgram.com',
  'https://console.deepgram.com',
  'https://developers.deepgram.com',
  'https://openrouter.ai',
  'https://github.com',
  APP_AUTHOR_URL,
])

interface IpcServices {
  storage: StorageService
  credentials: Record<TranscriptionProvider, CredentialService>
  deepgramAccount: DeepgramAccountService
  deepgramCatalog: DeepgramCatalogService
  openRouterAccount: OpenRouterAccountService
  openRouterCatalog: OpenRouterCatalogService
  transcript: TranscriptService
  tray: TrayService
  updater: AppUpdater
  logger: LoggerService
}

/** Removes previous handlers before a replacement window is attached. */
export const removeIpcHandlers = (): void => {
  Object.values(IpcChannel).forEach((channel) => {
    ipcMain.removeHandler(channel)
  })
  ipcMain.removeAllListeners(IpcChannel.AudioChunk)
  ipcMain.removeAllListeners(IpcChannel.LogWrite)
}

/** Registers all renderer commands against explicit main-process services. */
export const registerIpc = (window: BrowserWindow, services: IpcServices): void => {
  removeIpcHandlers()

  /** Rejects any IPC call not originating from the main renderer. */
  const assertSender = (sender: WebContents): void => {
    if (sender.id !== window.webContents.id) throw new Error('Untrusted IPC sender.')
  }

  /** Sends a typed event only while the window is alive. */
  const send = <T>(channel: IpcChannel, payload: T): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }

  services.updater.initialize((event: UpdateStateEvent) => send(IpcChannel.UpdateState, event))
  window.on('maximize', () => send(IpcChannel.WindowMaximizedChanged, true))
  window.on('unmaximize', () => send(IpcChannel.WindowMaximizedChanged, false))

  ipcMain.handle(IpcChannel.AppBootstrap, async (event) => {
    assertSender(event.sender)
    const [
      loadedSettings,
      initialSessions,
      hasDeepgramApiKey,
      hasOpenRouterApiKey,
      deepgramModels,
      openRouterModels,
    ] = await Promise.all([
      services.storage.loadSettings(),
      services.storage.listSessions(),
      services.credentials.deepgram.hasApiKey(),
      services.credentials.openrouter.hasApiKey(),
      services.deepgramCatalog.getModels(),
      services.openRouterCatalog.getModels(),
    ])
    const reconciledDeepgram = reconcileDeepgramSettings(
      loadedSettings.transcriptionProviderSettings.deepgram,
      deepgramModels,
    )
    const settings =
      JSON.stringify(reconciledDeepgram) ===
      JSON.stringify(loadedSettings.transcriptionProviderSettings.deepgram)
        ? loadedSettings
        : await services.storage.updateSettings({
            transcriptionProviderSettings: { deepgram: reconciledDeepgram },
          })
    window.webContents.setZoomFactor(settings.pageZoom)
    if (initialSessions.length === 0) {
      const providerSettings =
        settings.transcriptionProviderSettings[settings.transcriptionProvider]
      await services.storage.createSession(providerSettings.language || settings.uiLanguage)
    }
    const sessions =
      initialSessions.length === 0 ? await services.storage.listSessions() : initialSessions
    const firstSession = sessions[0]
    if (!firstSession) throw new Error('Session workspace could not be initialized.')
    const currentSession = await services.storage.getSession(firstSession.id)
    return {
      settings,
      sessions,
      currentSession,
      hasApiKeys: { deepgram: hasDeepgramApiKey, openrouter: hasOpenRouterApiKey },
      deepgramModels,
      openRouterModels,
      platform: process.platform,
      version: app.getVersion(),
    }
  })
  ipcMain.handle(IpcChannel.SettingsSave, async (event, input: unknown) => {
    assertSender(event.sender)
    const patch = settingsPatchSchema.parse(input)
    const savedSettings = await services.storage.updateSettings(patch)
    window.setAlwaysOnTop(savedSettings.alwaysOnTop)
    window.webContents.setZoomFactor(savedSettings.pageZoom)
    services.tray.applySettings(savedSettings)
    services.logger.setLevel(savedSettings.logLevel)
    return savedSettings
  })
  ipcMain.handle(
    IpcChannel.CredentialsSave,
    async (event, providerInput: unknown, input: unknown) => {
      assertSender(event.sender)
      const provider = transcriptionProviderSchema.parse(providerInput)
      const apiKey = apiKeySchema.parse(input)
      const balance =
        provider === 'deepgram'
          ? await services.deepgramAccount.verifyAndGetBalance(apiKey)
          : await services.openRouterAccount.verifyAndGetBalance(apiKey)
      await services.credentials[provider].saveApiKey(apiKey)
      return balance
    },
  )
  ipcMain.handle(IpcChannel.CredentialsGet, async (event, providerInput: unknown) => {
    assertSender(event.sender)
    return services.credentials[transcriptionProviderSchema.parse(providerInput)].getApiKey()
  })
  ipcMain.handle(IpcChannel.CredentialsDelete, async (event, providerInput: unknown) => {
    assertSender(event.sender)
    await services.credentials[transcriptionProviderSchema.parse(providerInput)].deleteApiKey()
  })
  ipcMain.handle(IpcChannel.CredentialsBalance, async (event, providerInput: unknown) => {
    assertSender(event.sender)
    const provider = transcriptionProviderSchema.parse(providerInput)
    const apiKey = await services.credentials[provider].getApiKey()
    if (!apiKey) return []
    return provider === 'deepgram'
      ? services.deepgramAccount.getBalance(apiKey)
      : services.openRouterAccount.getBalance(apiKey)
  })
  ipcMain.handle(IpcChannel.DeepgramModels, async (event) => {
    assertSender(event.sender)
    return services.deepgramCatalog.getModels()
  })
  ipcMain.handle(IpcChannel.OpenRouterModels, async (event) => {
    assertSender(event.sender)
    return services.openRouterCatalog.getModels()
  })
  ipcMain.handle(IpcChannel.SessionStart, async (event, input: unknown) => {
    assertSender(event.sender)
    const parsed = startSchema.parse(input)
    const request: StartSessionRequest = {
      settings: parsed.settings,
      ...(parsed.transcriptId ? { transcriptId: parsed.transcriptId } : {}),
      ...(parsed.title ? { title: parsed.title } : {}),
    }
    if (request.settings.speakerEnabled && process.platform !== 'win32') {
      throw new Error('Speaker loopback capture is currently available on Windows only.')
    }
    return services.transcript.start(request)
  })
  ipcMain.handle(IpcChannel.SessionStop, async (event) => {
    assertSender(event.sender)
    return services.transcript.stop()
  })
  ipcMain.on(IpcChannel.AudioChunk, (event, input: unknown) => {
    assertSender(event.sender)
    const parsed = audioSchema.safeParse(input)
    if (parsed.success && parsed.data.samples.byteLength > 0) {
      services.transcript.sendAudio(parsed.data.source, parsed.data.samples)
    }
  })
  ipcMain.handle(IpcChannel.SessionCreate, async (event, input: unknown) => {
    assertSender(event.sender)
    return services.storage.createSession(transcriptLanguageSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.SessionGet, async (event, input: unknown) => {
    assertSender(event.sender)
    return services.storage.getSession(transcriptIdSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.SessionRename, async (event, input: unknown) => {
    assertSender(event.sender)
    const { id, title } = transcriptRenameSchema.parse(input)
    return services.storage.renameSession(id, title)
  })
  ipcMain.handle(IpcChannel.SessionDelete, async (event, input: unknown) => {
    assertSender(event.sender)
    return services.storage.deleteSession(transcriptIdSchema.parse(input))
  })
  ipcMain.handle(
    IpcChannel.SessionTranslate,
    async (
      event,
      idInput: unknown,
      enabledInput: unknown,
      providerInput: unknown,
      targetInput: unknown,
    ) => {
      assertSender(event.sender)
      await services.transcript.translateSession(
        transcriptIdSchema.parse(idInput),
        z.boolean().parse(enabledInput),
        translationProviderSchema.parse(providerInput),
        translationTargetSchema.parse(targetInput),
      )
    },
  )
  ipcMain.handle(
    IpcChannel.SessionExport,
    async (
      event,
      idInput: unknown,
      formatInput: unknown,
      dialogTitleInput: unknown,
      includeTranslationInput: unknown,
      providerInput: unknown,
      targetInput: unknown,
    ) => {
      assertSender(event.sender)
      const format = formatSchema.parse(formatInput)
      const dialogTitle = dialogTitleSchema.parse(dialogTitleInput)
      const includeTranslation = z.boolean().parse(includeTranslationInput)
      const provider = translationProviderSchema.parse(providerInput)
      const targetLanguage = translationTargetSchema.parse(targetInput)
      const session = await services.storage.getSession(transcriptIdSchema.parse(idInput))
      const result = await dialog.showSaveDialog(window, {
        title: dialogTitle,
        defaultPath: `${session.title.replace(/[<>:"/\\|?*]/g, '-')}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      })
      if (result.canceled || !result.filePath) return false
      await writeFile(
        result.filePath,
        renderSession(session, format, includeTranslation, provider, targetLanguage),
        'utf8',
      )
      return true
    },
  )
  ipcMain.handle(IpcChannel.WindowAlwaysOnTop, (event, enabled: unknown) => {
    assertSender(event.sender)
    if (typeof enabled !== 'boolean') throw new Error('Invalid window preference.')
    window.setAlwaysOnTop(enabled)
  })
  ipcMain.handle(IpcChannel.WindowMinimize, (event) => {
    assertSender(event.sender)
    window.minimize()
  })
  ipcMain.handle(IpcChannel.WindowToggleMaximize, (event) => {
    assertSender(event.sender)
    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }
    window.maximize()
    return true
  })
  ipcMain.handle(IpcChannel.WindowClose, (event) => {
    assertSender(event.sender)
    window.close()
  })
  ipcMain.handle(IpcChannel.WindowIsMaximized, (event) => {
    assertSender(event.sender)
    return window.isMaximized()
  })
  ipcMain.handle(IpcChannel.ThemeSet, (event, theme: unknown) => {
    assertSender(event.sender)
    if (theme !== 'light' && theme !== 'dark') throw new Error('Invalid theme.')
    if (process.platform === 'darwin') {
      window.setTitleBarOverlay({
        color: theme === 'dark' ? '#1f1f1f' : '#f4f4f4',
        symbolColor: theme === 'dark' ? '#ffffff99' : '#00000099',
        height: 42,
      })
    }
  })
  ipcMain.handle(IpcChannel.ShellOpenExternal, async (event, input: unknown) => {
    assertSender(event.sender)
    if (typeof input !== 'string') throw new Error('Invalid external URL.')
    const url = new URL(input)
    if (!TRUSTED_EXTERNAL_ORIGINS.has(url.origin)) throw new Error('This URL is not allowed.')
    await shell.openExternal(url.toString())
  })
  ipcMain.handle(IpcChannel.LogsOpenDirectory, async (event) => {
    assertSender(event.sender)
    const error = await shell.openPath(services.logger.getLogsDirectory())
    if (error) throw new Error(error)
  })
  ipcMain.on(IpcChannel.LogWrite, (event, input: unknown) => {
    assertSender(event.sender)
    const parsed = rendererLogSchema.safeParse(input)
    if (parsed.success) {
      services.logger.writeRenderer({
        level: parsed.data.level,
        module: parsed.data.module,
        message: parsed.data.message,
        ...(parsed.data.details === undefined ? {} : { details: parsed.data.details }),
      })
    }
  })
  ipcMain.handle(IpcChannel.UpdatesCheck, async (event) => {
    assertSender(event.sender)
    await services.updater.checkForUpdates()
  })
  ipcMain.handle(IpcChannel.UpdatesInstall, async (event) => {
    assertSender(event.sender)
    await services.transcript.stop()
    await services.updater.quitAndInstall()
  })
}
