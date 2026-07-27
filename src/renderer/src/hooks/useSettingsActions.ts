/**
 * Exposes persisted settings and independently scoped OpenRouter credential commands.
 */

import { useCallback } from 'react'
import { App as AntdApp } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AppSettingsPatch, MediaKind } from '@shared/types'
import i18n from '@renderer/i18n'
import { createLogger } from '@renderer/services/LoggerService'
import SettingsPersistenceQueue from '@renderer/services/SettingsPersistenceQueue'
import { useAppDispatch } from '@renderer/store'
import { setApiBalance, setHasApiKey, setModels, setSettings } from '@renderer/store/appSlice'

const logger = createLogger('SettingsActions')
const settingsPersistenceQueue = new SettingsPersistenceQueue()

/** Returns stable settings, catalog, and credential commands. */
export const useSettingsActions = () => {
  const dispatch = useAppDispatch()
  const { message } = AntdApp.useApp()
  const { t } = useTranslation()

  /** Serializes sparse settings writes so rapid controls remain ordered. */
  const saveSettings = useCallback(
    async (patch: AppSettingsPatch): Promise<void> => {
      try {
        const saved = await settingsPersistenceQueue.enqueue(patch, window.app.saveSettings)
        dispatch(setSettings(saved))
        document.documentElement.lang = saved.uiLanguage
        await i18n.changeLanguage(saved.uiLanguage)
      } catch (error) {
        logger.error('Settings could not be saved.', error)
        void message.error(t('errors.generic'))
      }
    },
    [dispatch, message, t],
  )

  /** Verifies one key, updates its scope, and reflects any newly seeded empty scopes. */
  const saveApiKey = useCallback(
    async (kind: MediaKind, apiKey: string): Promise<boolean> => {
      try {
        const result = await window.app.saveApiKey({ kind, provider: 'openrouter' }, apiKey)
        for (const updatedKind of result.updatedKinds) {
          dispatch(setHasApiKey({ kind: updatedKind, available: true }))
          dispatch(setApiBalance({ kind: updatedKind, balance: result.balance }))
        }
        void message.success(t('notices.apiKeySaved'))
        return true
      } catch (error) {
        logger.error('OpenRouter API key validation failed.', error)
        void message.error(error instanceof Error ? error.message : t('errors.generic'))
        return false
      }
    },
    [dispatch, message, t],
  )

  /** Removes one encrypted credential without affecting the other media mode. */
  const deleteApiKey = useCallback(
    async (kind: MediaKind): Promise<boolean> => {
      try {
        await window.app.deleteApiKey({ kind, provider: 'openrouter' })
        dispatch(setHasApiKey({ kind, available: false }))
        dispatch(setApiBalance({ kind, balance: [] }))
        void message.success(t('notices.apiKeyRemoved'))
        return true
      } catch (error) {
        logger.error('OpenRouter API key could not be removed.', error)
        void message.error(t('errors.generic'))
        return false
      }
    },
    [dispatch, message, t],
  )

  /** Refreshes one independently authenticated balance. */
  const refreshApiBalance = useCallback(
    async (kind: MediaKind): Promise<void> => {
      try {
        const balance = await window.app.getApiBalance({ kind, provider: 'openrouter' })
        dispatch(setApiBalance({ kind, balance }))
      } catch (error) {
        logger.warn('OpenRouter balance could not be refreshed.', error)
      }
    },
    [dispatch],
  )

  /** Refreshes one public model catalog without touching saved credentials. */
  const refreshModels = useCallback(
    async (kind: MediaKind): Promise<void> => {
      try {
        dispatch(setModels({ kind, models: await window.app.getModels(kind, true) }))
      } catch (error) {
        logger.warn('OpenRouter model catalog could not be refreshed.', error)
        void message.error(t('errors.generic'))
      }
    },
    [dispatch, message, t],
  )

  return { deleteApiKey, refreshApiBalance, refreshModels, saveApiKey, saveSettings }
}
