/**
 * Defines the validated IPC boundary between the renderer and media-generation services.
 */

import { copyFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  app,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type WebContents,
} from 'electron'
import { IpcChannel } from '@shared/IpcChannel'
import { APP_AUTHOR_URL } from '@shared/appInfo'
import { MEDIA_KINDS } from '@shared/openrouter'
import {
  LOG_LEVELS,
  type GenerateRequest,
  type MediaKind,
  type UpdateStateEvent,
} from '@shared/types'
import { z } from 'zod'
import { settingsPatchSchema } from './settingsSchema'
import type AppUpdater from './services/AppUpdater'
import type AudioInputService from './services/AudioInputService'
import type CredentialService from './services/CredentialService'
import { saveApiKeyAndFillEmptyScopes } from './services/CredentialService'
import { renderSessionMetadata } from './services/ExportService'
import type GenerationService from './services/GenerationService'
import type LoggerService from './services/LoggerService'
import type MediaAssetService from './services/MediaAssetService'
import type OpenRouterAccountService from './services/OpenRouterAccountService'
import type OpenRouterCatalogService from './services/OpenRouterCatalogService'
import type ReferenceImageService from './services/ReferenceImageService'
import type StorageService from './services/StorageService'
import type TrayService from './services/TrayService'

const mediaKindSchema = z.enum(MEDIA_KINDS)
const credentialScopeSchema = z.object({ kind: mediaKindSchema, provider: z.literal('openrouter') })
const apiKeySchema = z.string().trim().min(20).max(512)
const idSchema = z.uuid()
const renameSchema = z.object({ id: idSchema, title: z.string().trim().min(1).max(200) })
const assetSchema = z.object({ sessionId: idSchema, assetId: idSchema })
const referenceRoleSchema = z.enum(['reference', 'first_frame', 'last_frame'])
const visualKindSchema = z.enum(['image', 'video'])
const generationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('image'),
    prompt: z.string().trim().min(1).max(20_000),
    modelId: z.string().trim().min(1).max(200),
    options: z.object({
      resolution: z.string().max(32).optional(),
      aspectRatio: z.string().max(32).optional(),
      quality: z.enum(['auto', 'low', 'medium', 'high']).optional(),
      outputFormat: z.enum(['png', 'jpeg', 'webp', 'svg']).optional(),
      count: z.number().int().min(1).max(10).optional(),
      background: z.enum(['auto', 'transparent', 'opaque']).optional(),
      outputCompression: z.number().int().min(0).max(100).optional(),
      seed: z.number().int().min(0).max(2_147_483_647).optional(),
    }),
    references: z.array(z.object({ token: idSchema, role: referenceRoleSchema })).max(10),
    sessionId: idSchema.optional(),
  }),
  z.object({
    kind: z.literal('video'),
    prompt: z.string().trim().min(1).max(20_000),
    modelId: z.string().trim().min(1).max(200),
    options: z.object({
      duration: z.number().int().min(1).max(120).optional(),
      resolution: z.string().max(32).optional(),
      aspectRatio: z.string().max(32).optional(),
      size: z
        .string()
        .regex(/^\d+x\d+$/)
        .max(32)
        .optional(),
      generateAudio: z.boolean().optional(),
      seed: z.number().int().min(0).max(2_147_483_647).optional(),
    }),
    references: z.array(z.object({ token: idSchema, role: referenceRoleSchema })).max(2),
    sessionId: idSchema.optional(),
  }),
  z.object({
    kind: z.literal('tts'),
    prompt: z.string().trim().min(1).max(20_000),
    modelId: z.string().trim().min(1).max(200),
    options: z.object({
      voice: z.string().trim().min(1).max(200),
      responseFormat: z.enum(['mp3', 'pcm']),
      speed: z.number().min(0.25).max(4),
    }),
    sessionId: idSchema.optional(),
  }),
  z.object({
    kind: z.literal('stt'),
    modelId: z.string().trim().min(1).max(200),
    options: z.object({
      language: z
        .string()
        .trim()
        .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/)
        .max(12)
        .optional(),
      temperature: z.number().min(0).max(1).optional(),
    }),
    audio: z.union([
      z.object({ token: idSchema }).strict(),
      z.object({ sourceSessionId: idSchema }).strict(),
    ]),
    sessionId: idSchema.optional(),
  }),
])
const rendererLogSchema = z.object({
  level: z.enum(LOG_LEVELS),
  module: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(1_000),
  details: z.string().max(8_000).optional(),
})

const TRUSTED_EXTERNAL_ORIGINS = new Set([
  'https://openrouter.ai',
  'https://github.com',
  APP_AUTHOR_URL,
])

