/**
 * Composes AI Media Studio services and owns the Electron application lifecycle.
 */

import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { IpcChannel } from '@shared/IpcChannel'
import { configureApplicationPaths } from './ApplicationPaths'
import { registerIpc } from './ipc'
import AppUpdater from './services/AppUpdater'
import AudioInputService from './services/AudioInputService'
import CredentialService from './services/CredentialService'
import GenerationService from './services/GenerationService'
import LoggerService from './services/LoggerService'
import MediaAssetService from './services/MediaAssetService'
import MediaProtocolService, { registerMediaScheme } from './services/MediaProtocolService'
import OpenRouterAccountService from './services/OpenRouterAccountService'
import OpenRouterCatalogService from './services/OpenRouterCatalogService'
import OpenRouterMediaService from './services/OpenRouterMediaService'
import ReferenceImageService from './services/ReferenceImageService'
import StorageService from './services/StorageService'
import TelemetryService from './services/TelemetryService'
import TrayService from './services/TrayService'
import WindowService from './services/WindowService'

registerMediaScheme()

const applicationPaths = configureApplicationPaths()
const windowService = new WindowService(applicationPaths.dataRoot)
const telemetryService = new TelemetryService(applicationPaths.dataRoot)
const hasSingleInstanceLock = app.requestSingleInstanceLock()
let loggerService: LoggerService | null = null
let trayService: TrayService | null = null

/** Creates every service and binds it to a newly opened application window. */
const openApplicationWindow = async (): Promise<void> => {
  const storage = new StorageService(applicationPaths.dataRoot)
  await storage.initialize()
  const settings = await storage.loadSettings()
  const logger = new LoggerService(applicationPaths.logsRoot, settings.logLevel)
  loggerService = logger
  void telemetryService
    .trackStartup({
      appName: 'AIMediaStudio',
      enabled: settings.telemetryEnabled,
      version: app.getVersion(),
      platform: process.platform,
      locale: settings.uiLanguage,
    })
    .catch((error: unknown) => {
      logger.warn('TelemetryService', 'Startup telemetry could not be sent.', error)
    })
  const credentials = {
    image: new CredentialService(
      join(applicationPaths.dataRoot, 'credentials-image-openrouter.bin'),
    ),
    video: new CredentialService(
      join(applicationPaths.dataRoot, 'credentials-video-openrouter.bin'),
    ),
    tts: new CredentialService(join(applicationPaths.dataRoot, 'credentials-tts-openrouter.bin')),
    stt: new CredentialService(join(applicationPaths.dataRoot, 'credentials-stt-openrouter.bin')),
  }
  const account = new OpenRouterAccountService()
  const catalog = new OpenRouterCatalogService(applicationPaths.dataRoot, logger)
  const references = new ReferenceImageService()
  const audioInputs = new AudioInputService()
  const assets = new MediaAssetService(storage)
  const openRouter = new OpenRouterMediaService()
  const mediaProtocol = new MediaProtocolService(assets, references)
  const updater = new AppUpdater(logger)
  const window = await windowService.createWindow(logger, mediaProtocol)
  trayService?.dispose()
  const tray = new TrayService(window, settings, logger)
  trayService = tray
  const generation = new GenerationService(
    storage,
    credentials,
    catalog,
    references,
    audioInputs,
    assets,
    openRouter,
    {
      onUpdated: (event) => window.webContents.send(IpcChannel.SessionUpdated, event),
      onError: (event) => window.webContents.send(IpcChannel.AppError, event),
    },
    logger,
  )

  window.on('close', (event) => {
    if (tray.shouldMinimizeOnClose()) {
      event.preventDefault()
      window.hide()
    }
  })
  registerIpc(window, {
    storage,
    credentials,
    account,
    catalog,
    references,
    audioInputs,
    assets,
    generation,
    tray,
    updater,
    logger,
  })
  void generation.resumePendingJobs().catch((error: unknown) => {
    logger.warn('Application', 'Pending video jobs could not be resumed.', error)
  })
  logger.info('Application', 'AI Media Studio desktop started.', {
    version: app.getVersion(),
    platform: process.platform,
  })
  if (settings.autoUpdate && app.isPackaged) {
    void updater.checkForUpdates().catch((error: unknown) => {
      logger.warn('Application', 'Startup update check failed.', error)
    })
  }
}

/** Reopens the macOS application window after its previous instance closes. */
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
      app.setAppUserModelId('com.bariskisir.aimediastudio')
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

app.on('before-quit', () => trayService?.prepareToQuit())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
