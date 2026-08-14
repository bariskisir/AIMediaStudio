/**
 * Owns the hardened Electron window and renderer navigation boundary.
 */

import { readFile } from 'node:fs/promises'
import { renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import { isTrustedRendererNavigation } from '../security/RendererNavigationPolicy'
import {
  fitWindowBoundsToDisplays,
  parsePersistedWindowState,
  type PersistedWindowState,
} from '../windowState'
import type LoggerService from './LoggerService'
import type MediaProtocolService from './MediaProtocolService'

export default class WindowService {
  private mainWindow: BrowserWindow | null = null
  private readonly rendererPath = join(__dirname, '../renderer/index.html')
  private readonly statePath: string
  private state: PersistedWindowState | null = null
  private stateSaveTimer: ReturnType<typeof setTimeout> | null = null
  private logger: LoggerService | null = null

  /** Creates a window owner that persists shell state in the durable application data directory. */
  public constructor(dataRoot: string) {
    this.statePath = join(dataRoot, 'window-state.json')
  }

  /** Returns the active main window when it is still alive. */
  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow : null
  }

  /** Creates and loads a sandboxed window without granting renderer device permissions. */
  public async createWindow(
    logger: LoggerService,
    mediaProtocol: MediaProtocolService,
    startMinimized = false,
  ): Promise<BrowserWindow> {
    this.logger = logger
    const storedState = await this.loadWindowState()
    const restoredBounds = storedState
      ? fitWindowBoundsToDisplays(
          storedState.bounds,
          screen.getAllDisplays().map((display) => display.workArea),
        )
      : null
    const window = new BrowserWindow({
      ...(restoredBounds ?? { width: 1200, height: 800 }),
      minWidth: 720,
      minHeight: 520,
      fullscreenable: true,
      show: false,
      backgroundColor: '#181818',
      title: 'AI Media Studio',
      icon: app.isPackaged
        ? join(process.resourcesPath, 'icon.png')
        : join(app.getAppPath(), 'build', 'icon.png'),
      ...(process.platform === 'darwin'
        ? {
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: { color: '#1f1f1f', symbolColor: '#ffffff99', height: 42 },
          }
        : { frame: false }),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: !app.isPackaged,
        partition: `${app.name}-session`,
      },
    })
    this.mainWindow = window
    this.state = {
      revision: 1,
      bounds: restoredBounds ?? window.getBounds(),
      maximized: storedState?.maximized ?? false,
      fullScreen: storedState?.fullScreen ?? false,
    }
    mediaProtocol.attach(window.webContents.session)
    this.configureDiagnostics(window, logger)
    this.configureSecurity(window)
    this.configureWindowStatePersistence(window)
    window.once('ready-to-show', () => {
      if (storedState?.fullScreen) window.setFullScreen(true)
      else if (storedState?.maximized) window.maximize()
      if (startMinimized) window.hide()
      else window.show()
    })
    window.once('closed', () => {
      if (this.stateSaveTimer) clearTimeout(this.stateSaveTimer)
      this.stateSaveTimer = null
      if (this.mainWindow === window) this.mainWindow = null
    })
    await this.loadRenderer(window)
    return window
  }

  /** Loads the last valid window state without preventing startup after read or parse failures. */
  private async loadWindowState(): Promise<PersistedWindowState | null> {
    try {
      return parsePersistedWindowState(
        JSON.parse(await readFile(this.statePath, 'utf8')) as unknown,
      )
    } catch {
      return null
    }
  }

  /** Tracks normal bounds, maximized state, and native fullscreen state for later launches. */
  private configureWindowStatePersistence(window: BrowserWindow): void {
    window.on('move', () => this.scheduleWindowStateSave(window))
    window.on('resize', () => this.scheduleWindowStateSave(window))
    window.on('maximize', () => this.scheduleWindowStateSave(window))
    window.on('unmaximize', () => this.scheduleWindowStateSave(window))
    window.on('enter-full-screen', () => this.scheduleWindowStateSave(window))
    window.on('leave-full-screen', () => this.scheduleWindowStateSave(window))
    window.on('close', () => {
      if (this.stateSaveTimer) clearTimeout(this.stateSaveTimer)
      this.stateSaveTimer = null
      this.captureWindowState(window)
      this.persistWindowState()
    })
  }

  /** Debounces frequent move and resize events before saving the latest state. */
  private scheduleWindowStateSave(window: BrowserWindow): void {
    this.captureWindowState(window)
    if (this.stateSaveTimer) clearTimeout(this.stateSaveTimer)
    this.stateSaveTimer = setTimeout(() => {
      this.stateSaveTimer = null
      this.captureWindowState(window)
      this.persistWindowState()
    }, 250)
  }

  /** Captures normal bounds while retaining them when maximized or fullscreen. */
  private captureWindowState(window: BrowserWindow): void {
    if (window.isDestroyed()) return
    const maximized = window.isMaximized()
    const fullScreen = window.isFullScreen()
    const bounds =
      maximized || fullScreen
        ? (this.state?.bounds ?? window.getNormalBounds())
        : window.getBounds()
    this.state = { revision: 1, bounds, maximized, fullScreen }
  }

  /** Atomically writes the small window-state document so close events cannot lose a last move. */
  private persistWindowState(): void {
    if (!this.state) return
    const temporaryPath = `${this.statePath}.tmp`
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
      renameSync(temporaryPath, this.statePath)
    } catch (error) {
      this.logger?.warn('WindowService', 'Window state could not be persisted.', error)
    }
  }

  /** Records renderer failures without logging private generation prompts. */
  private configureDiagnostics(window: BrowserWindow, logger: LoggerService): void {
    window.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (isMainFrame) {
          logger.error('WindowService', 'Renderer document failed to load.', {
            errorCode,
            errorDescription,
            validatedUrl,
          })
        }
      },
    )
    window.webContents.on('preload-error', (_event, preloadPath, error) => {
      logger.error('WindowService', 'Renderer preload failed.', { preloadPath, error })
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      logger.error('WindowService', 'Renderer process exited unexpectedly.', details)
    })
  }

  /** Loads the Vite development server or packaged renderer file. */
  private async loadRenderer(window: BrowserWindow): Promise<void> {
    const developmentUrl = process.env.VITE_DEV_SERVER_URL
    if (developmentUrl) await window.loadURL(developmentUrl)
    else await window.loadFile(this.rendererPath)
  }

  /** Blocks popups and renderer navigation outside the bundled application. */
  private configureSecurity(window: BrowserWindow): void {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (!this.isTrustedRendererUrl(url)) event.preventDefault()
    })
    window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => {
      callback(this.isAllowedRendererPermission(window, contents.id, permission))
    })
    window.webContents.session.setPermissionCheckHandler((contents, permission) =>
      this.isAllowedRendererPermission(window, contents?.id ?? null, permission),
    )
  }

  /** Allows only non-reading UI permissions originating from the isolated main renderer. */
  private isAllowedRendererPermission(
    window: BrowserWindow,
    webContentsId: number | null,
    permission: string,
  ): boolean {
    if (webContentsId !== window.webContents.id) return false
    return permission === 'fullscreen'
  }

  /** Accepts only the packaged file or exact Vite development origin. */
  private isTrustedRendererUrl(url: string): boolean {
    return isTrustedRendererNavigation(url, this.rendererPath, process.env.VITE_DEV_SERVER_URL)
  }
}
