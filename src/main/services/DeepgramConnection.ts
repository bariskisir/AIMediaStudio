/**
 * Owns one source-specific Deepgram streaming WebSocket connection.
 */

import type { DeepgramTranscriptionSettings } from '@shared/transcription'
import type { AudioSource, LogLevel, TranscriptResultEvent } from '@shared/types'
import WebSocket from 'ws'
import { buildDeepgramEndpoint } from './DeepgramEndpoint'
import { parseDeepgramMessage } from './DeepgramMessageParser'

interface ConnectionOptions {
  source: AudioSource
  apiKey: string
  settings: DeepgramTranscriptionSettings
  onResult: (event: TranscriptResultEvent) => void
  onError: (message: string) => void
  onDiagnostic: (level: LogLevel, message: string, details?: unknown) => void
}

const OPEN_TIMEOUT_MS = 12_000
const CLOSE_TIMEOUT_MS = 1_500
const FINALIZE_WAIT_MS = 250
const AUDIO_DRAIN_TIMEOUT_MS = 250
const MAX_BUFFERED_AUDIO_BYTES = 6_400
const MAX_QUEUED_AUDIO_FRAMES = 4
const BACKPRESSURE_LOG_INTERVAL_MS = 5_000

export default class DeepgramConnection {
  private socket: WebSocket | null = null
  private keepAliveTimer: NodeJS.Timeout | null = null
  private lastAudioAt = 0
  private lastBackpressureLogAt = 0
  private stopping = false
  private finalizeAcknowledged = false
  private sendInFlight = false
  private pendingAudio: Buffer[] = []
  private backpressureTimer: NodeJS.Timeout | null = null
  private closePromise: Promise<void> | null = null

  /** Creates a connection dedicated to exactly one audio source. */
  public constructor(private readonly options: ConnectionOptions) {}

  /** Opens and configures a Deepgram real-time stream. */
  public async connect(): Promise<void> {
    this.options.onDiagnostic('info', 'Opening Deepgram stream.', {
      source: this.options.source,
      model: this.options.settings.model,
      language: this.options.settings.language,
    })
    const socket = new WebSocket(buildDeepgramEndpoint(this.options.settings), {
      headers: { Authorization: `Token ${this.options.apiKey}` },
    })
    this.socket = socket
    await this.waitUntilOpen(socket)
    this.options.onDiagnostic('info', 'Deepgram stream opened.', {
      source: this.options.source,
    })

    socket.on('message', (data, isBinary) => {
      if (isBinary) return
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString('utf8')
          : data.toString('utf8')
      if (this.isFinalizeAcknowledgement(text)) this.finalizeAcknowledged = true
      const event = parseDeepgramMessage(this.options.source, text)
      if (event) this.options.onResult(event)
    })
    socket.on('error', (error) => {
      if (!this.stopping) {
        this.options.onDiagnostic('error', 'Deepgram WebSocket error.', error)
        this.options.onError(error.message)
      }
    })
    socket.on('close', (code, reason) => {
      this.clearKeepAlive()
      if (!this.stopping && code !== 1000) {
        const detail = reason.toString().trim()
        this.options.onDiagnostic('warn', 'Deepgram closed a live stream.', {
          source: this.options.source,
          code,
          reason: detail,
        })
        this.options.onError(`Deepgram closed the stream (${code})${detail ? `: ${detail}` : '.'}`)
      }
    })

    this.lastAudioAt = Date.now()
    this.keepAliveTimer = setInterval(() => this.sendKeepAliveWhenIdle(), 4_000)
  }

  /** Sends a non-empty binary PCM frame when the stream is ready. */
  public send(samples: Uint8Array): void {
    const socket = this.socket
    if (this.stopping || samples.byteLength === 0 || socket?.readyState !== WebSocket.OPEN) {
      return
    }
    this.lastAudioAt = Date.now()
    if (this.pendingAudio.length >= MAX_QUEUED_AUDIO_FRAMES) {
      this.pendingAudio.shift()
      this.logBackpressure(socket.bufferedAmount)
    }
    this.pendingAudio.push(Buffer.from(samples))
    this.pumpAudio()
  }

  /** Flushes server buffers and closes within a bounded timeout. */
  public async close(): Promise<void> {
    this.closePromise ??= this.closeInternal()
    await this.closePromise
  }

  /** Drains recent audio, finalizes hypotheses, and lets Deepgram close the stream. */
  private async closeInternal(): Promise<void> {
    this.stopping = true
    this.clearKeepAlive()
    try {
      await this.waitForAudioDrain()
      const socket = this.socket
      if (!socket || socket.readyState === WebSocket.CLOSED) return
      if (socket.readyState !== WebSocket.OPEN) {
        socket.terminate()
        return
      }

      this.finalizeAcknowledged = false
      await this.sendControlMessage(socket, { type: 'Finalize' })
      await this.waitUntil(() => this.finalizeAcknowledged, FINALIZE_WAIT_MS)
      if (socket.readyState === WebSocket.OPEN) {
        await this.sendControlMessage(socket, { type: 'CloseStream' })
      }
      await this.waitForRemoteClose(socket)
    } finally {
      this.pendingAudio = []
      this.clearBackpressureTimer()
    }
  }

