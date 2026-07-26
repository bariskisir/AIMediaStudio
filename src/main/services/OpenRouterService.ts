/**
 * Adapts OpenRouter's speech endpoint to the reusable request-response transcript stream.
 */

import { APP_REPO_URL } from '@shared/appInfo'
import type { OpenRouterTranscriptionSettings } from '@shared/transcription'
import type { AudioSource, TranscriptResultEvent } from '@shared/types'
import { z } from 'zod'
import type LoggerService from './LoggerService'
import RestTranscriptionStream from './RestTranscriptionStream'

interface StartOptions {
  sources: AudioSource[]
  apiKey: string
  settings: OpenRouterTranscriptionSettings
  onResult: (event: TranscriptResultEvent) => void
  onError: (source: AudioSource, message: string) => void
}

const SAMPLE_RATE = 16_000
const BYTES_PER_SAMPLE = 2
const responseSchema = z.object({ text: z.string() })

/** Wraps mono PCM16 samples in a standards-compliant WAV container. */
export const createPcm16Wav = (pcm: Uint8Array): Buffer => {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.byteLength, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28)
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.byteLength, 40)
  return Buffer.concat([header, Buffer.from(pcm)])
}

/** Supplies OpenRouter-specific transport details to the reusable REST transcript engine. */
export default class OpenRouterService {
  private readonly streams = new Map<AudioSource, RestTranscriptionStream>()

  /** Creates the OpenRouter REST adapter with structured logging. */
  public constructor(private readonly logger: LoggerService) {}

  /** Prepares one reusable request-response transcript stream per enabled audio source. */
  public async start(options: StartOptions): Promise<void> {
    if (this.streams.size > 0) throw new Error('Transcription is already running.')
    options.sources.forEach((source) => {
      this.streams.set(
        source,
        new RestTranscriptionStream({
          source,
          language: options.settings.language,
          speed: options.settings.speed,
          transcribe: (pcm) => this.transcribe(pcm, options),
          onResult: options.onResult,
          onError: (error) => {
            const message =
              error instanceof Error ? error.message : 'OpenRouter transcription failed.'
            this.logger.error('OpenRouter', 'An audio snapshot could not be transcribed.', error)
            options.onError(source, message)
          },
        }),
      )
    })
  }

  /** Routes a PCM frame exclusively to its matching source stream. */
  public send(source: AudioSource, samples: Uint8Array): void {
    this.streams.get(source)?.send(samples)
  }

  /** Finalizes provisional text and waits for all current OpenRouter requests. */
  public async stop(): Promise<void> {
    const streams = [...this.streams.values()]
    this.streams.clear()
    await Promise.all(streams.map((stream) => stream.close()))
  }

  /** Sends one WAV snapshot without logging audio or credential contents. */
  private async transcribe(pcm: Uint8Array, options: StartOptions): Promise<string> {
    const wav = createPcm16Wav(pcm)
    const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': APP_REPO_URL,
        'X-OpenRouter-Title': 'Transcript',
      },
      body: JSON.stringify({
        model: options.settings.model,
        input_audio: { data: wav.toString('base64'), format: 'wav' },
        ...(options.settings.language ? { language: options.settings.language } : {}),
      }),
    })
    if (!response.ok) {
      const detail = (await response.text()).trim().slice(0, 500)
      throw new Error(
        `OpenRouter rejected the audio snapshot (${response.status})${detail ? `: ${detail}` : '.'}`,
      )
    }
    return responseSchema.parse(await response.json()).text
  }
}
