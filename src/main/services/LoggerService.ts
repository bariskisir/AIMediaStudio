/**
 * Provides level-aware daily AppData logs for main and renderer diagnostics.
 */

import { mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import electronLog from 'electron-log/main'
import type { LogLevel, RendererLogEntry } from '@shared/types'

const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024
const GENERAL_RETENTION_DAYS = 30
const ERROR_RETENTION_DAYS = 60

type ElectronLogger = ReturnType<typeof electronLog.create>

export default class LoggerService {
  private readonly appLogger: ElectronLogger
  private readonly errorLogger: ElectronLogger
  private level: LogLevel | null = null

  /** Creates daily general and warning/error transports under the application data directory. */
  public constructor(
    private readonly logsDirectory: string,
    level: LogLevel,
  ) {
    this.appLogger = electronLog.create({ logId: `${app.name}-app` })
    this.errorLogger = electronLog.create({ logId: `${app.name}-errors` })
    this.configureLogger(this.appLogger, 'app')
    this.configureLogger(this.errorLogger, 'app-error')
    this.setLevel(level)
    void this.pruneExpiredLogs()
  }

  /** Returns the directory containing all diagnostic files. */
  public getLogsDirectory(): string {
    return this.logsDirectory
  }

  /** Applies a new minimum level to console and file transports immediately. */
  public setLevel(level: LogLevel): void {
    if (this.level === level) return
    this.level = level
    this.appLogger.transports.file.level = level
    this.appLogger.transports.console.level = level
    const errorFileLevel = level === 'error' ? 'error' : 'warn'
    this.errorLogger.transports.file.level = errorFileLevel
    this.errorLogger.transports.console.level = false
    this.info('LoggerService', `Log level changed to ${level}.`)
  }

  /** Writes one sanitized renderer entry through the same AppData transports. */
  public writeRenderer(entry: RendererLogEntry): void {
    this.write(entry.level, `Renderer:${entry.module}`, entry.message, entry.details)
  }

  /** Writes a main-process error with optional diagnostic detail. */
  public error(module: string, message: string, details?: unknown): void {
    this.write('error', module, message, details)
  }

  /** Writes a main-process warning with optional diagnostic detail. */
  public warn(module: string, message: string, details?: unknown): void {
    this.write('warn', module, message, details)
  }

  /** Writes a main-process informational event. */
  public info(module: string, message: string, details?: unknown): void {
    this.write('info', module, message, details)
  }

  /** Writes a main-process debug event. */
  public debug(module: string, message: string, details?: unknown): void {
    this.write('debug', module, message, details)
  }

  /** Configures one electron-log instance with daily naming and size rotation. */
  private configureLogger(logger: ElectronLogger, prefix: string): void {
    logger.transports.file.maxSize = MAX_LOG_SIZE_BYTES
    logger.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
    logger.transports.file.resolvePathFn = () =>
      join(this.logsDirectory, `${prefix}.${this.currentDate()}.log`)
    logger.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}'
  }

  /** Routes one entry to general logs and mirrors warnings/errors to the error log. */
  private write(level: LogLevel, module: string, message: string, details?: unknown): void {
    const detail = this.serializeDetails(details)
    const text = `[${module}] ${message}${detail ? ` | ${detail}` : ''}`
    this.callLogger(this.appLogger, level, text)
    if (level === 'error' || level === 'warn') this.callLogger(this.errorLogger, level, text)
  }

  /** Calls a typed electron-log level without dynamic unsafe invocation. */
  private callLogger(logger: ElectronLogger, level: LogLevel, text: string): void {
    if (level === 'error') logger.error(text)
    else if (level === 'warn') logger.warn(text)
    else if (level === 'info') logger.info(text)
    else if (level === 'debug') logger.debug(text)
    else logger.verbose(text)
  }

  /** Serializes errors and structured metadata without retaining object references. */
  private serializeDetails(details: unknown): string {
    if (details === undefined) return ''
    if (details instanceof Error)
      return `${details.name}: ${details.message}\n${details.stack ?? ''}`.trim()
    if (typeof details === 'string') return details.slice(0, 8_000)
    try {
      return JSON.stringify(details).slice(0, 8_000)
    } catch {
      if (
        typeof details === 'number' ||
        typeof details === 'boolean' ||
        typeof details === 'bigint' ||
        typeof details === 'symbol'
      ) {
        return String(details).slice(0, 8_000)
      }
      return `[Unserializable ${typeof details}]`
    }
  }

  /** Returns a stable local calendar date for daily file names. */
  private currentDate(): string {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  /** Removes expired daily logs while preserving the longer error-log retention window. */
  private async pruneExpiredLogs(): Promise<void> {
    try {
      await mkdir(this.logsDirectory, { recursive: true })
      const entries = await readdir(this.logsDirectory, { withFileTypes: true })
      const now = Date.now()
      await Promise.all(
        entries.map(async (entry) => {
          if (!entry.isFile()) return
          const retentionDays = entry.name.startsWith('app-error.')
            ? ERROR_RETENTION_DAYS
            : GENERAL_RETENTION_DAYS
          if (!entry.name.startsWith('app.') && !entry.name.startsWith('app-error.')) return
          const createdAt = this.parseLogDate(entry.name)
          if (createdAt !== null && now - createdAt > retentionDays * 86_400_000) {
            await unlink(join(this.logsDirectory, entry.name))
          }
        }),
      )
    } catch (error) {
      this.errorLogger.warn('[LoggerService] Could not prune expired logs.', error)
    }
  }

  /** Extracts the local daily log date without following links or reading file metadata. */
  private parseLogDate(name: string): number | null {
    const match = /^(?:app|app-error)\.(\d{4})-(\d{2})-(\d{2})\.log(?:\.\d+)?$/.exec(name)
    if (!match) return null
    const [, year, month, day] = match
    const timestamp = new Date(Number(year), Number(month) - 1, Number(day)).getTime()
    return Number.isNaN(timestamp) ? null : timestamp
  }
}
