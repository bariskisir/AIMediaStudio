/**
 * Exposes renderer commands for session workspace management and exports.
 */

import { useCallback } from 'react'
import { App as AntdApp } from 'antd'
import { useTranslation } from 'react-i18next'
import type { SessionFormat } from '@shared/types'
import { createLogger } from '@renderer/services/LoggerService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addSessionSummary,
  removeSessionSummary,
  replaceCurrentSession,
  replaceSessionSummary,
  setCurrentSession,
} from '@renderer/store/appSlice'
import { toSessionSummary } from '@renderer/utils/formatters'

const logger = createLogger('SessionActions')
let selectionRevision = 0

/** Returns stable local session management commands. */
export const useSessionActions = () => {
  const dispatch = useAppDispatch()
  const sessions = useAppSelector((state) => state.app.sessions)
  const currentSessionId = useAppSelector((state) => state.app.currentSession?.id ?? null)
  const speechLanguage = useAppSelector((state) => {
    const settings = state.app.settings
    return (
      settings.transcriptionProviderSettings[settings.transcriptionProvider].language ||
      settings.uiLanguage
    )
  })
  const translationProvider = useAppSelector((state) => state.app.settings.translationProvider)
  const translationEnabled = useAppSelector((state) => state.app.settings.translationEnabled)
  const translationTargetLanguage = useAppSelector(
    (state) => state.app.settings.translationTargetLanguage,
  )
  const { message } = AntdApp.useApp()
  const { t } = useTranslation()

  /** Loads a complete session from local storage. */
  const openSession = useCallback(
    async (id: string): Promise<void> => {
      const revision = ++selectionRevision
      try {
        const session = await window.app.getSession(id)
        if (revision === selectionRevision) dispatch(setCurrentSession(session))
      } catch (error) {
        if (revision !== selectionRevision) return
        logger.error('Session could not be loaded.', error)
        void message.error(t('errors.generic'))
      }
    },
    [dispatch, message, t],
  )

  /** Creates and selects a new session workspace. */
  const createSession = useCallback(async (): Promise<void> => {
    const revision = ++selectionRevision
    try {
      const session = await window.app.createSession(speechLanguage)
      const summary = toSessionSummary(session)
      dispatch(addSessionSummary(summary))
      if (revision === selectionRevision) dispatch(setCurrentSession(session))
    } catch (error) {
      logger.error('Session workspace could not be created.', error)
      void message.error(t('errors.generic'))
    }
  }, [dispatch, message, speechLanguage, t])

  /** Renames a session and synchronizes the active document and summary. */
  const renameSession = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      try {
        const session = await window.app.renameSession(id, title)
        const summary = toSessionSummary(session)
        dispatch(replaceCurrentSession(session))
        dispatch(replaceSessionSummary(summary))
        return true
      } catch (error) {
        logger.error('Session could not be renamed.', error)
        void message.error(t('errors.generic'))
        return false
      }
    },
    [dispatch, message, t],
  )

  /** Deletes one session while preserving and selecting a ready workspace. */
  const deleteSession = useCallback(
    async (id: string): Promise<void> => {
      const revision = ++selectionRevision
      try {
        const result = await window.app.deleteSession(id)
        if (!result.deleted) return
        dispatch(removeSessionSummary(id))
        const remaining = sessions.filter((item) => item.id !== id)
        if (result.replacement) dispatch(addSessionSummary(toSessionSummary(result.replacement)))

        if (currentSessionId !== id) return
        const nextSession =
          result.replacement ?? (remaining[0] ? await window.app.getSession(remaining[0].id) : null)
        if (revision === selectionRevision) dispatch(setCurrentSession(nextSession))
      } catch (error) {
        logger.error('Session could not be deleted.', error)
        void message.error(t('errors.generic'))
      }
    },
    [currentSessionId, dispatch, sessions, message, t],
  )

  /** Exports a session through the operating-system save dialog. */
  const exportSession = useCallback(
    async (id: string, format: SessionFormat): Promise<void> => {
      try {
        if (
          await window.app.exportSession(
            id,
            format,
            t('sessions.exportTxt'),
            translationEnabled,
            translationProvider,
            translationTargetLanguage,
          )
        ) {
          void message.success(t('transcript.exported'))
        }
      } catch (error) {
        logger.error('Session could not be exported.', error)
        void message.error(t('errors.generic'))
      }
    },
    [message, t, translationEnabled, translationProvider, translationTargetLanguage],
  )

  return {
    createSession,
    deleteSession,
    exportSession,
    openSession,
    renameSession,
  }
}
