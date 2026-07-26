/**
 * Renders automatic update preferences and GitHub Releases progress.
 */

import { Button, Progress, Switch } from 'antd'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { UpdateStateEvent } from '@shared/types'
import { useDesktopActions } from '@renderer/hooks/useDesktopActions'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAppSelector } from '@renderer/store'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

/** Resolves localized copy for one updater lifecycle state. */
const useUpdateStatus = (update: UpdateStateEvent): string => {
  const { t } = useTranslation()
  if (update.state === 'checking') return t('settings.checking')
  if (update.state === 'available')
    return t('settings.updateAvailable', { version: update.version })
  if (update.state === 'downloading') {
    return t('settings.downloading', { percent: update.percent ?? 0 })
  }
  if (update.state === 'downloaded') {
    return t('settings.readyToInstall', { version: update.version })
  }
  if (update.state === 'error') return t('settings.updateError')
  return t('settings.upToDate')
}

/** Displays update configuration, progress, and release notes. */
const UpdatesSettingsSection = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const version = useAppSelector((state) => state.app.version)
  const update = useAppSelector((state) => state.app.update)
  const settingsActions = useSettingsActions()
  const desktopActions = useDesktopActions()
  const updateStatus = useUpdateStatus(update)
  const { t } = useTranslation()
  const { theme } = useTheme()
  const light = theme === 'light'

  return (
    <div className={styles.settingContainer}>
      <h2 className={styles.groupTitle}>{t('settings.updates')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.checkUpdatesOnStartup')}
            description={t('settings.checkUpdatesOnStartupDescription')}
          />
          <div className={styles.settingControl}>
            <Switch
              checked={settings.autoUpdate}
              onChange={(autoUpdate) => void settingsActions.saveSettings({ autoUpdate })}
            />
          </div>
        </div>
        <div className={`${styles.settingRow} ${styles.updateRow}`}>
          <SettingLabel title={updateStatus} description={t('settings.version', { version })} />
          <div className={styles.settingControl}>
            {update.state === 'downloaded' ? (
              <Button
                type="primary"
                {...(light ? { ghost: true as const } : {})}
                onClick={() => void desktopActions.installUpdate()}
              >
                {t('settings.installNow')}
              </Button>
            ) : (
              <Button
                icon={<RefreshCw size={14} />}
                loading={update.state === 'checking'}
                onClick={() => void desktopActions.checkForUpdates()}
              >
                {t('settings.checkUpdates')}
              </Button>
            )}
          </div>
          {update.state === 'downloading' && (
            <Progress percent={update.percent ?? 0} size="small" />
          )}
        </div>
        {update.releaseNotes && (
          <div className={styles.releaseNotes}>
            <strong>{t('settings.releaseNotes')}</strong>
            <pre>{update.releaseNotes}</pre>
          </div>
        )}
      </section>
    </div>
  )
}

export default UpdatesSettingsSection
