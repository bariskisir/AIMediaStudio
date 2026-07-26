/**
 * Renders translation provider and target-language preferences.
 */

import { useMemo } from 'react'
import { Select, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import {
  TRANSLATION_PROVIDERS,
  TRANSLATION_TARGET_LANGUAGES,
  type TranslationProvider,
  type TranslationTargetLanguage,
} from '@shared/translation'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppSelector } from '@renderer/store'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

/** Displays extensible provider selection and the default live translation target. */
const TranslationSettingsSection = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const session = useAppSelector((state) => state.app.session.state)
  const settingsActions = useSettingsActions()
  const { t } = useTranslation()
  const languageNames = useMemo(
    () => new Intl.DisplayNames([settings.uiLanguage, 'en'], { type: 'language' }),
    [settings.uiLanguage],
  )
  const targetOptions = TRANSLATION_TARGET_LANGUAGES.map((language) => ({
    value: language,
    label: languageNames.of(language) ?? language,
  }))

  return (
    <div className={styles.settingContainer}>
      <h2 className={styles.groupTitle}>{t('settings.translationService')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.translationProvider')}
            description={t('settings.translationProviderDescription')}
          />
          <div className={styles.settingControl}>
            <Select<TranslationProvider>
              className={styles.wideControl ?? ''}
              value={settings.translationProvider}
              disabled={session === 'connecting' || session === 'stopping'}
              virtual={false}
              options={TRANSLATION_PROVIDERS.map((provider) => ({
                value: provider,
                label: t(`settings.translationProviders.${provider}`),
              }))}
              onChange={(translationProvider) =>
                void settingsActions.saveSettings({ translationProvider })
              }
            />
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.translateTo')}
            description={t('settings.translateToDescription')}
          />
          <div className={styles.settingControl}>
            <Switch
              checked={settings.translationEnabled}
              disabled={session === 'connecting' || session === 'stopping'}
              onChange={(translationEnabled) =>
                void settingsActions.saveSettings({ translationEnabled })
              }
            />
            <Select<TranslationTargetLanguage>
              className={styles.wideControl ?? ''}
              value={settings.translationTargetLanguage}
              disabled={
                !settings.translationEnabled || session === 'connecting' || session === 'stopping'
              }
              showSearch
              optionFilterProp="label"
              options={targetOptions}
              onChange={(translationTargetLanguage) =>
                void settingsActions.saveSettings({ translationTargetLanguage })
              }
            />
          </div>
        </div>
      </section>
    </div>
  )
}

export default TranslationSettingsSection
