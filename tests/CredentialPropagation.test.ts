/**
 * Verifies that validated OpenRouter keys seed only credential scopes that remain empty.
 */

import { describe, expect, it, vi } from 'vitest'
import type { MediaKind } from '../src/shared/types'
import {
  type CredentialStore,
  saveApiKeyAndFillEmptyScopes,
} from '../src/main/services/CredentialService'

/** Creates an in-memory credential store that exposes encrypted-store-compatible behavior. */
const createStore = (initialValue: string | null): CredentialStore & { value: string | null } => {
  const store = {
    value: initialValue,
    hasApiKey: vi.fn(async (): Promise<boolean> => Boolean(store.value)),
    saveApiKey: vi.fn(async (apiKey: string): Promise<void> => {
      store.value = apiKey
    }),
  }
  return store
}

/** Creates all four independently mutable credential scopes. */
const createCredentials = (
  values: Partial<Record<MediaKind, string>> = {},
): Record<MediaKind, ReturnType<typeof createStore>> => ({
  image: createStore(values.image ?? null),
  video: createStore(values.video ?? null),
  tts: createStore(values.tts ?? null),
  stt: createStore(values.stt ?? null),
})

describe('saveApiKeyAndFillEmptyScopes', () => {
  it('fills every empty peer when the first key is configured', async () => {
    const credentials = createCredentials()

    const updatedKinds = await saveApiKeyAndFillEmptyScopes(
      credentials,
      'image',
      'first-openrouter-key',
    )

    expect(updatedKinds).toEqual(['image', 'video', 'tts', 'stt'])
    expect(Object.values(credentials).map((store) => store.value)).toEqual([
      'first-openrouter-key',
      'first-openrouter-key',
      'first-openrouter-key',
      'first-openrouter-key',
    ])
  })

  it('changes only the selected scope when every peer already has a key', async () => {
    const credentials = createCredentials({
      image: 'image-key',
      video: 'video-key',
      tts: 'tts-key',
      stt: 'stt-key',
    })

    const updatedKinds = await saveApiKeyAndFillEmptyScopes(credentials, 'video', 'new-video-key')

    expect(updatedKinds).toEqual(['video'])
    expect(credentials.image.value).toBe('image-key')
    expect(credentials.video.value).toBe('new-video-key')
    expect(credentials.tts.value).toBe('tts-key')
    expect(credentials.stt.value).toBe('stt-key')
  })

  it('fills only empty peers while preserving existing independent keys', async () => {
    const credentials = createCredentials({ image: 'image-key', tts: 'tts-key' })

    const updatedKinds = await saveApiKeyAndFillEmptyScopes(credentials, 'image', 'new-image-key')

    expect(updatedKinds).toEqual(['image', 'video', 'stt'])
    expect(credentials.image.value).toBe('new-image-key')
    expect(credentials.video.value).toBe('new-image-key')
    expect(credentials.tts.value).toBe('tts-key')
    expect(credentials.stt.value).toBe('new-image-key')
  })
})
