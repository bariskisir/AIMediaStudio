/**
 * Coordinates GitHub API update checks, verified installer downloads, and explicit installation.
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'
import type { UpdateStateEvent } from '@shared/types'
import GitHubReleaseClient, {
  isNewerVersion,
  selectWindowsInstaller,
  type GitHubRelease,
} from './GitHubReleaseClient'

/** Runs assisted NSIS updates silently and forces the updated application to reopen. */
export const WINDOWS_INSTALLER_ARGUMENTS = ['/S', '--updated', '--force-run'] as const

/** Supplies the small Electron runtime surface needed by the updater. */
export interface UpdateRuntime {
  isPackaged: boolean
  version: string
  architecture: NodeJS.Architecture
  temporaryDirectory: string
  quit(): void
  launchInstaller(filePath: string): Promise<void>
}

/** Records updater diagnostics without coupling tests to the complete logger implementation. */
export interface UpdateLogger {
  error(module: string, message: string, details?: unknown): void
  info(module: string, message: string, details?: unknown): void
}

/** Starts the NSIS installer and resolves only after Windows accepts the child process. */
const launchInstaller = async (filePath: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(filePath, [...WINDOWS_INSTALLER_ARGUMENTS], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/** Creates the production Electron runtime adapter without leaking Electron into tests. */
const createRuntime = (): UpdateRuntime => ({
  isPackaged: app.isPackaged,
  version: app.getVersion(),
  architecture: process.arch,
  temporaryDirectory: join(app.getPath('temp'), app.name, 'Updates'),
  quit: () => app.quit(),
  launchInstaller,
})

export default class AppUpdater {
  private listener: ((event: UpdateStateEvent) => void) | null = null
  private checkPromise: Promise<void> | null = null
  private downloadedInstallerPath: string | null = null

  /** Creates an updater with explicit GitHub, runtime, and logging dependencies. */
  public constructor(
    private readonly logger: UpdateLogger,
    private readonly client = new GitHubReleaseClient(),
    private readonly runtime = createRuntime(),
  ) {}

  /** Attaches the current renderer listener for update lifecycle events. */
  public initialize(listener: (event: UpdateStateEvent) => void): void {
    this.listener = listener
  }

  /** Checks GitHub and downloads a matching setup executable only in packaged applications. */
  public async checkForUpdates(): Promise<void> {
    if (this.checkPromise) return this.checkPromise
    this.checkPromise = this.performUpdateCheck().finally(() => {
      this.checkPromise = null
    })
    return this.checkPromise
  }

  /** Starts a downloaded installer and exits only after its process has launched successfully. */
  public async quitAndInstall(): Promise<void> {
    if (!this.downloadedInstallerPath) {
      throw new Error('No downloaded update is ready to install.')
    }
    this.logger.info('AppUpdater', 'Launching application update installer.')
    await this.runtime.launchInstaller(this.downloadedInstallerPath)
    this.runtime.quit()
  }

  /** Performs one complete check and emits a renderer-safe error before propagating failures. */
  private async performUpdateCheck(): Promise<void> {
    this.emit({ state: 'checking' })
    try {
      const release = await this.client.getLatestRelease()
      if (!isNewerVersion(release.version, this.runtime.version)) {
        this.emit({ state: 'up-to-date', version: this.runtime.version })
        return
      }
      if (!this.runtime.isPackaged) {
        this.emit({
          state: 'available',
          version: release.version,
          ...(release.releaseNotes ? { releaseNotes: release.releaseNotes } : {}),
        })
        return
      }
      await this.downloadRelease(release)
    } catch (error) {
      this.logger.error('AppUpdater', 'Desktop update failed.', error)
      const message = error instanceof Error ? error.message : 'Unknown update failure.'
      this.emit({ state: 'error', message })
      throw error
    }
  }

  /** Downloads the architecture-specific release installer while reporting progress. */
  private async downloadRelease(release: GitHubRelease): Promise<void> {
    const releaseMetadata = {
      version: release.version,
      ...(release.releaseNotes ? { releaseNotes: release.releaseNotes } : {}),
    }
    this.emit({ state: 'available', ...releaseMetadata })
    const asset = selectWindowsInstaller(release, this.runtime.architecture)
    const downloaded = await this.client.downloadInstaller(
      asset,
      this.runtime.temporaryDirectory,
      (percent) => this.emit({ state: 'downloading', percent, ...releaseMetadata }),
    )
    this.downloadedInstallerPath = downloaded.filePath
    this.logger.info('AppUpdater', 'Application update downloaded.', {
      version: release.version,
      sha256: downloaded.sha256,
    })
    this.emit({ state: 'downloaded', percent: 100, ...releaseMetadata })
  }

  /** Sends one serializable update state to the active renderer listener. */
  private emit(event: UpdateStateEvent): void {
    this.listener?.(event)
  }
}
