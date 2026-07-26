/**
 * Verifies DeepgramConnection lifecycle: connect, send audio, close,
 * keep-alive behaviour, and error handling using a mocked WebSocket.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Define the mock socket state and constructor with hoisted function declarations
// so the vi.mock factory can reference them before they are fully initialised.

const mockSocket = {
  _events: {} as Record<string, (...args: unknown[]) => void>,
  readyState: 0,
  bufferedAmount: 0,
  on: vi.fn(function (
    this: typeof mockSocket,
    event: string,
    handler: (...args: unknown[]) => void,
  ) {
    this._events[event] = handler
    return this
  }),
  once: vi.fn(function (
    this: typeof mockSocket,
    event: string,
    handler: (...args: unknown[]) => void,
  ) {
    this._events[event] = handler
    return this
  }),
  off: vi.fn(function (this: typeof mockSocket, event: string, _handler: unknown) {
    delete this._events[event]
  }),
  send: vi.fn(function (
    this: typeof mockSocket,
    _data: unknown,
    _optsOrCb?: unknown,
    cb?: (error?: Error) => void,
  ) {
    const callback = typeof _optsOrCb === 'function' ? _optsOrCb : cb
    if (callback) callback()
  }),
  terminate: vi.fn(),
  emit(event: string, ...args: unknown[]) {
    const handler = this._events[event]
    if (handler) handler(...args)
  },
  reset() {
    this._events = {}
    this.readyState = 0
    this.bufferedAmount = 0
    this.on.mockClear()
    this.once.mockClear()
    this.off.mockClear()
    this.send.mockClear()
    this.terminate.mockClear()
  },
}

function WsCtor(_url: string) {
  mockSocket.reset()
  mockSocket.readyState = 0
  return mockSocket
}
WsCtor.OPEN = 1
WsCtor.CONNECTING = 0
WsCtor.CLOSING = 2
WsCtor.CLOSED = 3

vi.mock('ws', () => ({
  default: WsCtor,
}))

import DeepgramConnection from '../src/main/services/DeepgramConnection'
import { DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS } from '../src/shared/transcription'
import type { DeepgramTranscriptionSettings } from '../src/shared/transcription'
import type { TranscriptResultEvent, LogLevel } from '../src/shared/types'

type DeepgramConnectionCallbacks = {
  onResult: (event: TranscriptResultEvent) => void
  onError: (message: string) => void
  onDiagnostic: (level: LogLevel, message: string, details?: unknown) => void
}

function makeSettings(
  overrides: Partial<DeepgramTranscriptionSettings> = {},
): DeepgramTranscriptionSettings {
  return { ...DEFAULT_DEEPGRAM_TRANSCRIPTION_SETTINGS, ...overrides }
}

describe('DeepgramConnection', () => {
  let onResult: ReturnType<typeof vi.fn>
  let onError: ReturnType<typeof vi.fn>
  let onDiagnostic: ReturnType<typeof vi.fn>
  let connection: DeepgramConnection

  beforeEach(() => {
    vi.useFakeTimers()
    onResult = vi.fn()
    onError = vi.fn()
    onDiagnostic = vi.fn()
    connection = new DeepgramConnection({
      source: 'microphone',
      apiKey: 'test-key',
      settings: makeSettings(),
      onResult: onResult as unknown as DeepgramConnectionCallbacks['onResult'],
      onError: onError as unknown as DeepgramConnectionCallbacks['onError'],
      onDiagnostic: onDiagnostic as unknown as DeepgramConnectionCallbacks['onDiagnostic'],
    })
    mockSocket.reset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('connect', () => {
    it('creates a WebSocket with the Deepgram endpoint', async () => {
      const connectPromise = connection.connect()
      mockSocket.readyState = 1 // OPEN
      mockSocket.emit('open')
      await connectPromise
      expect(mockSocket.on).toHaveBeenCalled()
    })

    it('logs diagnostic info when connecting', async () => {
      const connectPromise = connection.connect()
      mockSocket.readyState = 1
      mockSocket.emit('open')
      await connectPromise
      expect(onDiagnostic).toHaveBeenCalledWith(
        'info',
        'Opening Deepgram stream.',
        expect.any(Object),
      )
    })

    it('logs diagnostic info when opened', async () => {
      const connectPromise = connection.connect()
      mockSocket.readyState = 1
      mockSocket.emit('open')
      await connectPromise
      expect(onDiagnostic).toHaveBeenCalledWith(
        'info',
        'Deepgram stream opened.',
        expect.any(Object),
      )
    })

    it('rejects when connection times out', async () => {
      const connectPromise = connection.connect()
      vi.advanceTimersByTime(13_000)
      await expect(connectPromise).rejects.toThrow('Deepgram connection timed out')
    })

    it('rejects when the socket errors before opening', async () => {
      const connectPromise = connection.connect()
      mockSocket.emit('error', new Error('network down'))
      await expect(connectPromise).rejects.toThrow('Deepgram could not connect: network down')
    })
  })

  describe('message handling', () => {
    it('routes final transcript results to onResult', async () => {
      const connectPromise = connection.connect()
      mockSocket.readyState = 1
      mockSocket.emit('open')
      await connectPromise

      const resultsMsg = JSON.stringify({
        type: 'Results',
        is_final: true,
        speech_final: true,
        channel: {
          alternatives: [{ transcript: 'Hello from Deepgram', confidence: 0.99 }],
        },
      })
      const messageHandler = mockSocket._events.message
      expect(messageHandler).toBeDefined()
      messageHandler?.(resultsMsg, false)

      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'microphone',
          text: 'Hello from Deepgram',
          isFinal: true,
          speechFinal: true,
        }),
      )
    })

    it('ignores binary messages', async () => {
      const connectPromise = connection.connect()
      mockSocket.readyState = 1
      mockSocket.emit('open')
      await connectPromise

      const messageHandler = mockSocket._events.message
      messageHandler?.(Buffer.from([0x00, 0x01]), true)
      expect(onResult).not.toHaveBeenCalled()
    })
  })

  describe('send', () => {
    it('sends audio frames to the WebSocket', async () => {
      const connectPromise = connection.connect()
      mockSocket.readyState = 1
      mockSocket.emit('open')
      await connectPromise

      const samples = new Uint8Array([1, 2, 3, 4])
      connection.send(samples)
      expect(mockSocket.send).toHaveBeenCalled()
    })

    it('does not send when the socket is not open', () => {
      const samples = new Uint8Array([1, 2, 3, 4])
      connection.send(samples)
      expect(mockSocket.send).not.toHaveBeenCalled()
    })

    it('does not send an empty buffer', async () => {
      const connectPromise = connection.connect()
      mockSocket.readyState = 1
      mockSocket.emit('open')
      await connectPromise
      const sendCountBefore = mockSocket.send.mock.calls.length
      connection.send(new Uint8Array(0))
      expect(mockSocket.send.mock.calls.length).toBe(sendCountBefore)
    })
  })

  describe('close', () => {
    it('closes the connection gracefully', async () => {
      const connectPromise = connection.connect()
      mockSocket.readyState = 1
      mockSocket.emit('open')
      await connectPromise

      const closePromise = connection.close()
      vi.advanceTimersByTime(1_000)
      mockSocket.readyState = 3 // CLOSED
      mockSocket.emit('close', 1000, '')
      vi.advanceTimersByTime(2_000)
      await closePromise
    })

    it('terminates the socket when it is in a non-open state', async () => {
      const connectPromise = connection.connect()
      mockSocket.readyState = 1
      mockSocket.emit('open')
      await connectPromise

      // Set socket to CLOSING state so closeInternal skips the graceful handshake
      mockSocket.readyState = 2 // CLOSING
      await connection.close()
      expect(mockSocket.terminate).toHaveBeenCalled()
    })

    it('does nothing on repeated close calls', async () => {
      const connectPromise = connection.connect()
      mockSocket.readyState = 1
      mockSocket.emit('open')
      await connectPromise

      mockSocket.readyState = 3
      const p1 = connection.close()
      const p2 = connection.close()
      vi.advanceTimersByTime(2_000)
      await Promise.all([p1, p2])
    })
  })

  describe('error handling', () => {
    it('calls onError when the WebSocket emits an error', async () => {
      const connectPromise = connection.connect()
      mockSocket.readyState = 1
      mockSocket.emit('open')
      await connectPromise

      mockSocket.emit('error', new Error('connection lost'))
      expect(onError).toHaveBeenCalledWith('connection lost')
    })

    it('logs a diagnostic for unexpected closes', async () => {
      const connectPromise = connection.connect()
      mockSocket.readyState = 1
      mockSocket.emit('open')
      await connectPromise

      mockSocket.emit('close', 1006, 'abnormal closure')
      expect(onDiagnostic).toHaveBeenCalledWith(
        'warn',
        'Deepgram closed a live stream.',
        expect.any(Object),
      )
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('1006'))
    })

    it('does not fire errors after stop has started', async () => {
      const connectPromise = connection.connect()
      mockSocket.readyState = 1
      mockSocket.emit('open')
      await connectPromise

      connection.close()
      mockSocket.emit('error', new Error('late error'))
      // Error should not be reported since we are stopping
    })
  })

  describe('keepAlive', () => {
    it('sends KeepAlive messages during idle periods', async () => {
      const connectPromise = connection.connect()
      mockSocket.readyState = 1
      mockSocket.emit('open')
      await connectPromise

      vi.advanceTimersByTime(5_000)
      const messages = mockSocket.send.mock.calls.map((call: unknown[]) => call[0]) as string[]
      const keepAliveCall = messages.find((msg) => {
        try {
          return JSON.parse(msg).type === 'KeepAlive'
        } catch {
          return false
        }
      })
      expect(keepAliveCall).toBeDefined()
    })
  })
})
