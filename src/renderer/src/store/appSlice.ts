/**
 * Stores application settings, media catalogs, history, and desktop update state.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { MediaModel } from '@shared/openrouter'
import {
  DEFAULT_SETTINGS,
  type ApiBalance,
  type AppSettings,
  type BootstrapPayload,
  type MediaKind,
  type SessionDocument,
  type SessionSummary,
  type SessionUpdatedEvent,
  type UpdateStateEvent,
} from '@shared/types'

export type AppPage = 'home' | 'settings'
export type SettingsSection =
  | 'general'
  | 'display'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'updates'
  | 'telemetry'
  | 'about'
  | 'logging'

export interface AppState {
  initialized: boolean
  page: AppPage
  settingsSection: SettingsSection
  settings: AppSettings
  platform: BootstrapPayload['platform']
  version: string
  hasApiKeys: Record<MediaKind, boolean>
  apiBalances: Record<MediaKind, ApiBalance[]>
  models: Record<MediaKind, MediaModel[]>
  sessions: SessionSummary[]
  currentSession: SessionDocument | null
  update: UpdateStateEvent
  sessionsSidebarOpen: boolean
}

const initialState: AppState = {
  initialized: false,
  page: 'home',
  settingsSection: 'general',
  settings: DEFAULT_SETTINGS,
  platform: 'win32',
  version: '0.0.0',
  hasApiKeys: { image: false, video: false, tts: false, stt: false },
  apiBalances: { image: [], video: [], tts: [], stt: [] },
  models: { image: [], video: [], tts: [], stt: [] },
  sessions: [],
  currentSession: null,
  update: { state: 'idle' },
  sessionsSidebarOpen: true,
}

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    /** Hydrates renderer state exactly once from the trusted preload bridge. */
    hydrate(state, action: PayloadAction<BootstrapPayload>) {
      if (state.initialized) return
      Object.assign(state, {
        initialized: true,
        settings: action.payload.settings,
        platform: action.payload.platform,
        version: action.payload.version,
        hasApiKeys: action.payload.hasApiKeys,
        models: action.payload.models,
        sessions: action.payload.sessions,
        currentSession: action.payload.currentSession,
      })
    },
    /** Opens one top-level application page. */
    setPage(state, action: PayloadAction<AppPage>) {
      state.page = action.payload
    },
    /** Selects one settings category. */
    setSettingsSection(state, action: PayloadAction<SettingsSection>) {
      state.settingsSection = action.payload
    },
    /** Replaces settings only after durable persistence succeeds. */
    setSettings(state, action: PayloadAction<AppSettings>) {
      state.settings = action.payload
    },
    /** Updates availability of one independently encrypted media credential. */
    setHasApiKey(state, action: PayloadAction<{ kind: MediaKind; available: boolean }>) {
      state.hasApiKeys[action.payload.kind] = action.payload.available
    },
    /** Replaces optional balance data for one media credential. */
    setApiBalance(state, action: PayloadAction<{ kind: MediaKind; balance: ApiBalance[] }>) {
      state.apiBalances[action.payload.kind] = action.payload.balance
    },
    /** Replaces one public model catalog after a manual refresh. */
    setModels(state, action: PayloadAction<{ kind: MediaKind; models: MediaModel[] }>) {
      state.models[action.payload.kind] = action.payload.models
    },
    /** Inserts or updates one history summary in most-recent-first order. */
    upsertSessionSummary(state, action: PayloadAction<SessionSummary>) {
      state.sessions = [
        action.payload,
        ...state.sessions.filter((candidate) => candidate.id !== action.payload.id),
      ]
    },
    /** Removes one durable history entry. */
    removeSessionSummary(state, action: PayloadAction<string>) {
      state.sessions = state.sessions.filter((candidate) => candidate.id !== action.payload)
    },
    /** Selects one complete history document. */
    setCurrentSession(state, action: PayloadAction<SessionDocument | null>) {
      state.currentSession = action.payload
    },
    /** Applies a background generation update to history and the selected document. */
    receiveSessionUpdated(state, action: PayloadAction<SessionUpdatedEvent>) {
      state.sessions = [
        action.payload.summary,
        ...state.sessions.filter((candidate) => candidate.id !== action.payload.summary.id),
      ]
      if (state.currentSession?.id === action.payload.session.id) {
        state.currentSession = action.payload.session
      }
    },
    /** Applies desktop updater progress. */
    setUpdateState(state, action: PayloadAction<UpdateStateEvent>) {
      state.update = action.payload
    },
    /** Shows or hides history without changing durable preferences. */
    setSessionsSidebarOpen(state, action: PayloadAction<boolean>) {
      state.sessionsSidebarOpen = action.payload
    },
    /** Removes all session summaries and clears the workspace. */
    clearAllSessions(state) {
      state.sessions = []
      state.currentSession = null
    },
  },
})

export const {
  clearAllSessions,
  hydrate,
  receiveSessionUpdated,
  removeSessionSummary,
  setApiBalance,
  setCurrentSession,
  setHasApiKey,
  setModels,
  setPage,
  setSessionsSidebarOpen,
  setSettings,
  setSettingsSection,
  setUpdateState,
  upsertSessionSummary,
} = appSlice.actions

export default appSlice.reducer
