/** Renders the anonymous startup telemetry preference and privacy disclosure. */

import { Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppSelector } from '@renderer/store'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

/** Displays the opt-out Application Insights startup telemetry control. */
const TelemetrySettingsSection = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const settingsActions = useSettingsActions()
  const { t } = useTranslation()

  return (
    <div className={styles.settingContainer}>
      <h2 className={styles.groupTitle}>{t('settings.telemetry')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.telemetryCollection')}
            description={t('settings.telemetryDescription')}
          />
          <div className={styles.settingControl}>
            <Switch
              checked={settings.telemetryEnabled}
              onChange={(telemetryEnabled) =>
                void settingsActions.saveSettings({ telemetryEnabled })
              }
            />
          </div>
        </div>
      </section>
    </div>
  )
}

export default TelemetrySettingsSection
