/**
 * Verifies generated media persistence and playable audio normalization.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import MediaAssetService from '../src/main/services/MediaAssetService'
import StorageService from '../src/main/services/StorageService'

describe('MediaAssetService', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('wraps raw PCM speech in a playable 24 kHz mono WAV container', async () => {
    root = await mkdtemp(join(tmpdir(), 'aimedia-assets-'))
    const storage = new StorageService(root)
    await storage.initialize()
    const session = await storage.createSession()
    const service = new MediaAssetService(storage)

    const asset = await service.saveAudio(
      session.id,
      new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x02, 0x00]),
      'audio/pcm',
    )

    expect(asset).toMatchObject({ mediaType: 'audio/wav', size: 50 })
    expect(asset.fileName).toMatch(/^speech-.+\.wav$/)
    const bytes = await readFile(storage.resolveAssetPath(session.id, asset.fileName))
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE')
    expect(bytes.readUInt16LE(20)).toBe(1)
    expect(bytes.readUInt16LE(22)).toBe(1)
    expect(bytes.readUInt32LE(24)).toBe(24_000)
    expect(bytes.readUInt16LE(34)).toBe(16)
    expect(bytes.readUInt32LE(40)).toBe(6)
    expect(bytes.subarray(44)).toEqual(Buffer.from([0x00, 0x00, 0x01, 0x00, 0x02, 0x00]))
  })

  it('uses provider-reported PCM sample rate and channel layout', async () => {
    root = await mkdtemp(join(tmpdir(), 'aimedia-assets-'))
    const storage = new StorageService(root)
    await storage.initialize()
    const session = await storage.createSession()
    const service = new MediaAssetService(storage)

    const asset = await service.saveAudio(session.id, new Uint8Array(8), 'audio/pcm', {
      sampleRate: 44_100,
      channels: 2,
      bitsPerSample: 16,
    })

    const bytes = await readFile(storage.resolveAssetPath(session.id, asset.fileName))
    expect(bytes.readUInt16LE(22)).toBe(2)
    expect(bytes.readUInt32LE(24)).toBe(44_100)
    expect(bytes.readUInt32LE(28)).toBe(176_400)
    expect(bytes.readUInt16LE(32)).toBe(4)
    expect(bytes.readUInt32LE(40)).toBe(8)
  })
})
