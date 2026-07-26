/**
 * Exposes renderer commands for persisted settings and transcription credentials.
 */

import { useCallback } from 'react'
import { App as AntdApp } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AppSettingsPatch } from '@shared/types'
import type { TranscriptionProvider } from '@shared/transcription'
import i18n from '@renderer/i18n'
import { createLogger } from '@renderer/services/LoggerService'
import SettingsPersistenceQueue from '@renderer/services/SettingsPersistenceQueue'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setApiBalance, setHasApiKey, setSettings } from '@renderer/store/appSlice'

const logger = createLogger('SettingsActions')
const settingsPersistenceQueue = new SettingsPersistenceQueue()

/** Returns stable settings and credential commands backed by the preload API. */
export const useSettingsActions = () => {
  const dispatch = useAppDispatch()
  const currentSessionId = useAppSelector((state) => state.app.currentSession?.id ?? null)
  const { message } = AntdApp.useApp()
  const { t } = useTranslation()

  /** Serializes a partial settings update so rapid controls cannot overwrite each other. */
  const saveSettings = useCallback(
    async (patch: AppSettingsPatch): Promise<void> => {
      try {
        const saved = await settingsPersistenceQueue.enqueue(patch, window.app.saveSettings)
        dispatch(setSettings(saved))
        document.documentElement.lang = saved.uiLanguage
        await i18n.changeLanguage(saved.uiLanguage)
        if (
          (patch.translationEnabled !== undefined ||
            patch.translationTargetLanguage !== undefined ||
            patch.translationProvider !== undefined) &&
          currentSessionId
        ) {
          try {
            await window.app.translateSession(
              currentSessionId,
              saved.translationEnabled,
              saved.translationProvider,
              saved.translationTargetLanguage,
            )
          } catch (error) {
            logger.error('Transcript translation could not be scheduled.', error)
            void message.error(t('errors.generic'))
          }
        }
      } catch (error) {
        logger.error('Settings could not be saved.', error)
        void message.error(t('errors.generic'))
      }
    },
    [currentSessionId, dispatch, message, t],
  )

  /** Verifies and saves one transcription provider API key. */
  const saveApiKey = useCallback(
    async (provider: TranscriptionProvider, apiKey: string): Promise<boolean> => {
      try {
        const balance = await window.app.saveApiKey(provider, apiKey)
        dispatch(setHasApiKey({ provider, available: true }))
        dispatch(setApiBalance({ provider, balance }))
        void message.success(t('notices.apiKeySaved'))
        return true
      } catch (error) {
        logger.error('Transcription API key validation failed.', error)
        void message.error(t('errors.generic'))
        return false
      }
    },
    [dispatch, message, t],
  )

  /** Removes one encrypted provider key and clears its credential state. */
  const deleteApiKey = useCallback(
    async (provider: TranscriptionProvider): Promise<boolean> => {
      try {
        await window.app.deleteApiKey(provider)
        dispatch(setHasApiKey({ provider, available: false }))
        dispatch(setApiBalance({ provider, balance: [] }))
        void message.success(t('notices.apiKeyRemoved'))
        return true
      } catch (error) {
        logger.error('Transcription API key could not be removed.', error)
        void message.error(t('errors.generic'))
        return false
      }
    },
    [dispatch, message, t],
  )

  /** Refreshes optional account balance data without surfacing unsupported accounts. */
  const refreshApiBalance = useCallback(
    async (provider: TranscriptionProvider): Promise<void> => {
      try {
        dispatch(setApiBalance({ provider, balance: await window.app.getApiBalance(provider) }))
      } catch (error) {
        logger.warn('Transcription provider balance could not be refreshed.', error)
        dispatch(setApiBalance({ provider, balance: [] }))
      }
    },
    [dispatch],
  )

  return { deleteApiKey, refreshApiBalance, saveApiKey, saveSettings }
}
