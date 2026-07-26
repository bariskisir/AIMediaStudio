/**
 * Sends renderer diagnostics to the main-process AppData logger without exposing Electron internals.
 */

import type { LogLevel } from '@shared/types'

/** Converts an unknown failure into concise diagnostic text. */
export const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

class RendererLogger {
  /** Creates a logger scoped to one renderer module. */
  public constructor(private readonly module: string) {}

  /** Persists an error and its normalized diagnostic detail. */
  public error(message: string, error?: unknown): void {
    this.write('error', message, error)
  }

  /** Persists a recoverable warning. */
  public warn(message: string, details?: unknown): void {
    this.write('warn', message, details)
  }

  /** Persists a renderer lifecycle event. */
  public info(message: string, details?: unknown): void {
    this.write('info', message, details)
  }

  /** Persists verbose renderer diagnostics when the selected level permits them. */
  public debug(message: string, details?: unknown): void {
    this.write('debug', message, details)
  }

  /** Sends a bounded serializable entry to the preload bridge. */
  private write(level: LogLevel, message: string, details?: unknown): void {
    window.app.writeLog({
      level,
      module: this.module,
      message: message.slice(0, 1_000),
      ...(details === undefined ? {} : { details: toErrorMessage(details).slice(0, 8_000) }),
    })
  }
}

/** Creates a renderer logger with stable module context. */
export const createLogger = (module: string): RendererLogger => new RendererLogger(module)
