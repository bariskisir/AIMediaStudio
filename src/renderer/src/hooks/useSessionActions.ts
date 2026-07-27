/**
 * Exposes renderer commands for generation history management and metadata export.
 */

import { useCallback } from 'react'
import { App as AntdApp } from 'antd'
import { useTranslation } from 'react-i18next'
import { createLogger } from '@renderer/services/LoggerService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  removeSessionSummary,
  setCurrentSession,
  upsertSessionSummary,
} from '@renderer/store/appSlice'
import { toSessionSummary } from '@renderer/utils/formatters'

const logger = createLogger('SessionActions')
let selectionRevision = 0

/** Returns stable local history and export commands. */
export const useSessionActions = () => {
  const dispatch = useAppDispatch()
  const sessions = useAppSelector((state) => state.app.sessions)
  const currentSessionId = useAppSelector((state) => state.app.currentSession?.id ?? null)
  const { message } = AntdApp.useApp()
  const { t } = useTranslation()

  /** Loads one complete generation session. */
  const openSession = useCallback(
    async (id: string): Promise<void> => {
      const revision = ++selectionRevision
      try {
        const session = await window.app.getSession(id)
        if (revision === selectionRevision) dispatch(setCurrentSession(session))
      } catch (error) {
        logger.error('Session could not be loaded.', error)
        void message.error(t('errors.generic'))
      }
    },
    [dispatch, message, t],
  )

  /** Creates and selects an empty generation workspace. */
  const createSession = useCallback(async (): Promise<void> => {
    try {
      const session = await window.app.createSession()
      dispatch(upsertSessionSummary(toSessionSummary(session)))
      dispatch(setCurrentSession(session))
    } catch (error) {
      logger.error('Session workspace could not be created.', error)
      void message.error(t('errors.generic'))
    }
  }, [dispatch, message, t])

  /** Renames one session and synchronizes both document forms. */
  const renameSession = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      try {
        const session = await window.app.renameSession(id, title)
        dispatch(upsertSessionSummary(toSessionSummary(session)))
        if (currentSessionId === id) dispatch(setCurrentSession(session))
        return true
      } catch (error) {
        logger.error('Session could not be renamed.', error)
        void message.error(t('errors.generic'))
        return false
      }
    },
    [currentSessionId, dispatch, message, t],
  )

  /** Deletes one terminal generation while preserving an empty workspace. */
  const deleteSession = useCallback(
    async (id: string): Promise<void> => {
      try {
        const result = await window.app.deleteSession(id)
        if (!result.deleted) return
        dispatch(removeSessionSummary(id))
        const remaining = sessions.filter((candidate) => candidate.id !== id)
        if (result.replacement) {
          dispatch(upsertSessionSummary(toSessionSummary(result.replacement)))
        }
        if (currentSessionId === id) {
          const next =
            result.replacement ??
            (remaining[0] ? await window.app.getSession(remaining[0].id) : null)
          dispatch(setCurrentSession(next))
        }
      } catch (error) {
        logger.error('Session could not be deleted.', error)
        void message.error(error instanceof Error ? error.message : t('errors.generic'))
      }
    },
    [currentSessionId, dispatch, message, sessions, t],
  )

  /** Exports one generation's metadata through a native JSON save dialog. */
  const exportSession = useCallback(
    async (id: string): Promise<void> => {
      try {
        if (await window.app.exportSession(id)) void message.success(t('notices.exported'))
      } catch (error) {
        logger.error('Session metadata could not be exported.', error)
        void message.error(t('errors.generic'))
      }
    },
    [message, t],
  )

  return { createSession, deleteSession, exportSession, openSession, renameSession }
}
