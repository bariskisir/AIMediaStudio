/**
 * Verifies path-safe STT audio staging, validation, and durable session copying.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import AudioInputService from '../src/main/services/AudioInputService'

describe('AudioInputService', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('returns an opaque token and copies valid WAV audio into session storage', async () => {
    root = await mkdtemp(join(tmpdir(), 'aimedia-audio-input-'))
    const path = join(root, 'meeting.wav')
    const bytes = Buffer.from('524946462400000057415645666d7420', 'hex')
    await writeFile(path, bytes)
    const service = new AudioInputService()
    const selection = await service.registerPath(path)
    expect(selection).toMatchObject({ name: 'meeting.wav', format: 'wav', mediaType: 'audio/wav' })
    expect(selection).not.toHaveProperty('path')

    const claimed = await service.claimToken(selection.token, join(root, 'session-inputs'))
    expect(Buffer.from(claimed.base64, 'base64')).toEqual(bytes)
    expect(await readFile(join(root, 'session-inputs', claimed.metadata.fileName))).toEqual(bytes)
    await expect(service.claimToken(selection.token, join(root, 'again'))).rejects.toThrow(
      'no longer available',
    )
  })

  it('rejects an extension-matched file without an audio signature', async () => {
    root = await mkdtemp(join(tmpdir(), 'aimedia-invalid-audio-'))
    const path = join(root, 'not-audio.mp3')
    await writeFile(path, 'plain text')
    await expect(new AudioInputService().registerPath(path)).rejects.toThrow(
      'does not contain valid supported audio',
    )
  })
})