interface IpcServices {
  storage: StorageService
  credentials: Record<MediaKind, CredentialService>
  account: OpenRouterAccountService
  catalog: OpenRouterCatalogService
  references: ReferenceImageService
  audioInputs: AudioInputService
  assets: MediaAssetService
  generation: GenerationService
  tray: TrayService
  updater: AppUpdater
  logger: LoggerService
}

/** Removes prior handlers before a replacement macOS window is attached. */
export const removeIpcHandlers = (): void => {
  for (const channel of Object.values(IpcChannel)) ipcMain.removeHandler(channel)
  ipcMain.removeAllListeners(IpcChannel.LogWrite)
}

/** Registers validated commands against explicit main-process services. */
export const registerIpc = (window: BrowserWindow, services: IpcServices): void => {
  removeIpcHandlers()

  /** Rejects calls that do not originate from the active application renderer. */
  const assertSender = (sender: WebContents): void => {
    if (sender.id !== window.webContents.id) throw new Error('Untrusted IPC sender.')
  }

  /** Sends one event only while the owning window remains available. */
  const send = <T>(channel: IpcChannel, payload: T): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }

  services.updater.initialize((event: UpdateStateEvent) => send(IpcChannel.UpdateState, event))
  window.on('maximize', () => send(IpcChannel.WindowMaximizedChanged, true))
  window.on('unmaximize', () => send(IpcChannel.WindowMaximizedChanged, false))

  ipcMain.handle(IpcChannel.AppBootstrap, async (event) => {
    assertSender(event.sender)
    const [
      settings,
      imageKey,
      videoKey,
      ttsKey,
      sttKey,
      imageModels,
      videoModels,
      ttsModels,
      sttModels,
    ] = await Promise.all([
      services.storage.loadSettings(),
      services.credentials.image.hasApiKey(),
      services.credentials.video.hasApiKey(),
      services.credentials.tts.hasApiKey(),
      services.credentials.stt.hasApiKey(),
      services.catalog.getModels('image').catch(() => []),
      services.catalog.getModels('video').catch(() => []),
      services.catalog.getModels('tts').catch(() => []),
      services.catalog.getModels('stt').catch(() => []),
    ])
    window.webContents.setZoomFactor(settings.pageZoom)
    if (process.platform === 'linux') {
      settings.showTrayIcon = false
      settings.minimizeToTrayOnClose = false
      settings.startMinimized = false
    }
    let sessions = await services.storage.listSessions()
    if (!sessions.length) await services.storage.createSession()
    sessions = await services.storage.listSessions()
    const first = sessions[0]
    if (!first) throw new Error('Generation workspace could not be initialized.')
    return {
      settings,
      sessions,
      currentSession: await services.storage.getSession(first.id),
      hasApiKeys: { image: imageKey, video: videoKey, tts: ttsKey, stt: sttKey },
      models: { image: imageModels, video: videoModels, tts: ttsModels, stt: sttModels },
      platform: process.platform,
      version: app.getVersion(),
    }
  })

  ipcMain.handle(IpcChannel.SettingsSave, async (event, input: unknown) => {
    assertSender(event.sender)
    const patch = settingsPatchSchema.parse(input)
    if (process.platform === 'linux') {
      delete patch.showTrayIcon
      delete patch.minimizeToTrayOnClose
      delete patch.startMinimized
    }
    const settings = await services.storage.updateSettings(patch)
    window.setAlwaysOnTop(settings.alwaysOnTop)
    window.webContents.setZoomFactor(settings.pageZoom)
    services.tray.applySettings(settings)
    services.logger.setLevel(settings.logLevel)
    return settings
  })

  ipcMain.handle(
    IpcChannel.CredentialsSave,
    async (event, scopeInput: unknown, keyInput: unknown) => {
      assertSender(event.sender)
      const scope = credentialScopeSchema.parse(scopeInput)
      const apiKey = apiKeySchema.parse(keyInput)
      const balance = await services.account.verifyAndGetBalance(apiKey)
      const updatedKinds = await saveApiKeyAndFillEmptyScopes(
        services.credentials,
        scope.kind,
        apiKey,
      )
      return { balance, updatedKinds }
    },
  )
  ipcMain.handle(IpcChannel.CredentialsGet, async (event, scopeInput: unknown) => {
    assertSender(event.sender)
    const scope = credentialScopeSchema.parse(scopeInput)
    return services.credentials[scope.kind].getApiKey()
  })
  ipcMain.handle(IpcChannel.CredentialsDelete, async (event, scopeInput: unknown) => {
    assertSender(event.sender)
    const scope = credentialScopeSchema.parse(scopeInput)
    await services.credentials[scope.kind].deleteApiKey()
  })
  ipcMain.handle(IpcChannel.CredentialsBalance, async (event, scopeInput: unknown) => {
    assertSender(event.sender)
    const scope = credentialScopeSchema.parse(scopeInput)
    const apiKey = await services.credentials[scope.kind].getApiKey()
    return apiKey ? services.account.getBalance(apiKey) : []
  })
  ipcMain.handle(IpcChannel.ModelsGet, async (event, kindInput: unknown, refreshInput: unknown) => {
    assertSender(event.sender)
    return services.catalog.getModels(mediaKindSchema.parse(kindInput), Boolean(refreshInput))
  })
  ipcMain.handle(IpcChannel.ReferencesSelect, async (event, kindInput: unknown) => {
    assertSender(event.sender)
    const kind = visualKindSchema.parse(kindInput)
    const result = await dialog.showOpenDialog(window, {
      title: kind === 'image' ? 'Select reference images' : 'Select frame images',
      properties:
        kind === 'image' ? ['openFile', 'multiSelections'] : ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    })
    return result.canceled ? [] : services.references.registerPaths(result.filePaths, kind)
  })
  ipcMain.handle(IpcChannel.ReferencesRelease, (event, tokensInput: unknown) => {
    assertSender(event.sender)
    services.references.release(z.array(idSchema).max(10).parse(tokensInput))
  })
  ipcMain.handle(IpcChannel.AudioInputSelect, async (event) => {
    assertSender(event.sender)
    const result = await dialog.showOpenDialog(window, {
      title: 'Select audio to transcribe',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'webm', 'aac'] }],
    })
    const path = result.filePaths[0]
    return result.canceled || !path ? null : services.audioInputs.registerPath(path)
  })
  ipcMain.handle(IpcChannel.AudioInputRelease, (event, tokenInput: unknown) => {
    assertSender(event.sender)
    services.audioInputs.release(idSchema.parse(tokenInput))
  })
  ipcMain.handle(IpcChannel.GenerationStart, async (event, input: unknown) => {
    assertSender(event.sender)
    return services.generation.generate(generationSchema.parse(input) as GenerateRequest)
  })
  ipcMain.handle(IpcChannel.SessionCreate, async (event) => {
    assertSender(event.sender)
    return services.storage.createSession()
  })
  ipcMain.handle(IpcChannel.SessionGet, async (event, input: unknown) => {
    assertSender(event.sender)
    return services.storage.getSession(idSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.SessionRename, async (event, input: unknown) => {
    assertSender(event.sender)
    const value = renameSchema.parse(input)
    return services.storage.renameSession(value.id, value.title)
  })
  ipcMain.handle(IpcChannel.SessionDelete, async (event, input: unknown) => {
    assertSender(event.sender)
    return services.storage.deleteSession(idSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.SessionExport, async (event, input: unknown) => {
    assertSender(event.sender)
    const session = await services.storage.getSession(idSchema.parse(input))
    const result = await dialog.showSaveDialog(window, {
      title: 'Export generation metadata',
      defaultPath: `${session.title.replace(/[<>:"/\\|?*]/g, '-')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, renderSessionMetadata(session), 'utf8')
    return true
  })
  ipcMain.handle(IpcChannel.MediaSave, async (event, input: unknown) => {
    assertSender(event.sender)
    const value = assetSchema.parse(input)
    const source = await services.assets.resolveAsset(value.sessionId, value.assetId)
    const result = await dialog.showSaveDialog(window, {
      title: 'Save generated media',
      defaultPath: basename(source),
    })
    if (result.canceled || !result.filePath) return false
    await copyFile(source, result.filePath)
    return true
  })
  ipcMain.handle(IpcChannel.MediaShowInFolder, async (event, input: unknown) => {
    assertSender(event.sender)
    const value = assetSchema.parse(input)
    shell.showItemInFolder(await services.assets.resolveAsset(value.sessionId, value.assetId))
  })
  ipcMain.handle(IpcChannel.ClipboardWrite, (event, input: unknown) => {
    assertSender(event.sender)
    clipboard.writeText(z.string().max(1_000_000).parse(input))
  })
  ipcMain.handle(IpcChannel.WindowAlwaysOnTop, (event, input: unknown) => {
    assertSender(event.sender)
    window.setAlwaysOnTop(z.boolean().parse(input))
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
  ipcMain.handle(IpcChannel.ThemeSet, (event, input: unknown) => {
    assertSender(event.sender)
    const theme = z.enum(['light', 'dark']).parse(input)
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
    const url = new URL(z.string().url().parse(input))
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
        ...(parsed.data.details !== undefined ? { details: parsed.data.details } : {}),
      })
    }
  })
  ipcMain.handle(IpcChannel.UpdatesCheck, async (event) => {
    assertSender(event.sender)
    await services.updater.checkForUpdates()
  })
  ipcMain.handle(IpcChannel.UpdatesInstall, async (event) => {
    assertSender(event.sender)
    await services.updater.quitAndInstall()
  })
}
