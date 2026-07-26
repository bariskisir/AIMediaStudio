/**
 * Verifies Redux appSlice state transitions for hydration, page navigation,
 * settings, session management, transcript/translation results, and UI toggles.
 */

import { describe, expect, it } from 'vitest'
import reducer, {
  hydrate,
  setPage,
  setSettings,
  setSettingsSection,
  setHasApiKey,
  setApiBalance,
  setSessions,
  addSessionSummary,
  replaceSessionSummary,
  removeSessionSummary,
  setCurrentSession,
  replaceCurrentSession,
  setSessionState,
  receiveTranscriptResult,
  receiveTranslationResult,
  setAudioLevel,
  setUpdateState,
  setSessionsSidebarOpen,
  setCompactMode,
} from '../src/renderer/src/store/appSlice'
import type {
  AppSettings,
  BootstrapPayload,
  SessionDocument,
  SessionSummary,
  TranscriptResultEvent,
  TranslationResultEvent,
  ApiBalance,
  UpdateStateEvent,
  TranscriptSegment,
  SessionStateEvent,
} from '../src/shared/types'
import type { AppState } from '../src/renderer/src/store/appSlice'
import { DEFAULT_SETTINGS } from '../src/shared/types'
import { randomUUID } from 'node:crypto'

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...structuredClone(DEFAULT_SETTINGS), ...overrides }
}

function makeBootstrapPayload(overrides: Partial<BootstrapPayload> = {}): BootstrapPayload {
  const now = new Date().toISOString()
  return {
    settings: makeSettings(),
    sessions: [],
    currentSession: {
      id: randomUUID(),
      title: 'Current',
      isDefaultTitle: true,
      language: 'en',
      createdAt: now,
      updatedAt: now,
      durationMs: 0,
      segments: [],
      translations: [],
    },
    hasApiKeys: { deepgram: false, openrouter: false },
    deepgramModels: [],
    openRouterModels: [],
    platform: 'win32',
    version: '1.0.0',
    ...overrides,
  }
}

function makeSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    title: 'Test Session',
    isDefaultTitle: false,
    language: 'en',
    createdAt: now,
    updatedAt: now,
    durationMs: 0,
    segmentCount: 0,
    preview: '',
    ...overrides,
  }
}

function makeSessionDocument(overrides: Partial<SessionDocument> = {}): SessionDocument {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    title: 'Test Doc',
    isDefaultTitle: false,
    language: 'en',
    createdAt: now,
    updatedAt: now,
    durationMs: 0,
    segments: [],
    translations: [],
    ...overrides,
  }
}

function makeTranscriptResult(
  overrides: Partial<TranscriptResultEvent> = {},
): TranscriptResultEvent {
  return {
    source: 'microphone',
    text: 'test text',
    isFinal: true,
    speechFinal: true,
    confidence: 0.9,
    ...overrides,
  }
}

function makeTranslationResult(
  overrides: Partial<TranslationResultEvent> = {},
): TranslationResultEvent {
  return {
    transcriptId: 'session-id',
    translation: {
      id: randomUUID(),
      provider: 'google',
      sourceText: 'hello',
      text: 'merhaba',
      sourceLanguage: 'en',
      targetLanguage: 'tr',
      sourceSegmentIds: [randomUUID()],
      sourceStartIndex: 0,
      sourceEndIndex: 1,
      createdAt: new Date().toISOString(),
    },
    ...overrides,
  }
}

