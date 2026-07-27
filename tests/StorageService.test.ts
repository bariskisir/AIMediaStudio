/**
 * Verifies one-generation session persistence and the empty-workspace invariant.
 */

import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import StorageService from '../src/main/services/StorageService'
import type { GenerationItem } from '../src/shared/types'

describe('StorageService', () => {
  let root = ''
  let storage: StorageService

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'aimedia-storage-'))
    storage = new StorageService(root)
    await storage.initialize()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('creates and fills exactly one empty session', async () => {
    const session = await storage.createSession()
    const now = new Date().toISOString()
    const item: GenerationItem = {
      id: randomUUID(),
      kind: 'image',
      provider: 'openrouter',
      modelId: 'vendor/image',
      prompt: 'A calm mountain lake',
      status: 'submitting',
      createdAt: now,
      updatedAt: now,
      options: { aspectRatio: '1:1' },
      assets: [],
    }
    const filled = await storage.setGeneration(session.id, item)
    expect(filled.item?.prompt).toBe(item.prompt)
    expect((await storage.listSessions())[0]?.hasItem).toBe(true)
  })

  it('keeps the only empty workspace', async () => {
    const session = await storage.createSession()
    await expect(storage.deleteSession(session.id)).resolves.toEqual({ deleted: false })
  })

  it('creates a replacement when deleting the only terminal generation', async () => {
    const session = await storage.createSession()
    const now = new Date().toISOString()
    const item: GenerationItem = {
      id: randomUUID(),
      kind: 'video',
      provider: 'openrouter',
      modelId: 'vendor/video',
      prompt: 'Ocean waves',
      status: 'completed',
      createdAt: now,
      updatedAt: now,
      options: { duration: 5 },
      assets: [],
    }
    await storage.setGeneration(session.id, item)
    const result = await storage.deleteSession(session.id)
    expect(result.deleted).toBe(true)
    expect(result.replacement?.item).toBeNull()
  })

  it('titles STT history from its input file and previews completed text', async () => {
    const session = await storage.createSession()
    const now = new Date().toISOString()
    const item: GenerationItem = {
      id: randomUUID(),
      kind: 'stt',
      provider: 'openrouter',
      modelId: 'vendor/stt',
      prompt: '',
      status: 'completed',
      createdAt: now,
      updatedAt: now,
      options: { language: 'en', temperature: 0 },
      assets: [],
      inputAudio: {
        originalName: 'meeting.wav',
        fileName: 'audio-id.wav',
        mediaType: 'audio/wav',
        format: 'wav',
        size: 100,
      },
      resultText: 'A durable transcription result.',
    }
    const filled = await storage.setGeneration(session.id, item)
    expect(filled.title).toBe('meeting.wav')
    expect((await storage.listSessions())[0]?.preview).toBe('A durable transcription result.')
  })
})
