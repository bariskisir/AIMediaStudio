/**
 * Owns generated output files and resolves assets without leaking absolute paths.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaAsset } from '@shared/types'
import type StorageService from './StorageService'

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
  ): Promise<MediaAsset> {
    if (bytes.byteLength === 0) throw new Error('OpenRouter returned empty speech audio.')
    return this.saveBytes(sessionId, bytes, mediaType, 'speech')
  }

  /** Downloads one completed video URL through authenticated or unsigned transport. */
  public async downloadVideo(
    sessionId: string,
    url: string,
    apiKey: string,
    index: number,
  ): Promise<MediaAsset> {
    const response = await fetch(url, {
      ...(url.startsWith('https://openrouter.ai/')
        ? { headers: { Authorization: `Bearer ${apiKey}` } }
        : {}),
      signal: AbortSignal.timeout(10 * 60 * 1_000),
    })
    if (!response.ok) throw new Error(`Video download failed with HTTP ${response.status}.`)
    const mediaType = response.headers.get('content-type')?.split(';')[0] ?? 'video/mp4'
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
