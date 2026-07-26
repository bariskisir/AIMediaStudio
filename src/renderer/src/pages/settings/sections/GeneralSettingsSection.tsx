/**
 * Renders interface, clock, and AppData logging preferences.
 */

import { Select } from 'antd'
import { useTranslation } from 'react-i18next'
import { APP_LOCALES, TIME_FORMATS, type AppLocale, type TimeFormat } from '@shared/types'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppSelector } from '@renderer/store'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

/** Displays general application controls. */
const GeneralSettingsSection = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const settingsActions = useSettingsActions()
  const { t } = useTranslation()

  return (
    <div className={styles.settingContainer}>
      <h2 className={styles.groupTitle}>{t('settings.general')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.interfaceLanguage')}
            description={t('settings.interfaceLanguageDescription')}
          />
          <div className={styles.settingControl}>
            <Select
              className={styles.compactControl ?? ''}
              value={settings.uiLanguage}
              options={APP_LOCALES.map((locale) => ({
                value: locale,
                label: t(`locales.${locale}`),
              }))}
              onChange={(uiLanguage: AppLocale) =>
                void settingsActions.saveSettings({ uiLanguage })
              }
            />
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.timeFormat')}
            description={t('settings.timeFormatDescription')}
          />
          <div className={styles.settingControl}>
            <Select
              className={styles.compactControl ?? ''}
              value={settings.timeFormat}
              options={TIME_FORMATS.map((timeFormat) => ({
                value: timeFormat,
                label: t(`settings.timeFormats.${timeFormat}`),
              }))}
              onChange={(timeFormat: TimeFormat) =>
                void settingsActions.saveSettings({ timeFormat })
              }
            />
          </div>
        </div>
      </section>
    </div>
  )
}

export default GeneralSettingsSection
