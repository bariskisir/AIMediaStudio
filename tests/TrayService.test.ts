/**
 * Verifies native tray creation, window restoration, and safe close-to-tray gating.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import TrayService from '../src/main/services/TrayService'
import type LoggerService from '../src/main/services/LoggerService'

const electronMocks = vi.hoisted(() => {
  class MockTray {
    public readonly handlers = new Map<string, () => void>()
    public readonly destroy = vi.fn()
    public readonly setContextMenu = vi.fn()
    public readonly setToolTip = vi.fn()

    public on(event: string, listener: () => void): void {
      this.handlers.set(event, listener)
    }
  }

  return {
    MockTray,
    instances: [] as MockTray[],
    menuTemplates: [] as unknown[][],
    imageEmpty: false,
    quit: vi.fn(),
  }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => 'C:\\repo',
    quit: electronMocks.quit,
  },
  Menu: {
    buildFromTemplate: vi.fn((template: unknown[]) => {
      electronMocks.menuTemplates.push(template)
      return template
    }),
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({
      isEmpty: () => electronMocks.imageEmpty,
      resize: vi.fn(() => ({ resized: true })),
    })),
  },
  Tray: class extends electronMocks.MockTray {
    public constructor() {
      super()
      electronMocks.instances.push(this)
    }
  },
}))

/** Creates the BrowserWindow capabilities used by TrayService. */
const createWindow = (): BrowserWindow =>
  ({
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  }) as unknown as BrowserWindow

/** Creates the logging capability used by TrayService. */
const createLogger = (): LoggerService => ({ error: vi.fn() }) as unknown as LoggerService

describe('TrayService', () => {
  beforeEach(() => {
    electronMocks.instances.length = 0
    electronMocks.menuTemplates.length = 0
    electronMocks.imageEmpty = false
    electronMocks.quit.mockClear()
  })

  it('does not create a tray icon while the preference is disabled', () => {
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: false, minimizeToTrayOnClose: false },
      createLogger(),
    )

    expect(electronMocks.instances).toHaveLength(0)
    expect(service.shouldMinimizeOnClose()).toBe(false)
  })

  it('creates, restores from, and removes the tray icon dynamically', () => {
    const window = createWindow()
    const service = new TrayService(
      window,
      { showTrayIcon: false, minimizeToTrayOnClose: false },
      createLogger(),
    )

    service.applySettings({ showTrayIcon: true, minimizeToTrayOnClose: true })
    const tray = electronMocks.instances[0]
    expect(tray).toBeDefined()
    expect(service.shouldMinimizeOnClose()).toBe(true)

    tray?.handlers.get('click')?.()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()

    service.applySettings({ showTrayIcon: false, minimizeToTrayOnClose: false })
    expect(tray?.destroy).toHaveBeenCalledOnce()
    expect(service.shouldMinimizeOnClose()).toBe(false)
  })

  it('never hides the window when native tray creation fails', () => {
    electronMocks.imageEmpty = true
    const logger = createLogger()
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: true, minimizeToTrayOnClose: true },
      logger,
    )

    expect(service.shouldMinimizeOnClose()).toBe(false)
    expect(logger.error).toHaveBeenCalledOnce()
  })

  it('destroys the icon and bypasses close-to-tray during application quit', () => {
    const service = new TrayService(
      createWindow(),
      { showTrayIcon: true, minimizeToTrayOnClose: true },
      createLogger(),
    )
    const tray = electronMocks.instances[0]

    service.prepareToQuit()

    expect(tray?.destroy).toHaveBeenCalledOnce()
    expect(service.shouldMinimizeOnClose()).toBe(false)
  })

  it('builds an unseparated Open, Settings, Exit menu and opens settings', () => {
    const window = createWindow()
    new TrayService(window, { showTrayIcon: true, minimizeToTrayOnClose: true }, createLogger())
    const menu = electronMocks.menuTemplates[0] as Array<{
      label?: string
      type?: string
      click?: () => void
    }>

    expect(menu.map((item) => item.label)).toEqual(['Open', 'Settings', 'Exit'])
    expect(menu.some((item) => item.type === 'separator')).toBe(false)

    menu[1]?.click?.()
    expect(window.webContents.send).toHaveBeenCalledWith('event:settings-open-requested')
  })
})
