/**
 * Composes main-process services and controls the Electron application lifecycle.
 */

import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { IpcChannel } from '@shared/IpcChannel'
import { configureApplicationPaths } from './ApplicationPaths'
import { registerIpc } from './ipc'
import AppUpdater from './services/AppUpdater'
import CredentialService from './services/CredentialService'
import DeepgramAccountService from './services/DeepgramAccountService'
import DeepgramCatalogService from './services/DeepgramCatalogService'
import DeepgramService from './services/DeepgramService'
import OpenRouterAccountService from './services/OpenRouterAccountService'
import OpenRouterCatalogService from './services/OpenRouterCatalogService'
import OpenRouterService from './services/OpenRouterService'
import BingTranslateService from './services/BingTranslateService'
import GoogleTranslateService from './services/GoogleTranslateService'
import LoggerService from './services/LoggerService'

import StorageService from './services/StorageService'
import TranscriptService from './services/TranscriptService'
import TrayService from './services/TrayService'
import TranslationProviderService from './services/TranslationProviderService'
import WindowService from './services/WindowService'

const windowService = new WindowService()
const applicationPaths = configureApplicationPaths()
const hasSingleInstanceLock = app.requestSingleInstanceLock()
let transcriptService: TranscriptService | null = null
let loggerService: LoggerService | null = null
let trayService: TrayService | null = null

/** Creates all services and binds them to a newly opened window. */
const openApplicationWindow = async (): Promise<void> => {
  const storage = new StorageService(applicationPaths.dataRoot)
  await storage.initialize()
  const settings = await storage.loadSettings()
  const logger = new LoggerService(applicationPaths.logsRoot, settings.logLevel)
  loggerService = logger
  const credentials = {
    deepgram: new CredentialService(join(applicationPaths.dataRoot, 'credentials.bin')),
    openrouter: new CredentialService(
      join(applicationPaths.dataRoot, 'credentials-openrouter.bin'),
    ),
  }
  const deepgramAccount = new DeepgramAccountService()
  const deepgramCatalog = new DeepgramCatalogService(logger)
  const openRouterAccount = new OpenRouterAccountService()
  const openRouterCatalog = new OpenRouterCatalogService(logger)
  const deepgram = new DeepgramService(logger)
  const openRouter = new OpenRouterService(logger)
  const translator = new TranslationProviderService(
    new GoogleTranslateService(),
    new BingTranslateService(),
  )
  const updater = new AppUpdater(logger)
  const window = await windowService.createWindow(logger)
  trayService?.dispose()
  const tray = new TrayService(window, settings, logger)
  trayService = tray

  transcriptService = new TranscriptService(
    storage,
    credentials,
    deepgram,
    openRouter,
    translator,
    {
      onState: (event) =>
        windowService.getMainWindow()?.webContents.send(IpcChannel.SessionState, event),
      onResult: (event) =>
        windowService.getMainWindow()?.webContents.send(IpcChannel.TranscriptResult, event),
      onTranslation: (event) =>
        windowService.getMainWindow()?.webContents.send(IpcChannel.TranslationResult, event),
      onError: (event) =>
        windowService.getMainWindow()?.webContents.send(IpcChannel.AppError, event),
    },
    logger,
  )
  let closeApproved = false
  window.on('close', (event) => {
    if (tray.shouldMinimizeOnClose()) {
      event.preventDefault()
      window.hide()
      return
    }
    const activeTranscriptService = transcriptService
    if (closeApproved || !activeTranscriptService) return
    event.preventDefault()
    void activeTranscriptService
      .stop()
      .catch((error: unknown) => {
        logger.error('Application', 'Recording cleanup failed while closing.', error)
      })
      .finally(() => {
        closeApproved = true
        window.close()
      })
  })
  registerIpc(window, {
    storage,
    credentials,
    deepgramAccount,
    deepgramCatalog,
    openRouterAccount,
    openRouterCatalog,
    transcript: transcriptService,
    tray,
    updater,
    logger,
  })

  logger.info('Application', 'Transcript desktop started.', {
    version: app.getVersion(),
    platform: process.platform,
  })
  if (settings.autoUpdate && app.isPackaged) {
    void updater.checkForUpdates().catch((error: unknown) => {
      logger.warn('Application', 'Startup update check failed.', error)
    })
  }
}

/** Opens a replacement macOS window and records initialization failures. */
const reopenApplicationWindow = (): void => {
  void openApplicationWindow().catch((error: unknown) => {
    loggerService?.error('Application', 'Application window could not be reopened.', error)
  })
}

process.on('uncaughtException', (error) =>
  loggerService?.error('Application', 'Uncaught exception.', error),
)
process.on('unhandledRejection', (error) =>
  loggerService?.error('Application', 'Unhandled rejection.', error),
)

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = windowService.getMainWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  void app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId('com.bariskisir.transcript')
      await openApplicationWindow()
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) reopenApplicationWindow()
      })
    })
    .catch((error: unknown) => {
      loggerService?.error('Application', 'Application initialization failed.', error)
      app.quit()
    })
}

app.on('before-quit', () => {
  trayService?.prepareToQuit()
  void transcriptService?.stop().catch((error: unknown) => {
    loggerService?.error('Application', 'Recording cleanup failed before quit.', error)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
