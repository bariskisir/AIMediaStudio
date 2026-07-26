/**
 * Verifies WAV packaging and request-response OpenRouter live transcription reconciliation.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import OpenRouterService, { createPcm16Wav } from '../src/main/services/OpenRouterService'
import { stripTranscriptOverlap } from '../src/main/services/RestTranscriptionStream'
import type LoggerService from '../src/main/services/LoggerService'
import type { TranscriptResultEvent } from '../src/shared/types'
import {
  DEFAULT_OPENROUTER_TRANSCRIPTION_SETTINGS,
  type OpenRouterTranscriptionSettings,
} from '../src/shared/transcription'

const SAMPLE_RATE = 16_000
const FRAME_SECONDS = 0.1
const FRAME_BYTES = SAMPLE_RATE * 2 * FRAME_SECONDS

describe('createPcm16Wav', () => {
  it('writes a 16 kHz mono PCM16 WAV header', () => {
    const wav = createPcm16Wav(Uint8Array.from([1, 2, 3, 4]))
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(24)).toBe(16_000)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.readUInt32LE(40)).toBe(4)
    expect([...wav.subarray(44)]).toEqual([1, 2, 3, 4])
  })
})

describe('stripTranscriptOverlap', () => {
  it('removes a normalized suffix-prefix overlap without repeating words', () => {
    expect(
      stripTranscriptOverlap(
        'We are testing the rollover.',
        'The rollover continues cleanly.',
        'en',
      ),
    ).toBe('continues cleanly.')
  })

  it('keeps unrelated text unchanged', () => {
    expect(stripTranscriptOverlap('first phrase', 'different continuation', 'en')).toBe(
      'different continuation',
    )
  })
})

describe('OpenRouterService', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('publishes a rolling interim result and replaces it with the final utterance', async () => {
    const fetchMock = mockTranscriptions(['hello world from', 'hello world from app.'])
    const onResult = vi.fn()
    const service = await startService(onResult, { speed: 'high' })

    sendFrames(service, 1.5, true)
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith(makeInterim('hello world from')))
    sendFrames(service, 0.7, false)
    await service.stop()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, request] = fetchMock.mock.calls[0] ?? []
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'openai/whisper-large-v3-turbo',
      input_audio: { format: 'wav' },
    })
    expect(body).not.toHaveProperty('temperature')
    expect(onResult).toHaveBeenLastCalledWith({
      source: 'microphone',
      text: 'hello world from app.',
      isFinal: true,
      speechFinal: true,
      confidence: 1,
    })
  })

  it('does not send all-silence windows to OpenRouter', async () => {
    const fetchMock = mockTranscriptions([])
    const service = await startService(vi.fn())

    sendFrames(service, 3, false)
    await service.stop()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('finalizes a short phrase at a natural pause without waiting for a preview interval', async () => {
    const fetchMock = mockTranscriptions(['short phrase'])
    const onResult = vi.fn()
    const service = await startService(onResult)

    sendFrames(service, 0.6, true)
    sendFrames(service, 2, false)
    await service.stop()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith({
      source: 'microphone',
      text: 'short phrase',
      isFinal: true,
      speechFinal: true,
      confidence: 1,
    })
  })

  it('keeps rolling hypotheses provisional and commits the complete utterance once', async () => {
    mockTranscriptions([
      'hello world from the',
      'hello world from the app',
      'hello world from the app.',
    ])
    const onResult = vi.fn()
    const service = await startService(onResult, { speed: 'high' })

    sendFrames(service, 1.5, true)
    await vi.waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(makeInterim('hello world from the')),
    )
    sendFrames(service, 1.5, true)
    await vi.waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(makeInterim('hello world from the app')),
    )
    expect(
      onResult.mock.calls.filter(
        ([event]) => (event as TranscriptResultEvent | undefined)?.isFinal,
      ),
    ).toHaveLength(0)

    sendFrames(service, 0.7, false)
    await service.stop()

    expect(onResult).toHaveBeenLastCalledWith({
      source: 'microphone',
      text: 'hello world from the app.',
      isFinal: true,
      speechFinal: true,
      confidence: 1,
    })
    expect(
      onResult.mock.calls.filter(
        ([event]) => (event as TranscriptResultEvent | undefined)?.isFinal,
      ),
    ).toHaveLength(1)
  })

  it('coalesces stale previews while one REST request is in flight', async () => {
    let resolveFirst: ((response: Response) => void) | undefined
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => firstResponse)
      .mockImplementation(
        async () => new Response(JSON.stringify({ text: 'latest rolling hypothesis' })),
      )
    vi.stubGlobal('fetch', fetchMock)
    const service = await startService(vi.fn(), { speed: 'high' })

    sendFrames(service, 1.5, true)
    sendFrames(service, 4.5, true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveFirst?.(new Response(JSON.stringify({ text: 'initial hypothesis' })))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    await service.stop()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('publishes a high-speed preview after one and a half seconds of speech', async () => {
    const fetchMock = mockTranscriptions(['fast preview', 'fast final'])
    const onResult = vi.fn()
    const service = await startService(onResult, { speed: 'high' })

    sendFrames(service, 1.5, true)
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith(makeInterim('fast preview')))
    await service.stop()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('waits for a six-second audio window at low speed', async () => {
    const fetchMock = mockTranscriptions(['large preview', 'large final'])
    const service = await startService(vi.fn())

    sendFrames(service, 5.9, true)
    expect(fetchMock).not.toHaveBeenCalled()
    sendFrames(service, 0.1, true)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await service.stop()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

/** Starts a microphone-only OpenRouter service with deterministic settings. */
const startService = async (
  onResult: (event: TranscriptResultEvent) => void,
  overrides: Partial<OpenRouterTranscriptionSettings> = {},
): Promise<OpenRouterService> => {
  const logger = { error: vi.fn() } as unknown as LoggerService
  const service = new OpenRouterService(logger)
  await service.start({
    sources: ['microphone'],
    apiKey: 'sk-or-secret',
    settings: { ...DEFAULT_OPENROUTER_TRANSCRIPTION_SETTINGS, ...overrides },
    onResult,
    onError: vi.fn(),
  })
  return service
}

/** Emits production-sized 100 ms PCM frames classified as speech or silence. */
const sendFrames = (service: OpenRouterService, seconds: number, voiced: boolean): void => {
  const frameCount = Math.round(seconds / FRAME_SECONDS)
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frame = Buffer.alloc(FRAME_BYTES)
    if (voiced) {
      for (let offset = 0; offset < frame.byteLength; offset += 2) {
        frame.writeInt16LE(1_000, offset)
      }
    }
    service.send('microphone', frame)
  }
}

/** Installs one ordered sequence of successful OpenRouter JSON responses. */
const mockTranscriptions = (texts: string[]): ReturnType<typeof vi.fn<typeof fetch>> => {
  const fetchMock = vi.fn<typeof fetch>()
  texts.forEach((text) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ text })))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Creates one renderer-facing provisional result expectation. */
const makeInterim = (text: string) => ({
  source: 'microphone',
  text,
  isFinal: false,
  speechFinal: false,
  confidence: 1,
})
