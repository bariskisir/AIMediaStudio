/**
 * Migrates only durable Transcript data and discards obsolete Electron runtime files.
 */

import { constants, type Dirent } from 'node:fs'
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

interface MigrationPaths {
  applicationDataRoot: string
  dataRoot: string
  logsRoot: string
  legacyRoot: string
}

export default class LegacyDataMigrationService {
  /** Creates a one-time migration constrained to the previous application directory. */
  public constructor(private readonly paths: MigrationPaths) {}

  /** Copies allow-listed durable files and removes the obsolete runtime directory afterward. */
  public async migrate(): Promise<void> {
    if (!this.isSafeLegacyRoot()) throw new Error('The legacy data path is not safe to migrate.')
    if (!(await this.directoryExists(this.paths.legacyRoot))) return

    const legacyDataRoot = join(this.paths.legacyRoot, 'Transcript')
    await mkdir(this.paths.dataRoot, { recursive: true })
    await mkdir(this.paths.logsRoot, { recursive: true })
    await this.copyOptionalFile(
      join(legacyDataRoot, 'settings.json'),
      join(this.paths.dataRoot, 'settings.json'),
    )
    await this.copyOptionalFile(
      join(legacyDataRoot, 'credentials.bin'),
      join(this.paths.dataRoot, 'credentials.bin'),
    )
    await this.copyDirectoryFiles(
      join(legacyDataRoot, 'transcripts'),
      join(this.paths.dataRoot, 'transcripts'),
      (name) => name.endsWith('.json'),
    )
    await this.copyDirectoryFiles(
      join(this.paths.legacyRoot, 'logs'),
      this.paths.logsRoot,
      (name) => name.endsWith('.log'),
    )
    await rm(this.paths.legacyRoot, { recursive: true, force: true })
  }

  /** Copies one durable file only when the destination does not already exist. */
  private async copyOptionalFile(sourcePath: string, destinationPath: string): Promise<void> {
    try {
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'EEXIST') throw error
    }
  }

  /** Copies allow-listed files from one optional legacy directory. */
  private async copyDirectoryFiles(
    sourceDirectory: string,
    destinationDirectory: string,
    include: (name: string) => boolean,
  ): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await readdir(sourceDirectory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    await mkdir(destinationDirectory, { recursive: true })
    for (const entry of entries) {
      if (entry.isFile() && include(entry.name)) {
        await this.copyOptionalFile(
          join(sourceDirectory, entry.name),
          join(destinationDirectory, entry.name),
        )
      }
    }
  }

  /** Returns whether an optional legacy directory currently exists. */
  private async directoryExists(directoryPath: string): Promise<boolean> {
    try {
      await readdir(directoryPath)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  /** Verifies that recursive cleanup can affect only the expected sibling application folder. */
  private isSafeLegacyRoot(): boolean {
    const legacyRoot = resolve(this.paths.legacyRoot)
    const applicationDataRoot = resolve(this.paths.applicationDataRoot)
    return (
      dirname(legacyRoot) === dirname(applicationDataRoot) &&
      basename(legacyRoot) === ['transcript', 'desktop'].join('-') &&
      legacyRoot !== applicationDataRoot
    )
  }
}
