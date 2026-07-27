/**
 * Verifies generation hydration and background session updates in Redux state.
 */

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import reducer, { hydrate, receiveSessionUpdated } from '../src/renderer/src/store/appSlice'
import { DEFAULT_SETTINGS, type BootstrapPayload, type SessionDocument } from '../src/shared/types'
import { toSessionSummary } from '../src/renderer/src/utils/formatters'

describe('appSlice', () => {
  it('hydrates all media catalogs with separate credential flags', () => {
    const session: SessionDocument = {
      id: randomUUID(),
      title: 'New Generation',
      isDefaultTitle: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      item: null,
    }
    const payload: BootstrapPayload = {
      settings: DEFAULT_SETTINGS,
      sessions: [toSessionSummary(session)],
      currentSession: session,
      hasApiKeys: { image: true, video: false, tts: false, stt: false },
      models: { image: [], video: [], tts: [], stt: [] },
      platform: 'win32',
      version: '1.0.0',
    }
    const state = reducer(undefined, hydrate(payload))
    expect(state.hasApiKeys).toEqual({ image: true, video: false, tts: false, stt: false })
    expect(state.currentSession?.id).toBe(session.id)
  })

  it('applies a background update to the selected session', () => {
    const now = new Date().toISOString()
    const session: SessionDocument = {
      id: randomUUID(),
      title: 'Result',
      isDefaultTitle: false,
      createdAt: now,
      updatedAt: now,
      item: {
        id: randomUUID(),
        kind: 'image',
        provider: 'openrouter',
        modelId: 'model',
        prompt: 'Prompt',
        status: 'completed',
        createdAt: now,
        updatedAt: now,
        options: {},
        assets: [],
      },
    }
    let state = reducer(undefined, { type: 'noop' })
    state = reducer(state, receiveSessionUpdated({ session, summary: toSessionSummary(session) }))
    expect(state.sessions[0]?.status).toBe('completed')
  })
})
