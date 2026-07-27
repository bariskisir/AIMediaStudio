/**
 * Validates local reference images and exposes only short-lived opaque tokens to the renderer.
 */

import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { GenerationReference, MediaKind, ReferenceImage } from '@shared/types'

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_BYTES = 50 * 1024 * 1024

interface ReferenceRecord {
  path: string
  name: string
  mediaType: string
  size: number
}

/** Detects supported image content by magic bytes instead of trusting file extensions. */
const detectImageType = (bytes: Uint8Array): string | null => {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 3)) === 'GIF') {
    return 'image/gif'
  }
  return null
}

export default class ReferenceImageService {
  private readonly records = new Map<string, ReferenceRecord>()

  /** Registers validated native-dialog selections without returning their paths. */
  public async registerPaths(paths: string[], _kind: MediaKind): Promise<ReferenceImage[]> {
    let totalBytes = 0
    const references: ReferenceImage[] = []
    for (const path of paths) {
      const fileStat = await stat(path)
      if (!fileStat.isFile() || fileStat.size > MAX_REFERENCE_BYTES) {
        throw new Error('Each reference image must be a file no larger than 20 MB.')
      }
      totalBytes += fileStat.size
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error('Selected reference images cannot exceed 50 MB in total.')
      }
      const bytes = await readFile(path)
      const mediaType = detectImageType(bytes)
      if (!mediaType) throw new Error('Only PNG, JPEG, WebP, and GIF references are supported.')
      const token = randomUUID()
      const name = basename(path)
      this.records.set(token, { path, name, mediaType, size: fileStat.size })
      references.push({
        token,
        name,
        mediaType,
        previewUrl: `aimedia://reference/${token}`,
      })
    }
    return references
  }

  /** Returns a validated path solely for the custom protocol handler. */
  public resolvePreviewPath(token: string): string | null {
    return this.records.get(token)?.path ?? null
  }

  /** Copies references into their session and creates provider-ready data URLs. */
  public async claim(
    references: GenerationReference[],
    inputDirectory: string,
  ): Promise<Array<{ role: GenerationReference['role']; dataUrl: string }>> {
    await mkdir(inputDirectory, { recursive: true })
    const claimed = []
    for (const reference of references) {
      const record = this.records.get(reference.token)
      if (!record) throw new Error('A selected reference image is no longer available.')
      const extension = extname(record.name).slice(0, 10) || '.img'
      const destination = join(inputDirectory, `${randomUUID()}${extension}`)
      await copyFile(record.path, destination)
      const bytes = await readFile(destination)
      claimed.push({
        role: reference.role,
        dataUrl: `data:${record.mediaType};base64,${bytes.toString('base64')}`,
      })
      this.records.delete(reference.token)
    }
    return claimed
  }

  /** Releases selections that were removed before a generation was submitted. */
  public release(tokens: string[]): void {
    for (const token of tokens) this.records.delete(token)
  }
}
