/**
 * Owns generated output files and resolves assets without leaking absolute paths.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaAsset, PcmAudioFormat } from '@shared/types'
import { httpFetch } from '../http/http.fetch'
import type StorageService from './StorageService'

const PCM_SAMPLE_RATE = 24_000
const PCM_CHANNELS = 1
const PCM_BITS_PER_SAMPLE = 16
const PCM_BIT_DEPTHS = [8, 16, 24, 32]

/** Applies safe WAV defaults when a provider omits or misreports PCM parameters. */
const normalizePcmFormat = (format?: PcmAudioFormat): PcmAudioFormat => ({
  sampleRate:
    format?.sampleRate && Number.isInteger(format.sampleRate) && format.sampleRate > 0
      ? format.sampleRate
      : PCM_SAMPLE_RATE,
  channels:
    format?.channels &&
    Number.isInteger(format.channels) &&
    format.channels > 0 &&
    format.channels <= 8
      ? format.channels
      : PCM_CHANNELS,
  bitsPerSample:
    format?.bitsPerSample && PCM_BIT_DEPTHS.includes(format.bitsPerSample)
      ? format.bitsPerSample
      : PCM_BITS_PER_SAMPLE,
})

/** Wraps raw PCM in a playable RIFF/WAVE container using the provider's sample layout. */
const wrapPcmAsWav = (bytes: Uint8Array, format?: PcmAudioFormat): Uint8Array => {
  const { sampleRate, channels, bitsPerSample } = normalizePcmFormat(format)
  const blockAlign = channels * (bitsPerSample / 8)
  const dataLength = bytes.byteLength - (bytes.byteLength % blockAlign)
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)
  const writeText = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeText(36, 'data')
  view.setUint32(40, dataLength, true)
  new Uint8Array(buffer).set(bytes.subarray(0, dataLength), 44)
  return new Uint8Array(buffer)
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/mpeg': '.mpeg',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/pcm': '.pcm',
  'audio/wav': '.wav',
}

export default class MediaAssetService {
  /** Creates a media writer backed by validated session storage paths. */
  public constructor(private readonly storage: StorageService) {}

  /** Saves one base64 image result and returns renderer-safe asset metadata. */
  public async saveBase64(
    sessionId: string,
    base64: string,
    mediaType: string,
    index: number,
  ): Promise<MediaAsset> {
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.byteLength === 0) throw new Error('OpenRouter returned an empty image.')
    return this.saveBytes(sessionId, bytes, mediaType, `image-${index + 1}`)
  }

  /** Saves one generated speech payload with a stable randomized filename. */
  public async saveAudio(
    sessionId: string,
    bytes: Uint8Array,
    mediaType: string,
    pcm?: PcmAudioFormat,
  ): Promise<MediaAsset> {
    if (bytes.byteLength === 0) throw new Error('OpenRouter returned empty speech audio.')
    if (mediaType.toLocaleLowerCase('en-US') === 'audio/pcm') {
      return this.saveBytes(sessionId, wrapPcmAsWav(bytes, pcm), 'audio/wav', 'speech')
    }
    return this.saveBytes(sessionId, bytes, mediaType, 'speech')
  }

  /** Downloads one completed video URL through authenticated or unsigned transport. */
  public async downloadVideo(
    sessionId: string,
    url: string,
    apiKey: string,
    index: number,
  ): Promise<MediaAsset> {
    const response = await httpFetch(url, {
      ...(url.startsWith('https://openrouter.ai/')
        ? { headers: { Authorization: `Bearer ${apiKey}` } }
        : {}),
      signal: AbortSignal.timeout(10 * 60 * 1_000),
    })
    if (!response.ok) throw new Error(`Video download failed with HTTP ${response.status}.`)
    const declaredMediaType = response.headers.get('content-type')?.split(';')[0]?.trim()
    const mediaType =
      declaredMediaType?.toLocaleLowerCase('en-US').startsWith('video/') === true
        ? declaredMediaType
        : 'video/mp4'
    return this.saveBytes(
      sessionId,
      Buffer.from(await response.arrayBuffer()),
      mediaType,
      `video-${index + 1}`,
    )
  }

  /** Resolves an asset path only when it belongs to the requested session document. */
  public async resolveAsset(sessionId: string, assetId: string): Promise<string> {
    const session = await this.storage.getSession(sessionId)
    const asset = session.item?.assets.find((candidate) => candidate.id === assetId)
    if (!asset) throw new Error('Media asset was not found.')
    return this.storage.resolveAssetPath(sessionId, asset.fileName)
  }

  /** Writes one generated payload to the private output directory. */
  private async saveBytes(
    sessionId: string,
    bytes: Uint8Array,
    mediaType: string,
    stem: string,
  ): Promise<MediaAsset> {
    const outputDirectory = this.storage.getSessionOutputPath(sessionId)
    await mkdir(outputDirectory, { recursive: true })
    const id = randomUUID()
    const extension = MIME_EXTENSIONS[mediaType] ?? '.bin'
    const fileName = `${stem}-${id}${extension}`
    const filePath = join(outputDirectory, fileName)
    await writeFile(filePath, bytes)
    const details = await stat(filePath)
    return {
      id,
      fileName,
      mediaType,
      size: details.size,
      url: this.storage.createAssetUrl(sessionId, id),
    }
  }
}
