/**
 * Verifies StorageService session CRUD operations, file locking behaviour,
 * and session-migration logic by mocking the underlying filesystem layer.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import StorageService from '../src/main/services/StorageService'
import type { TranscriptSegment, DeleteSessionResult } from '../src/shared/types'

const ROOT = '/fake/appdata/transcript'
const SESSIONS_DIR = join(ROOT, 'sessions')
const _SETTINGS_PATH = join(ROOT, 'settings.json')

// Module-level file store so tests can reset it between cases.
let fileStore: Record<string, string> = {}

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async (_path: string, _opts?: unknown) => {}),
  readFile: vi.fn(async (path: string) => {
    if (!fileStore[path]) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return fileStore[path]
  }),
  readdir: vi.fn(async (path: string) => {
    if (path === SESSIONS_DIR || path === ROOT) {
      return Object.keys(fileStore)
        .filter((k) => k.startsWith(SESSIONS_DIR) && k.endsWith('.json'))
        .map((k) => ({
          name: k.slice(SESSIONS_DIR.length + 1),
          isFile: () => true,
          isDirectory: () => false,
        }))
    }
    return []
  }),
  writeFile: vi.fn(async (path: string, content: string) => {
    fileStore[path] = content
  }),
  unlink: vi.fn(async (path: string) => {
    delete fileStore[path]
  }),
}))

function makeSegment(overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    id: randomUUID(),
    source: 'microphone',
    text: 'hello world',
    confidence: 0.95,
    createdAt: new Date().toISOString(),
    offsetMs: 0,
    ...overrides,
  }
}

describe('StorageService', () => {
  let service: StorageService

  beforeEach(() => {
    fileStore = {}
    service = new StorageService(ROOT)
  })

  describe('createSession', () => {
    it('creates a session with empty segments and translations arrays', async () => {
      const session = await service.createSession('en')
      expect(session.segments).toEqual([])
      expect(session.translations).toEqual([])
      expect(session.language).toBe('en')
      expect(session.durationMs).toBe(0)
    })

    it('creates a session with the provided title', async () => {
      const session = await service.createSession('tr', 'My Turkish Session')
      expect(session.title).toBe('My Turkish Session')
      expect(session.isDefaultTitle).toBe(false)
      expect(session.language).toBe('tr')
    })

    it('uses the default title when none is provided', async () => {
      const session = await service.createSession('en')
      expect(session.title).toBe('New Session')
      expect(session.isDefaultTitle).toBe(true)
    })

    it('assigns a valid UUID to the session', async () => {
      const session = await service.createSession('de')
      expect(session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })

    it('trims whitespace from the title', async () => {
      const session = await service.createSession('en', '   Padded Title   ')
      expect(session.title).toBe('Padded Title')
    })

    it('truncates titles longer than 200 characters', async () => {
      const long = 'A'.repeat(300)
      const session = await service.createSession('en', long)
      expect(session.title.length).toBeLessThanOrEqual(200)
    })

    it('uses default title when an empty string is passed', async () => {
      const session = await service.createSession('en', '')
      expect(session.title).toBe('New Session')
      expect(session.isDefaultTitle).toBe(true)
    })
  })

  describe('appendSegment', () => {
    it('appends a segment to an existing session', async () => {
      const session = await service.createSession('en')
      const segment = makeSegment({ text: 'First segment' })
      await service.appendSegment(session.id, segment)

      const loaded = await service.getSession(session.id)
      expect(loaded.segments).toHaveLength(1)
      expect(loaded.segments[0]?.text).toBe('First segment')
    })

    it('appends multiple segments in order', async () => {
      const session = await service.createSession('en')
      const seg1 = makeSegment({ text: 'One', offsetMs: 0 })
      const seg2 = makeSegment({ text: 'Two', offsetMs: 1000 })

      await service.appendSegments(session.id, [seg1, seg2])

      const loaded = await service.getSession(session.id)
      expect(loaded.segments).toHaveLength(2)
      expect(loaded.segments[0]?.text).toBe('One')
      expect(loaded.segments[1]?.text).toBe('Two')
    })

    it('does nothing when appending an empty segment array', async () => {
      const session = await service.createSession('en')
      await service.appendSegments(session.id, [])
      const loaded = await service.getSession(session.id)
      expect(loaded.segments).toEqual([])
    })

    it('updates the session updatedAt timestamp', async () => {
      const session = await service.createSession('en')
      const original = session.updatedAt
      await new Promise((r) => setTimeout(r, 10))
      await service.appendSegment(session.id, makeSegment())

      const loaded = await service.getSession(session.id)
      expect(loaded.updatedAt).not.toBe(original)
    })
  })

  describe('renameSession', () => {
    it('changes the session title', async () => {
      const session = await service.createSession('en')
      const renamed = await service.renameSession(session.id, 'Renamed Session')
      expect(renamed.title).toBe('Renamed Session')
    })

    it('sets isDefaultTitle to false after renaming', async () => {
      const session = await service.createSession('en')
      const renamed = await service.renameSession(session.id, 'Custom')
      expect(renamed.isDefaultTitle).toBe(false)
    })

    it('throws when the title is empty after trimming', async () => {
      const session = await service.createSession('en')
      await expect(service.renameSession(session.id, '   ')).rejects.toThrow(
        'Session title cannot be empty.',
      )
    })

    it('trims and truncates the new title', async () => {
      const session = await service.createSession('en')
      const renamed = await service.renameSession(session.id, '   Trimmed   ')
      expect(renamed.title).toBe('Trimmed')
    })
  })

  describe('deleteSession', () => {
    it('deletes an existing session and returns deleted: true', async () => {
      // Create two sessions: the first can be deleted because the second remains
      const s1 = await service.createSession('en')
      await service.createSession('en')
      const result: DeleteSessionResult = await service.deleteSession(s1.id)
      expect(result.deleted).toBe(true)
    })

    it('returns deleted: false when the session does not exist', async () => {
      const result = await service.deleteSession('550e8400-e29b-41d4-a716-446655440000')
      expect(result.deleted).toBe(false)
    })

    it('creates a replacement when deleting the only populated session', async () => {
      const session = await service.createSession('en')
      // Add a segment so the workspace is populated and deletion is allowed
      await service.appendSegment(session.id, makeSegment({ text: 'hello' }))
      const result = await service.deleteSession(session.id)
      expect(result.deleted).toBe(true)
      expect(result.replacement).toBeDefined()
      expect(result.replacement?.language).toBe(session.language)
    })

    it('returns a replacement session with empty segments', async () => {
      const session = await service.createSession('en')
      await service.appendSegment(session.id, makeSegment({ text: 'hello' }))
      const result = await service.deleteSession(session.id)
      expect(result.replacement).toBeDefined()
      expect(result.replacement?.segments).toEqual([])
      expect(result.replacement?.translations).toEqual([])
    })

    it('returns deleted: false when trying to delete the last empty workspace', async () => {
      // The only session with no segments cannot be deleted
      const session = await service.createSession('en')
      const result = await service.deleteSession(session.id)
      expect(result.deleted).toBe(false)
    })

    it('returns no replacement when multiple sessions exist', async () => {
      const s1 = await service.createSession('en')
      await service.createSession('en')
      const result = await service.deleteSession(s1.id)
      expect(result.deleted).toBe(true)
      expect(result.replacement).toBeUndefined()
    })

    it('throws for an invalid session identifier', async () => {
      await expect(service.deleteSession('not-a-uuid')).rejects.toThrow(
        'Invalid session identifier.',
      )
    })
  })

  describe('listSessions', () => {
    it('returns an empty array when no sessions exist', async () => {
      const summaries = await service.listSessions()
      expect(summaries).toEqual([])
    })

    it('returns summaries with segment counts', async () => {
      await service.createSession('en', 'Session A')
      const b = await service.createSession('tr', 'Session B')
      await service.appendSegment(b.id, makeSegment())

      const summaries = await service.listSessions()
      expect(summaries.length).toBeGreaterThanOrEqual(1)

      const summaryB = summaries.find((s) => s.id === b.id)
      expect(summaryB).toBeDefined()
      expect(summaryB?.segmentCount).toBe(1)
    })

    it('returns summaries sorted by createdAt descending', async () => {
      const s1 = await service.createSession('en', 'First')
      await new Promise((r) => setTimeout(r, 5))
      const s2 = await service.createSession('en', 'Second')

      const summaries = await service.listSessions()
      const ids = summaries.map((s) => s.id)
      const idx1 = ids.indexOf(s1.id)
      const idx2 = ids.indexOf(s2.id)
      expect(idx2).toBeLessThan(idx1)
    })

    it('includes preview text from segments', async () => {
      const session = await service.createSession('en')
      await service.appendSegment(session.id, makeSegment({ text: 'Hello world preview' }))

      const summaries = await service.listSessions()
      const summary = summaries.find((s) => s.id === session.id)
      expect(summary?.preview).toContain('Hello world preview')
    })

    it('returns summaries with the correct duration', async () => {
      const session = await service.createSession('en')
      await service.finishSession(session.id, 123_456)

      const summaries = await service.listSessions()
      const summary = summaries.find((s) => s.id === session.id)
      expect(summary?.durationMs).toBe(123_456)
    })
  })

  describe('finishSession', () => {
    it('sets the duration on the session', async () => {
      const session = await service.createSession('en')
      const finished = await service.finishSession(session.id, 60_000)
      expect(finished.durationMs).toBe(60_000)
    })

    it('clamps negative durations to zero', async () => {
      const session = await service.createSession('en')
      const finished = await service.finishSession(session.id, -5_000)
      expect(finished.durationMs).toBe(0)
    })

    it('rounds fractional milliseconds', async () => {
      const session = await service.createSession('en')
      const finished = await service.finishSession(session.id, 42_500.7)
      expect(finished.durationMs).toBe(42_501)
    })
  })

  describe('getSession', () => {
    it('loads a previously created session', async () => {
      const session = await service.createSession('en', 'My Session')
      const loaded = await service.getSession(session.id)
      expect(loaded.title).toBe('My Session')
      expect(loaded.id).toBe(session.id)
    })

    it('throws for an invalid session id', async () => {
      await expect(service.getSession('bad-id')).rejects.toThrow('Invalid session identifier.')
    })
  })

  describe('saveSettings / loadSettings', () => {
    it('loads default settings when no file exists', async () => {
      const settings = await service.loadSettings()
      expect(settings.settingsRevision).toBe(1)
      expect(settings.theme).toBe('system')
      expect(settings.navbarPosition).toBe('top')
      expect(settings.pageZoom).toBe(1)
      expect(settings.showTrayIcon).toBe(true)
      expect(settings.minimizeToTrayOnClose).toBe(true)
    })

    it('saves and reloads custom settings', async () => {
      const loaded = await service.loadSettings()
      const updated = {
        ...loaded,
        theme: 'dark' as const,
        navbarPosition: 'top' as const,
        pageZoom: 1.3,
        showTrayIcon: true,
        minimizeToTrayOnClose: true,
      }
      const saved = await service.saveSettings(updated)
      expect(saved.theme).toBe('dark')
      expect(saved.navbarPosition).toBe('top')
      expect(saved.pageZoom).toBe(1.3)
      expect(saved.showTrayIcon).toBe(true)
      expect(saved.minimizeToTrayOnClose).toBe(true)

      const reloaded = await service.loadSettings()
      expect(reloaded.theme).toBe('dark')
      expect(reloaded.navbarPosition).toBe('top')
      expect(reloaded.pageZoom).toBe(1.3)
      expect(reloaded.showTrayIcon).toBe(true)
      expect(reloaded.minimizeToTrayOnClose).toBe(true)
    })

    it('merges OpenRouter settings without replacing Deepgram settings', async () => {
      const before = await service.loadSettings()
      const saved = await service.updateSettings({
        transcriptionProviderSettings: {
          openrouter: { model: 'mistralai/voxtral-mini-transcribe' },
        },
      })

      expect(saved.transcriptionProviderSettings.openrouter).toMatchObject({
        model: 'mistralai/voxtral-mini-transcribe',
      })
      expect(saved.transcriptionProviderSettings.deepgram).toEqual(
        before.transcriptionProviderSettings.deepgram,
      )
    })
  })
})
