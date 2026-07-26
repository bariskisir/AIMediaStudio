/**
 * Serializes partial settings writes and carries successful state across concurrent callers.
 */

import type { AppSettings, AppSettingsPatch } from '@shared/types'

type PersistSettings = (patch: AppSettingsPatch) => Promise<AppSettings>

export default class SettingsPersistenceQueue {
  private tail: Promise<AppSettings | null> = Promise.resolve(null)

  /** Persists one patch after every earlier request so main-process merges retain user ordering. */
  public enqueue(patch: AppSettingsPatch, persist: PersistSettings): Promise<AppSettings> {
    const operation = this.tail.then(() => persist(patch))
    this.tail = operation.catch(() => null)
    return operation
  }
}
