/**
 * Owns the optional system tray icon and close-to-tray behavior.
 */

import { join } from 'node:path'
import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import { IpcChannel } from '@shared/IpcChannel'
import type { AppSettings } from '@shared/types'
import type LoggerService from './LoggerService'

type TraySettings = Pick<AppSettings, 'showTrayIcon' | 'minimizeToTrayOnClose'>

export default class TrayService {
  private tray: Tray | null = null
  private settings: TraySettings
  private quitting = false

  /** Creates the configured tray icon without exposing Electron objects to the renderer. */
  public constructor(
    private readonly window: BrowserWindow,
    settings: TraySettings,
    private readonly logger: LoggerService,
  ) {
    this.settings = {
      showTrayIcon: settings.showTrayIcon,
      minimizeToTrayOnClose: settings.minimizeToTrayOnClose,
    }
    this.updateTrayIcon()
  }

  /** Applies persisted tray preferences immediately. */
  public applySettings(settings: TraySettings): void {
    this.settings = {
      showTrayIcon: settings.showTrayIcon,
      minimizeToTrayOnClose: settings.minimizeToTrayOnClose,
    }
    this.updateTrayIcon()
  }

  /** Returns true only when hiding cannot strand the user without a working tray icon. */
  public shouldMinimizeOnClose(): boolean {
    return !this.quitting && this.settings.minimizeToTrayOnClose && this.tray !== null
  }

  /** Prevents close-to-tray from intercepting an explicit application quit. */
  public prepareToQuit(): void {
    this.quitting = true
    this.destroyTrayIcon()
  }

  /** Releases native resources when the owning application window is replaced. */
  public dispose(): void {
    this.destroyTrayIcon()
  }

  /** Creates or removes the native icon to match the latest persisted setting. */
  private updateTrayIcon(): void {
    if (this.quitting || !this.settings.showTrayIcon) {
      this.destroyTrayIcon()
      return
    }
    if (this.tray) return

    try {
      const iconPath = app.isPackaged
        ? join(process.resourcesPath, 'icon.png')
        : join(app.getAppPath(), 'build', 'icon.png')
      const sourceImage = nativeImage.createFromPath(iconPath)
      if (sourceImage.isEmpty()) throw new Error(`Tray icon could not be read from ${iconPath}.`)
      const trayImage =
        process.platform === 'win32' ? sourceImage : sourceImage.resize({ width: 16, height: 16 })
      const tray = new Tray(trayImage)
      tray.setToolTip('Transcript')
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Open', click: () => this.showWindow() },
          { label: 'Settings', click: () => this.showSettings() },
          { label: 'Exit', role: 'quit' },
        ]),
      )
      tray.on('click', () => this.showWindow())
      this.tray = tray
    } catch (error) {
      this.logger.error('TrayService', 'System tray icon could not be created.', error)
      this.tray = null
    }
  }

  /** Restores and focuses the application from either tray interaction. */
  private showWindow(): void {
    if (this.window.isDestroyed()) return
    if (this.window.isMinimized()) this.window.restore()
    this.window.show()
    this.window.focus()
  }

  /** Restores the window and asks the renderer to open its settings page. */
  private showSettings(): void {
    this.showWindow()
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(IpcChannel.SettingsOpenRequested)
    }
  }

  /** Destroys the current native tray instance exactly once. */
  private destroyTrayIcon(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
