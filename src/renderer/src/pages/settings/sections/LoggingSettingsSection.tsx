/**
 * Renders log level and log folder controls.
 */

import { Button, Select } from 'antd'
import { FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LOG_LEVELS } from '@shared/types'
import { useDesktopActions } from '@renderer/hooks/useDesktopActions'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppSelector } from '@renderer/store'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

/** Displays diagnostic logging preferences. */
const LoggingSettingsSection = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const settingsActions = useSettingsActions()
  const desktopActions = useDesktopActions()
  const { t } = useTranslation()

  return (
    <div className={styles.settingContainer}>
      <h2 className={styles.groupTitle}>{t('settings.logging')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.logLevel')}
            description={t('settings.logLevelDescription')}
          />
          <div className={styles.settingControl}>
            <Select
              className={styles.compactControl ?? ''}
              value={settings.logLevel}
              options={LOG_LEVELS.map((level) => ({
                value: level,
                label: t(`settings.logLevels.${level}`),
              }))}
              onChange={(logLevel) => void settingsActions.saveSettings({ logLevel })}
            />
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.logFiles')}
            description={t('settings.logFilesDescription')}
          />
          <div className={styles.settingControl}>
            <Button
              icon={<FolderOpen size={14} />}
              onClick={() => void desktopActions.openLogsDirectory()}
            >
              {t('settings.openLogs')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

export default LoggingSettingsSection
