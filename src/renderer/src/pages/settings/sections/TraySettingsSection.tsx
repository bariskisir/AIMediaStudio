/**
 * Renders system-tray icon and tray-dependent startup preferences.
 */

import { Switch, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppSelector } from '@renderer/store'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

/** Displays system-tray and startup minimization controls. */
const TraySettingsSection = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const platform = useAppSelector((state) => state.app.platform)
  const settingsActions = useSettingsActions()
  const { t } = useTranslation()
  const trayUnavailable = platform === 'linux'

  /** Keeps tray-dependent options disabled whenever their required tray icon is removed. */
  const changeTrayIcon = (showTrayIcon: boolean): void => {
    void settingsActions.saveSettings({
      showTrayIcon,
      ...(showTrayIcon ? {} : { minimizeToTrayOnClose: false, startMinimized: false }),
    })
  }

  /** Enables the required tray icon when close-to-tray is selected. */
  const changeMinimizeToTray = (minimizeToTrayOnClose: boolean): void => {
    void settingsActions.saveSettings({
      minimizeToTrayOnClose,
      ...(minimizeToTrayOnClose ? { showTrayIcon: true } : {}),
    })
  }

  /** Enables the required tray icon when minimized startup is selected. */
  const changeStartMinimized = (startMinimized: boolean): void => {
    void settingsActions.saveSettings({
      startMinimized,
      ...(startMinimized ? { showTrayIcon: true } : {}),
    })
  }

  return (
    <div className={styles.settingContainer}>
      <h2 className={styles.groupTitle}>{t('settings.traySettings')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.showTrayIcon')}
            description={t('settings.showTrayIconDescription')}
          />
          <div className={styles.settingControl}>
            <Tooltip title={trayUnavailable ? t('settings.trayUnavailable') : undefined}>
              <Switch
                checked={settings.showTrayIcon}
                disabled={trayUnavailable}
                onChange={changeTrayIcon}
              />
            </Tooltip>
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.minimizeToTrayOnClose')}
            description={t('settings.minimizeToTrayOnCloseDescription')}
          />
          <div className={styles.settingControl}>
            <Tooltip title={trayUnavailable ? t('settings.trayUnavailable') : undefined}>
              <Switch
                checked={settings.minimizeToTrayOnClose}
                disabled={trayUnavailable}
                onChange={changeMinimizeToTray}
              />
            </Tooltip>
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.startMinimized')}
            description={t('settings.startMinimizedDescription')}
          />
          <div className={styles.settingControl}>
            <Tooltip title={trayUnavailable ? t('settings.trayUnavailable') : undefined}>
              <Switch
                checked={settings.startMinimized}
                disabled={trayUnavailable}
                onChange={changeStartMinimized}
              />
            </Tooltip>
          </div>
        </div>
      </section>
    </div>
  )
}

export default TraySettingsSection
