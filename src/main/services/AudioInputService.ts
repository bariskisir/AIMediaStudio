/**
 * Validates local STT audio and converts opaque selections into session-owned inputs.
 */

import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { AUDIO_INPUT_FORMATS, type AudioInputFormat } from '@shared/openrouter'
import type { AudioInputSelection, PersistedAudioInput } from '@shared/types'

const MAX_AUDIO_BYTES = 200 * 1024 * 1024

const AUDIO_MEDIA_TYPES: Record<AudioInputFormat, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  aac: 'audio/aac',
}

interface AudioRecord {
  path: string
  name: string
  mediaType: string
  format: AudioInputFormat
  size: number
}

/** Narrows one extension to the OpenRouter-supported audio format allowlist. */
const parseAudioFormat = (path: string): AudioInputFormat | null => {
  const extension = extname(path).slice(1).toLocaleLowerCase('en-US')
  return AUDIO_INPUT_FORMATS.includes(extension as AudioInputFormat)
    ? (extension as AudioInputFormat)
    : null
}

/** Checks common container signatures so renamed non-audio files cannot enter provider requests. */
const hasAudioSignature = (bytes: Uint8Array, format: AudioInputFormat): boolean => {
  const ascii = (start: number, end: number): string =>
    String.fromCharCode(...bytes.slice(start, end))
  if (format === 'wav') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE'
  if (format === 'flac') return ascii(0, 4) === 'fLaC'
  if (format === 'ogg') return ascii(0, 4) === 'OggS'
  if (format === 'webm') return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf
  if (format === 'm4a') return ascii(4, 8) === 'ftyp'
  if (format === 'aac') return bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xf6) === 0xf0
  return ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
}

/** Describes provider-ready bytes and the durable metadata attached to a session. */
export interface ClaimedAudioInput {
  base64: string
  metadata: PersistedAudioInput
}

export default class AudioInputService {
  private readonly records = new Map<string, AudioRecord>()

  /** Registers one native-dialog path and returns only renderer-safe metadata. */
  public async registerPath(path: string): Promise<AudioInputSelection> {
    const details = await stat(path)
    const format = parseAudioFormat(path)
    if (!details.isFile() || details.size <= 0 || details.size > MAX_AUDIO_BYTES || !format) {
      throw new Error('Select a supported audio file no larger than 200 MB.')
    }
    const bytes = await readFile(path)
    if (!hasAudioSignature(bytes.subarray(0, 16), format)) {
      throw new Error('The selected file does not contain valid supported audio.')
    }
    const token = randomUUID()
    const record: AudioRecord = {
      path,
      name: basename(path),
      mediaType: AUDIO_MEDIA_TYPES[format],
      format,
      size: details.size,
    }
    this.records.set(token, record)
    return { token, name: record.name, mediaType: record.mediaType, format, size: record.size }
  }

  /** Claims one transient selection, copies it into a session, and returns base64 provider input. */
  public async claimToken(token: string, inputDirectory: string): Promise<ClaimedAudioInput> {
    const record = this.records.get(token)
    if (!record) throw new Error('The selected audio file is no longer available.')
    try {
      return await this.copyAndRead(record.path, inputDirectory, {
        originalName: record.name,
        fileName: '',
        mediaType: record.mediaType,
        format: record.format,
        size: record.size,
      })
    } finally {
      this.records.delete(token)
    }
  }

  /** Copies a durable STT input into a new session for immutable regeneration. */
  public async clonePersisted(
    sourcePath: string,
    input: PersistedAudioInput,
    inputDirectory: string,
  ): Promise<ClaimedAudioInput> {
    return this.copyAndRead(sourcePath, inputDirectory, input)
  }

  /** Releases a selection removed before submission. */
  public release(token: string): void {
    this.records.delete(token)
  }

  /** Creates a randomized session filename and reads only the copied durable file. */
  private async copyAndRead(
    sourcePath: string,
    inputDirectory: string,
    input: PersistedAudioInput,
  ): Promise<ClaimedAudioInput> {
    await mkdir(inputDirectory, { recursive: true })
    const fileName = `audio-${randomUUID()}.${input.format}`
    const destination = join(inputDirectory, fileName)
    await copyFile(sourcePath, destination)
    const bytes = await readFile(destination)
    return {
      base64: bytes.toString('base64'),
      metadata: { ...input, fileName, size: bytes.byteLength },
    }
  }
}
