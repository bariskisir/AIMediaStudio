/**
 * Manages one independent Deepgram connection per active audio source.
 */

import type { DeepgramTranscriptionSettings } from '@shared/transcription'
import type { AudioSource, TranscriptResultEvent } from '@shared/types'
import DeepgramConnection from './DeepgramConnection'
import type LoggerService from './LoggerService'

interface StartOptions {
  sources: AudioSource[]
  apiKey: string
  settings: DeepgramTranscriptionSettings
  onResult: (event: TranscriptResultEvent) => void
  onError: (source: AudioSource, message: string) => void
}

export default class DeepgramService {
  private readonly connections = new Map<AudioSource, DeepgramConnection>()

  /** Creates the connection manager with structured lifecycle logging. */
  public constructor(private readonly logger: LoggerService) {}

  /** Opens one WebSocket per source and rolls all back if one fails. */
  public async start(options: StartOptions): Promise<void> {
    if (this.connections.size > 0) throw new Error('Transcription is already running.')
    try {
      await Promise.all(
        options.sources.map(async (source) => {
          const connection = new DeepgramConnection({
            source,
            apiKey: options.apiKey,
            settings: options.settings,
            onResult: options.onResult,
            onError: (message) => options.onError(source, message),
            onDiagnostic: (level, message, details) => {
              if (level === 'error') this.logger.error('Deepgram', message, details)
              else if (level === 'warn') this.logger.warn('Deepgram', message, details)
              else if (level === 'info') this.logger.info('Deepgram', message, details)
              else this.logger.debug('Deepgram', message, details)
            },
          })
          this.connections.set(source, connection)
          await connection.connect()
        }),
      )
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  /** Routes a PCM frame exclusively to its matching source connection. */
  public send(source: AudioSource, samples: Uint8Array): void {
    this.connections.get(source)?.send(samples)
  }

  /** Gracefully closes all source connections. */
  public async stop(): Promise<void> {
    const connections = [...this.connections.values()]
    this.connections.clear()
    await Promise.allSettled(connections.map((connection) => connection.close()))
  }
}