  /** Sends the newest queued frame while bounding both application and socket backlog. */
  private pumpAudio(): void {
    const socket = this.socket
    if (this.sendInFlight || !socket || socket.readyState !== WebSocket.OPEN) return
    if (socket.bufferedAmount > MAX_BUFFERED_AUDIO_BYTES) {
      while (this.pendingAudio.length > 1) this.pendingAudio.shift()
      this.logBackpressure(socket.bufferedAmount)
      if (!this.backpressureTimer) {
        this.backpressureTimer = setTimeout(() => {
          this.backpressureTimer = null
          this.pumpAudio()
        }, 10)
      }
      return
    }
    const frame = this.pendingAudio.shift()
    if (!frame) return
    this.sendInFlight = true
    const complete = (error?: Error): void => {
      this.sendInFlight = false
      if (error && !this.stopping) {
        this.options.onDiagnostic('error', 'Deepgram audio send failed.', error)
        this.options.onError(error.message)
      }
      this.pumpAudio()
    }
    try {
      socket.send(frame, { binary: true }, complete)
    } catch (error) {
      complete(error instanceof Error ? error : new Error('Deepgram audio send failed.'))
    }
  }

  /** Reports bounded queue compaction without flooding the AppData log. */
  private logBackpressure(bufferedBytes: number): void {
    const now = Date.now()
    if (now - this.lastBackpressureLogAt < BACKPRESSURE_LOG_INTERVAL_MS) return
    this.lastBackpressureLogAt = now
    this.options.onDiagnostic('debug', 'Dropped old audio to preserve live latency.', {
      source: this.options.source,
      bufferedBytes,
      queuedFrames: this.pendingAudio.length,
    })
  }

  /** Waits briefly for the bounded application audio queue to reach the socket. */
  private async waitForAudioDrain(): Promise<void> {
    this.pumpAudio()
    await this.waitUntil(
      () => this.pendingAudio.length === 0 && !this.sendInFlight,
      AUDIO_DRAIN_TIMEOUT_MS,
    )
    if (this.pendingAudio.length > 0) {
      this.pendingAudio = this.pendingAudio.slice(-1)
      this.pumpAudio()
      await this.waitUntil(
        () => this.pendingAudio.length === 0 && !this.sendInFlight,
        AUDIO_DRAIN_TIMEOUT_MS,
      )
    }
  }

  /** Sends one JSON control message and resolves when ws accepts it. */
  private async sendControlMessage(
    socket: WebSocket,
    message: Record<string, string>,
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      const complete = (error?: Error): void => {
        if (error) this.options.onDiagnostic('debug', 'Deepgram control send ended early.', error)
        resolve()
      }
      try {
        socket.send(JSON.stringify(message), complete)
      } catch (error) {
        complete(error instanceof Error ? error : new Error('Deepgram control send ended early.'))
      }
    })
  }

  /** Waits for the Deepgram-owned close handshake before using a hard fallback. */
  private async waitForRemoteClose(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.CLOSED) return
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        socket.off('close', finish)
        resolve()
      }
      const timeout = setTimeout(() => {
        if (socket.readyState !== WebSocket.CLOSED) socket.terminate()
        finish()
      }, CLOSE_TIMEOUT_MS)
      socket.once('close', finish)
    })
  }

  /** Polls a short-lived connection condition without extending the stop path indefinitely. */
  private async waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!condition() && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
    }
  }

  /** Detects the server marker that confirms a requested finalization was processed. */
  private isFinalizeAcknowledgement(rawMessage: string): boolean {
    try {
      const message = JSON.parse(rawMessage) as { from_finalize?: unknown }
      return message.from_finalize === true
    } catch {
      return false
    }
  }

  /** Waits for an open event or rejects after a bounded timeout. */
  private async waitUntilOpen(socket: WebSocket): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const rejectOnce = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(error)
      }
      const timeout = setTimeout(() => {
        socket.terminate()
        rejectOnce(new Error('The Deepgram connection timed out.'))
      }, OPEN_TIMEOUT_MS)
      const failBeforeOpen = (error: Error): void => {
        rejectOnce(new Error(`Deepgram could not connect: ${error.message}`))
      }
      socket.once('error', failBeforeOpen)
      socket.once('unexpected-response', (_request, response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          if (body.length < 4_000) body += chunk
        })
        response.on('end', () => {
          const detail = body.trim().replace(/\s+/g, ' ').slice(0, 1_000)
          rejectOnce(
            new Error(
              `Deepgram rejected the stream (${response.statusCode})${detail ? `: ${detail}` : '.'}`,
            ),
          )
        })
      })
      socket.once('open', () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        socket.off('error', failBeforeOpen)
        resolve()
      })
    })
  }

  /** Sends a text KeepAlive frame only during audio inactivity. */
  private sendKeepAliveWhenIdle(): void {
    if (this.socket?.readyState === WebSocket.OPEN && Date.now() - this.lastAudioAt >= 4_000) {
      try {
        this.socket.send(JSON.stringify({ type: 'KeepAlive' }), (error) => {
          if (error && !this.stopping) {
            this.options.onDiagnostic('debug', 'Deepgram KeepAlive ended early.', error)
          }
        })
      } catch (error) {
        if (!this.stopping) {
          this.options.onDiagnostic('debug', 'Deepgram KeepAlive ended early.', error)
        }
      }
    }
  }

  /** Stops the periodic keep-alive timer. */
  private clearKeepAlive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer)
    this.keepAliveTimer = null
  }

  /** Cancels a pending socket-backpressure retry. */
  private clearBackpressureTimer(): void {
    if (this.backpressureTimer) clearTimeout(this.backpressureTimer)
    this.backpressureTimer = null
  }
}
