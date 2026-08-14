/**
 * Verifies main-window startup visibility, including minimized-to-tray startup.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WindowService from '../src/main/services/WindowService'
import type MediaProtocolService from '../src/main/services/MediaProtocolService'
import type LoggerService from '../src/main/services/LoggerService'

const electronMocks = vi.hoisted(() => {
  class MockBrowserWindow {
    public static instances: MockBrowserWindow[] = []
    public readonly options: unknown
    private readonly eventListeners = new Map<string, () => void>()
    public readonly show = vi.fn()
    public readonly hide = vi.fn()
    public readonly minimize = vi.fn()
    public readonly maximize = vi.fn()
    public readonly restore = vi.fn()
    public readonly focus = vi.fn()
    public readonly setFullScreen = vi.fn()
    public readonly getBounds = vi.fn(() => ({ x: 0, y: 0, width: 1200, height: 800 }))
    public readonly getNormalBounds = vi.fn(() => ({ x: 0, y: 0, width: 1200, height: 800 }))
    public readonly isDestroyed = vi.fn(() => false)
    public readonly isMinimized = vi.fn(() => false)
    public readonly isMaximized = vi.fn(() => false)
    public readonly isFullScreen = vi.fn(() => false)
    public readonly loadFile = vi.fn(async () => undefined)
    public readonly loadURL = vi.fn(async () => undefined)
    public readonly webContents = {
      id: 1,
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      session: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
      },
    }

    /** Records each created window so tests can trigger lifecycle events. */
    public constructor(options: unknown) {
      this.options = options
      MockBrowserWindow.instances.push(this)
    }

    /** Stores a listener without distinguishing one-shot subscriptions. */
    public on(event: string, listener: () => void): void {
      this.eventListeners.set(event, listener)
    }

    /** Stores a listener without distinguishing one-shot subscriptions. */
    public once(event: string, listener: () => void): void {
      this.eventListeners.set(event, listener)
    }

    /** Fires the stored listener for one native lifecycle event. */
    public emit(event: string): void {
      this.eventListeners.get(event)?.()
    }
  }

  return {
    MockBrowserWindow,
    getAllDisplays: vi.fn(() => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]),
  }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    name: 'AI Media Studio',
    getAppPath: () => '/app',
    resourcesPath: '/resources',
  },
  BrowserWindow: electronMocks.MockBrowserWindow,
  screen: { getAllDisplays: electronMocks.getAllDisplays },
}))

/** Creates the media protocol capability consumed by WindowService. */
const createMediaProtocol = (): MediaProtocolService =>
  ({ attach: vi.fn() }) as unknown as MediaProtocolService

/** Creates the logging capability used by WindowService. */
const createLogger = (): LoggerService =>
  ({ error: vi.fn(), warn: vi.fn() }) as unknown as LoggerService

describe('WindowService', () => {
  let dataRoot: string

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'window-service-'))
    electronMocks.MockBrowserWindow.instances.length = 0
    vi.stubEnv('VITE_DEV_SERVER_URL', '')
  })

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('shows the window normally when minimized startup is disabled', async () => {
    const service = new WindowService(dataRoot)
    await service.createWindow(createLogger(), createMediaProtocol())
    const window = electronMocks.MockBrowserWindow.instances[0]

    window?.emit('ready-to-show')

    expect(window?.show).toHaveBeenCalledOnce()
    expect(window?.hide).not.toHaveBeenCalled()
  })

  it('hides the window to the tray when minimized startup is enabled', async () => {
    const service = new WindowService(dataRoot)
    await service.createWindow(createLogger(), createMediaProtocol(), true)
    const window = electronMocks.MockBrowserWindow.instances[0]

    window?.emit('ready-to-show')

    expect(window?.hide).toHaveBeenCalledOnce()
    expect(window?.show).not.toHaveBeenCalled()
  })

  it('restores the persisted maximized state before showing', async () => {
    writeFileSync(
      join(dataRoot, 'window-state.json'),
      JSON.stringify({
        revision: 1,
        bounds: { x: 100, y: 100, width: 800, height: 600 },
        maximized: true,
        fullScreen: false,
      }),
    )
    const service = new WindowService(dataRoot)
    await service.createWindow(createLogger(), createMediaProtocol())
    const window = electronMocks.MockBrowserWindow.instances[0]

    window?.emit('ready-to-show')

    expect(window?.maximize).toHaveBeenCalledOnce()
    expect(window?.show).toHaveBeenCalledOnce()
  })

  it('restores the persisted fullscreen state before showing', async () => {
    writeFileSync(
      join(dataRoot, 'window-state.json'),
      JSON.stringify({
        revision: 1,
        bounds: { x: 100, y: 100, width: 800, height: 600 },
        maximized: false,
        fullScreen: true,
      }),
    )
    const service = new WindowService(dataRoot)
    await service.createWindow(createLogger(), createMediaProtocol())
    const window = electronMocks.MockBrowserWindow.instances[0]

    window?.emit('ready-to-show')

    expect(window?.setFullScreen).toHaveBeenCalledWith(true)
    expect(window?.show).toHaveBeenCalledOnce()
  })
})