describe('appSlice', () => {
  describe('initial state', () => {
    it('starts uninitialized', () => {
      const state = reducer(undefined, { type: '@@INIT' })
      expect(state.initialized).toBe(false)
    })

    it('has home as the default page', () => {
      const state = reducer(undefined, { type: '@@INIT' })
      expect(state.page).toBe('home')
    })

    it('has default settings', () => {
      const state = reducer(undefined, { type: '@@INIT' })
      expect(state.settings).toEqual(DEFAULT_SETTINGS)
    })

    it('starts with empty interim text', () => {
      const state = reducer(undefined, { type: '@@INIT' })
      expect(state.interim).toEqual({ microphone: '', speaker: '' })
    })
  })

  describe('hydrate', () => {
    it('sets initialized to true', () => {
      const payload = makeBootstrapPayload()
      const state = reducer(undefined, hydrate(payload))
      expect(state.initialized).toBe(true)
    })

    it('is idempotent when already initialized', () => {
      const payload = makeBootstrapPayload()
      const state1 = reducer(undefined, hydrate(payload))
      const payload2 = makeBootstrapPayload({ version: '2.0.0' })
      const state2 = reducer(state1, hydrate(payload2))
      expect(state2.version).toBe('1.0.0')
    })

    it('hydrates settings and platform', () => {
      const payload = makeBootstrapPayload({
        settings: makeSettings({ theme: 'dark' }),
        platform: 'darwin',
      })
      const state = reducer(undefined, hydrate(payload))
      expect(state.settings.theme).toBe('dark')
      expect(state.platform).toBe('darwin')
    })

    it('hydrates sessions and current session', () => {
      const doc = makeSessionDocument({ title: 'Active' })
      const payload = makeBootstrapPayload({ currentSession: doc })
      const state = reducer(undefined, hydrate(payload))
      expect(state.currentSession?.title).toBe('Active')
    })

    it('hydrates provider API key state and version', () => {
      const payload = makeBootstrapPayload({
        hasApiKeys: { deepgram: true, openrouter: false },
        version: '3.0.0',
      })
      const state = reducer(undefined, hydrate(payload))
      expect(state.hasApiKeys.deepgram).toBe(true)
      expect(state.version).toBe('3.0.0')
    })
  })

  describe('setPage', () => {
    it('changes the current page', () => {
      const state = reducer(undefined, setPage('settings'))
      expect(state.page).toBe('settings')
    })

    it('disables compact mode when navigating away from home', () => {
      const state = reducer(
        { compactMode: true } as Partial<AppState> as AppState,
        setPage('settings'),
      )
      expect(state.compactMode).toBe(false)
    })

    it('keeps compact mode when navigating to home', () => {
      const baseState = reducer(undefined, setCompactMode(true))
      const state = reducer(baseState, setPage('home'))
      expect(state.compactMode).toBe(true)
    })
  })

  describe('setSettingsSection', () => {
    it('sets the active settings category', () => {
      const state = reducer(undefined, setSettingsSection('display'))
      expect(state.settingsSection).toBe('display')
    })
  })

  describe('setSettings', () => {
    it('replaces the entire settings object', () => {
      const newSettings = makeSettings({ theme: 'light' })
      const state = reducer(undefined, setSettings(newSettings))
      expect(state.settings.theme).toBe('light')
    })
  })

  describe('setHasApiKey', () => {
    it('updates the API key availability flag', () => {
      const state = reducer(undefined, setHasApiKey({ provider: 'openrouter', available: true }))
      expect(state.hasApiKeys.openrouter).toBe(true)
    })
  })

  describe('setApiBalance', () => {
    it('replaces the balance array', () => {
      const balance: ApiBalance[] = [{ amount: 50, units: 'USD' }]
      const state = reducer(undefined, setApiBalance({ provider: 'openrouter', balance }))
      expect(state.apiBalances.openrouter).toEqual(balance)
    })
  })

  describe('session list management', () => {
    it('setSessions replaces the entire session list', () => {
      const summaries = [makeSessionSummary(), makeSessionSummary()]
      const state = reducer(undefined, setSessions(summaries))
      expect(state.sessions).toHaveLength(2)
    })

    it('addSessionSummary prepends a new summary', () => {
      const existing = makeSessionSummary({ id: 'existing-id' })
      const baseState = reducer(undefined, setSessions([existing]))
      const newSummary = makeSessionSummary({ id: 'new-id' })
      const state = reducer(baseState, addSessionSummary(newSummary))
      expect(state.sessions).toHaveLength(2)
      expect(state.sessions[0]?.id).toBe('new-id')
    })

    it('addSessionSummary deduplicates by id', () => {
      const existing = makeSessionSummary({ id: 'same-id', title: 'Old' })
      const baseState = reducer(undefined, setSessions([existing]))
      const updated = makeSessionSummary({ id: 'same-id', title: 'New' })
      const state = reducer(baseState, addSessionSummary(updated))
      expect(state.sessions).toHaveLength(1)
      expect(state.sessions[0]?.title).toBe('New')
    })

    it('replaceSessionSummary updates an existing summary in place', () => {
      const existing = makeSessionSummary({ id: 'a', title: 'Old' })
      const baseState = reducer(undefined, setSessions([existing]))
      const updated = makeSessionSummary({ id: 'a', title: 'Updated' })
      const state = reducer(baseState, replaceSessionSummary(updated))
      expect(state.sessions[0]?.title).toBe('Updated')
    })

    it('replaceSessionSummary inserts when id is not found', () => {
      const baseState = reducer(undefined, setSessions([]))
      const newSummary = makeSessionSummary({ id: 'missing' })
      const state = reducer(baseState, replaceSessionSummary(newSummary))
      expect(state.sessions).toHaveLength(1)
      expect(state.sessions[0]?.id).toBe('missing')
    })

    it('removeSessionSummary removes by id', () => {
      const s1 = makeSessionSummary({ id: 'keep' })
      const s2 = makeSessionSummary({ id: 'remove' })
      const baseState = reducer(undefined, setSessions([s1, s2]))
      const state = reducer(baseState, removeSessionSummary('remove'))
      expect(state.sessions).toHaveLength(1)
      expect(state.sessions[0]?.id).toBe('keep')
    })
  })

  describe('current session', () => {
    it('setCurrentSession sets the active session and clears interim', () => {
      const baseState = reducer(
        undefined,
        receiveTranscriptResult({
          source: 'microphone',
          text: 'partial',
          isFinal: false,
          speechFinal: false,
          confidence: 0.5,
        }),
      )
      const doc = makeSessionDocument()
      const state = reducer(baseState, setCurrentSession(doc))
      expect(state.currentSession?.id).toBe(doc.id)
      expect(state.interim.microphone).toBe('')
    })

    it('setCurrentSession accepts null to clear the session', () => {
      const state = reducer(undefined, setCurrentSession(null))
      expect(state.currentSession).toBeNull()
    })

    it('replaceCurrentSession updates the current session when ids match', () => {
      const doc = makeSessionDocument({ id: 'match', title: 'Old' })
      const baseState = reducer(undefined, setCurrentSession(doc))
      const updated = makeSessionDocument({ id: 'match', title: 'New' })
      const state = reducer(baseState, replaceCurrentSession(updated))
      expect(state.currentSession?.title).toBe('New')
    })

    it('replaceCurrentSession does not update when ids do not match', () => {
      const doc = makeSessionDocument({ id: 'original', title: 'Old' })
      const baseState = reducer(undefined, setCurrentSession(doc))
      const unrelated = makeSessionDocument({ id: 'other', title: 'Other' })
      const state = reducer(baseState, replaceCurrentSession(unrelated))
      expect(state.currentSession?.title).toBe('Old')
    })
  })

  describe('session state', () => {
    it('setSessionState updates the session lifecycle state', () => {
      const event: SessionStateEvent = { state: 'recording', transcriptId: 's1' }
      const state = reducer(undefined, setSessionState(event))
      expect(state.session.state).toBe('recording')
    })

    it('clears levels and interim when idle', () => {
      const baseState = reducer(undefined, setAudioLevel({ source: 'microphone', level: 0.8 }))
      const state = reducer(baseState, setSessionState({ state: 'idle' }))
      expect(state.levels.microphone).toBe(0)
      expect(state.levels.speaker).toBe(0)
      expect(state.interim.microphone).toBe('')
    })
  })

  describe('transcript results', () => {
    it('sets interim text for non-final results', () => {
      const event = makeTranscriptResult({ isFinal: false, text: 'partial...' })
      const state = reducer(undefined, receiveTranscriptResult(event))
      expect(state.interim.microphone).toBe('partial...')
    })

    it('clears interim text on final results', () => {
      const baseState = reducer(
        undefined,
        receiveTranscriptResult({
          source: 'microphone',
          text: 'partial',
          isFinal: false,
          speechFinal: false,
          confidence: 0.5,
        }),
      )
      const finalEvent = makeTranscriptResult({ isFinal: true })
      const state = reducer(baseState, receiveTranscriptResult(finalEvent))
      expect(state.interim.microphone).toBe('')
    })

    it('appends segment to current session on final result with segment', () => {
      const doc = makeSessionDocument({ segments: [] })
      const baseState = reducer(undefined, setCurrentSession(doc))
      const segment: TranscriptSegment = {
        id: randomUUID(),
        source: 'microphone',
        text: 'finalized text',
        confidence: 0.99,
        createdAt: new Date().toISOString(),
        offsetMs: 1000,
      }
      const event = makeTranscriptResult({ isFinal: true, segment })
      const state = reducer(baseState, receiveTranscriptResult(event))
      expect(state.currentSession?.segments).toHaveLength(1)
      expect(state.currentSession?.segments[0]?.text).toBe('finalized text')
    })
  })

  describe('translation results', () => {
    it('appends translation to the current session', () => {
      const doc = makeSessionDocument({ id: 's1', translations: [] })
      const baseState = reducer(undefined, setCurrentSession(doc))
      const event = makeTranslationResult({ transcriptId: 's1' })
      const state = reducer(baseState, receiveTranslationResult(event))
      expect(state.currentSession?.translations).toHaveLength(1)
    })

    it('does not duplicate existing translations by id', () => {
      const translation = {
        id: 't1',
        provider: 'google' as const,
        sourceText: 'hello',
        text: 'merhaba',
        sourceLanguage: 'en',
        targetLanguage: 'tr' as const,
        sourceSegmentIds: [randomUUID()],
        sourceStartIndex: 0,
        sourceEndIndex: 1,
        createdAt: new Date().toISOString(),
      }
      const doc = makeSessionDocument({ id: 's1', translations: [translation] })
      const baseState = reducer(undefined, setCurrentSession(doc))
      const event = makeTranslationResult({
        transcriptId: 's1',
        translation: { ...translation },
      })
      const state = reducer(baseState, receiveTranslationResult(event))
      expect(state.currentSession?.translations).toHaveLength(1)
    })

    it('does not append when transcriptId does not match current session', () => {
      const doc = makeSessionDocument({ id: 's1', translations: [] })
      const baseState = reducer(undefined, setCurrentSession(doc))
      const event = makeTranslationResult({ transcriptId: 'other-session' })
      const state = reducer(baseState, receiveTranslationResult(event))
      expect(state.currentSession?.translations).toHaveLength(0)
    })
  })

  describe('audio levels', () => {
    it('sets the audio level for microphone', () => {
      const state = reducer(undefined, setAudioLevel({ source: 'microphone', level: 0.5 }))
      expect(state.levels.microphone).toBe(0.5)
    })

    it('sets the audio level for speaker', () => {
      const state = reducer(undefined, setAudioLevel({ source: 'speaker', level: 0.75 }))
      expect(state.levels.speaker).toBe(0.75)
    })
  })

  describe('update state', () => {
    it('sets the update lifecycle event', () => {
      const event: UpdateStateEvent = {
        state: 'available',
        version: '4.0.0',
      }
      const state = reducer(undefined, setUpdateState(event))
      expect(state.update.state).toBe('available')
      expect(state.update.version).toBe('4.0.0')
    })
  })

  describe('UI toggles', () => {
    it('toggles the sessions sidebar', () => {
      const state = reducer(undefined, setSessionsSidebarOpen(false))
      expect(state.sessionsSidebarOpen).toBe(false)
    })

    it('toggles compact mode', () => {
      const state = reducer(undefined, setCompactMode(true))
      expect(state.compactMode).toBe(true)
    })
  })
})
