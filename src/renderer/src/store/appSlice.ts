/**
 * Stores application settings, runtime recording state, history, and update progress.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type BootstrapPayload,
  type ApiBalance,
  type SessionDocument,
  type SessionStateEvent,
  type SessionSummary,
  type TranscriptResultEvent,
  type TranslationResultEvent,
  type UpdateStateEvent,
} from '@shared/types'
import type { OpenRouterSpeechModel } from '@shared/openrouter'
import type { DeepgramSpeechModel } from '@shared/deepgram'
import type { TranscriptionProvider } from '@shared/transcription'

export type AppPage = 'home' | 'settings'
export type SettingsSection =
  'general' | 'display' | 'transcription' | 'translation' | 'updates' | 'about' | 'logging'

export interface AppState {
  initialized: boolean
  page: AppPage
  settingsSection: SettingsSection
  settings: AppSettings
  platform: BootstrapPayload['platform']
  version: string
  hasApiKeys: Record<TranscriptionProvider, boolean>
  apiBalances: Record<TranscriptionProvider, ApiBalance[]>
  deepgramModels: DeepgramSpeechModel[]
  openRouterModels: OpenRouterSpeechModel[]
  sessions: SessionSummary[]
  currentSession: SessionDocument | null
  session: SessionStateEvent
  interim: { microphone: string; speaker: string }
  levels: { microphone: number; speaker: number }
  update: UpdateStateEvent
  sessionsSidebarOpen: boolean
  compactMode: boolean
}

const initialState: AppState = {
  initialized: false,
  page: 'home',
  settingsSection: 'general',
  settings: DEFAULT_SETTINGS,
  platform: 'win32',
  version: '0.0.0',
  hasApiKeys: { deepgram: false, openrouter: false },
  apiBalances: { deepgram: [], openrouter: [] },
  deepgramModels: [],
  openRouterModels: [],
  sessions: [],
  currentSession: null,
  session: { state: 'idle' },
  interim: { microphone: '', speaker: '' },
  levels: { microphone: 0, speaker: 0 },
  update: { state: 'idle' },
  sessionsSidebarOpen: true,
  compactMode: false,
}

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    /** Hydrates the renderer with persisted main-process state. */
    hydrate(state, action: PayloadAction<BootstrapPayload>) {
      if (state.initialized) return
      state.initialized = true
      state.settings = action.payload.settings
      state.platform = action.payload.platform
      state.version = action.payload.version
      state.hasApiKeys = action.payload.hasApiKeys
      state.deepgramModels = action.payload.deepgramModels
      state.openRouterModels = action.payload.openRouterModels
      state.sessions = action.payload.sessions
      state.currentSession = action.payload.currentSession
    },
    /** Opens a top-level application page. */
    setPage(state, action: PayloadAction<AppPage>) {
      state.page = action.payload
      if (action.payload !== 'home') state.compactMode = false
    },
    /** Selects the settings category shown when the settings page is opened. */
    setSettingsSection(state, action: PayloadAction<SettingsSection>) {
      state.settingsSection = action.payload
    },
    /** Replaces settings after successful persistence. */
    setSettings(state, action: PayloadAction<AppSettings>) {
      state.settings = action.payload
    },
    /** Updates whether one transcription provider credential is available. */
    setHasApiKey(
      state,
      action: PayloadAction<{ provider: TranscriptionProvider; available: boolean }>,
    ) {
      state.hasApiKeys[action.payload.provider] = action.payload.available
    },
    /** Replaces optional account balance data for one transcription provider. */
    setApiBalance(
      state,
      action: PayloadAction<{ provider: TranscriptionProvider; balance: ApiBalance[] }>,
    ) {
      state.apiBalances[action.payload.provider] = action.payload.balance
    },
    /** Replaces session summaries from local storage. */
    setSessions(state, action: PayloadAction<SessionSummary[]>) {
      state.sessions = action.payload
    },
    /** Inserts a newly created summary at the front without duplicating its identifier. */
    addSessionSummary(state, action: PayloadAction<SessionSummary>) {
      state.sessions = [
        action.payload,
        ...state.sessions.filter((item) => item.id !== action.payload.id),
      ]
    },
    /** Replaces a known summary in place, or inserts it when sessions list was not yet synchronized. */
    replaceSessionSummary(state, action: PayloadAction<SessionSummary>) {
      const index = state.sessions.findIndex((item) => item.id === action.payload.id)
      if (index === -1) state.sessions.unshift(action.payload)
      else state.sessions[index] = action.payload
    },
    /** Removes one session summary by its durable identifier. */
    removeSessionSummary(state, action: PayloadAction<string>) {
      state.sessions = state.sessions.filter((item) => item.id !== action.payload)
    },
    /** Sets the session displayed in the main reading surface. */
    setCurrentSession(state, action: PayloadAction<SessionDocument | null>) {
      state.currentSession = action.payload
      state.interim = { microphone: '', speaker: '' }
    },
    /** Refreshes a document only when it is still the active session. */
    replaceCurrentSession(state, action: PayloadAction<SessionDocument>) {
      if (state.currentSession?.id === action.payload.id) {
        state.currentSession = action.payload
        state.interim = { microphone: '', speaker: '' }
      }
    },
    /** Applies a recording lifecycle event. */
    setSessionState(state, action: PayloadAction<SessionStateEvent>) {
      state.session = action.payload
      if (action.payload.state === 'idle') {
        state.levels = { microphone: 0, speaker: 0 }
        state.interim = { microphone: '', speaker: '' }
      }
    },
    /** Applies one interim or final transcription result. */
    receiveTranscriptResult(state, action: PayloadAction<TranscriptResultEvent>) {
      const event = action.payload
      if (event.isFinal) {
        state.interim[event.source] = ''
        if (event.segment && state.currentSession) {
          state.currentSession.segments.push(event.segment)
        }
      } else if (!event.isFinal) {
        state.interim[event.source] = event.text
      }
    },
    /** Appends one live translation only to its currently displayed session. */
    receiveTranslationResult(state, action: PayloadAction<TranslationResultEvent>) {
      if (state.currentSession?.id !== action.payload.transcriptId) return
      const translation = action.payload.translation
      if (!state.currentSession.translations.some((candidate) => candidate.id === translation.id)) {
        state.currentSession.translations.push(translation)
      }
    },
    /** Updates the live meter for one source. */
    setAudioLevel(
      state,
      action: PayloadAction<{ source: 'microphone' | 'speaker'; level: number }>,
    ) {
      state.levels[action.payload.source] = action.payload.level
    },
    /** Applies desktop updater progress. */
    setUpdateState(state, action: PayloadAction<UpdateStateEvent>) {
      state.update = action.payload
    },
    /** Shows or hides the session management sidebar for the current app session. */
    setSessionsSidebarOpen(state, action: PayloadAction<boolean>) {
      state.sessionsSidebarOpen = action.payload
    },
    /** Toggles the distraction-free workspace with title-bar recording controls. */
    setCompactMode(state, action: PayloadAction<boolean>) {
      state.compactMode = action.payload
    },
  },
})

export const {
  addSessionSummary,
  hydrate,
  receiveTranscriptResult,
  receiveTranslationResult,
  removeSessionSummary,
  replaceCurrentSession,
  replaceSessionSummary,
  setApiBalance,
  setAudioLevel,
  setCurrentSession,
  setHasApiKey,
  setSessions,
  setPage,
  setSessionState,
  setSettings,
  setSettingsSection,
  setCompactMode,
  setSessionsSidebarOpen,
  setUpdateState,
} = appSlice.actions

export default appSlice.reducer
