/**
 * Defines the durable, log, and isolated Electron runtime directories for the application.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface ApplicationPaths {
  applicationDataRoot: string
  dataRoot: string
  logsRoot: string
  runtimeRoot: string
  sessionRoot: string
}

/** Configures Electron paths before ready so Chromium files stay outside durable app data. */
export const configureApplicationPaths = (): ApplicationPaths => {
  const applicationDataRoot = join(app.getPath('appData'), 'Transcript')
  const dataRoot = join(applicationDataRoot, 'Data')
  const logsRoot = join(applicationDataRoot, 'Logs')
  const runtimeRoot = join(applicationDataRoot, 'Runtime')
  const sessionRoot = join(runtimeRoot, 'Session')

  ;[applicationDataRoot, dataRoot, logsRoot, runtimeRoot, sessionRoot].forEach((directory) => {
    mkdirSync(directory, { recursive: true })
  })
  app.setPath('userData', runtimeRoot)
  app.setPath('sessionData', sessionRoot)
  app.setAppLogsPath(logsRoot)

  return {
    applicationDataRoot,
    dataRoot,
    logsRoot,
    runtimeRoot,
    sessionRoot,
  }
}
