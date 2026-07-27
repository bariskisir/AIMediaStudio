/**
 * Owns the hardened Electron window and renderer navigation boundary.
 */

import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { isTrustedRendererNavigation } from '../security/RendererNavigationPolicy'
import type LoggerService from './LoggerService'
import type MediaProtocolService from './MediaProtocolService'

export default class WindowService {
  private mainWindow: BrowserWindow | null = null
  private readonly rendererPath = join(__dirname, '../renderer/index.html')

  /** Returns the active main window when it is still alive. */
  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow : null
  }

  /** Creates and loads a sandboxed window without granting renderer device permissions. */
  public async createWindow(
    logger: LoggerService,
    mediaProtocol: MediaProtocolService,
  ): Promise<BrowserWindow> {
    const window = new BrowserWindow({
      width: 1200,
      height: 800,
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
    mediaProtocol.attach(window.webContents.session)
    this.configureDiagnostics(window, logger)
    this.configureSecurity(window)
    window.once('ready-to-show', () => window.show())
    window.once('closed', () => {
      if (this.mainWindow === window) this.mainWindow = null
    })
    await this.loadRenderer(window)
    return window
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
