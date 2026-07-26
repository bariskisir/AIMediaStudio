/**
 * Verifies that rapid settings writes are serialised without overwriting in-flight updates.
 */

import { describe, expect, it, vi } from 'vitest'
import SettingsPersistenceQueue from '../src/renderer/src/services/SettingsPersistenceQueue'
import { DEFAULT_SETTINGS, type AppSettings, type AppSettingsPatch } from '../src/shared/types'

describe('SettingsPersistenceQueue', () => {
  it('serialises two concurrent patches so the second sees the first result', async () => {
    const queue = new SettingsPersistenceQueue()
    let durable = { ...DEFAULT_SETTINGS }
    const persisted: AppSettings[] = []

    const persist = vi.fn(async (patch: AppSettingsPatch): Promise<AppSettings> => {
      durable = { ...durable, ...patch } as AppSettings
      persisted.push(durable)
      return durable
    })

    await Promise.all([
      queue.enqueue({ theme: 'light' }, persist),
      queue.enqueue({ logLevel: 'debug' }, persist),
    ])

    expect(persisted).toHaveLength(2)
    expect(persisted[1]).toMatchObject({ theme: 'light', logLevel: 'debug' })
  })

  it('recovers after a preceding write fails', async () => {
    const queue = new SettingsPersistenceQueue()
    const failing = vi.fn(async (): Promise<AppSettings> => {
      throw new Error('disk full')
    })

    await expect(queue.enqueue({ theme: 'light' }, failing)).rejects.toThrow('disk full')

    const result = await queue.enqueue(
      { logLevel: 'debug' },
      async (patch) => ({ ...DEFAULT_SETTINGS, ...patch }) as AppSettings,
    )

    expect(result).toMatchObject({ logLevel: 'debug' })
  })
})
