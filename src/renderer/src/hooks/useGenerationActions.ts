/**
 * Exposes renderer commands for submitting jobs and managing generated media files.
 */

import { useCallback, useRef, useState } from 'react'
import { App as AntdApp } from 'antd'
import type { GenerateRequest } from '@shared/types'
import { createLogger } from '@renderer/services/LoggerService'
import { useAppDispatch } from '@renderer/store'
import { setCurrentSession, upsertSessionSummary } from '@renderer/store/appSlice'
import { toSessionSummary } from '@renderer/utils/formatters'

const logger = createLogger('GenerationActions')

/** Returns generation and native media actions with short submit-button locking. */
export const useGenerationActions = () => {
  const dispatch = useAppDispatch()
  const { message } = AntdApp.useApp()
  const [submitting, setSubmitting] = useState(false)
  const submissionLock = useRef(false)

  /** Creates a durable session immediately while provider work continues in parallel. */
  const generate = useCallback(
    async (request: GenerateRequest): Promise<boolean> => {
      if (submissionLock.current) return false
      submissionLock.current = true
      setSubmitting(true)
      try {
        const session = await window.app.generate(request)
        dispatch(upsertSessionSummary(toSessionSummary(session)))
        dispatch(setCurrentSession(session))
        return true
      } catch (error) {
        logger.error('Generation could not be submitted.', error)
        void message.error(error instanceof Error ? error.message : 'Generation failed.')
        return false
      } finally {
        submissionLock.current = false
        setSubmitting(false)
      }
    },
    [dispatch, message],
  )

  /** Saves one generated media asset through the native dialog. */
  const saveMedia = useCallback(
    async (sessionId: string, assetId: string): Promise<void> => {
      try {
        if (await window.app.saveMedia(sessionId, assetId)) void message.success('Media saved.')
      } catch (error) {
        logger.error('Generated media could not be saved.', error)
        void message.error('Media could not be saved.')
      }
    },
    [message],
  )

  /** Reveals one application-owned output in the system file manager. */
  const showInFolder = useCallback(async (sessionId: string, assetId: string): Promise<void> => {
    try {
      await window.app.showMediaInFolder(sessionId, assetId)
    } catch (error) {
      logger.error('Generated media could not be revealed.', error)
    }
  }, [])

  return { generate, saveMedia, showInFolder, submitting }
}
