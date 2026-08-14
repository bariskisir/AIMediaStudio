/**
 * Renders application appearance and navbar layout preferences.
 */

import { Button, Segmented, Tooltip } from 'antd'
import { Minus, Monitor, Moon, PanelLeft, PanelTop, Plus, RotateCcw, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PAGE_ZOOM_LIMITS, type NavbarPosition, type ThemeMode } from '@shared/types'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppSelector } from '@renderer/store'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

/** Displays theme and primary navbar placement controls. */
const DisplaySettingsSection = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const settingsActions = useSettingsActions()
  const { t } = useTranslation()

  /** Persists a bounded page zoom change at the same tenth-step used by Electron. */
  const changePageZoom = (delta: number): void => {
    const pageZoom = Math.min(
      PAGE_ZOOM_LIMITS.max,
      Math.max(PAGE_ZOOM_LIMITS.min, Number((settings.pageZoom + delta).toFixed(1))),
    )
    void settingsActions.saveSettings({ pageZoom })
  }

  return (
    <div className={styles.settingContainer}>
      <h2 className={styles.groupTitle}>{t('settings.displaySettings')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel title={t('settings.theme')} description={t('settings.themeDescription')} />
          <div className={styles.settingControl}>
            <Segmented
              value={settings.theme}
              options={[
                {
                  value: 'light',
                  label: (
                    <span className={styles.segmentedOption}>
                      <Sun size={15} />
                      {t('themes.light')}
                    </span>
                  ),
                },
                {
                  value: 'dark',
                  label: (
                    <span className={styles.segmentedOption}>
                      <Moon size={15} />
                      {t('themes.dark')}
                    </span>
                  ),
                },
                {
                  value: 'system',
                  label: (
                    <span className={styles.segmentedOption}>
                      <Monitor size={15} />
                      {t('themes.system')}
                    </span>
                  ),
                },
              ]}
              onChange={(theme) => void settingsActions.saveSettings({ theme: theme as ThemeMode })}
            />
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.navbarPosition')}
            description={t('settings.navbarPositionDescription')}
          />
          <div className={styles.settingControl}>
            <Segmented
              value={settings.navbarPosition}
              options={[
                {
                  value: 'left',
                  label: (
                    <span className={styles.segmentedOption}>
                      <PanelLeft size={15} />
                      {t('settings.navbarPositions.left')}
                    </span>
                  ),
                },
                {
                  value: 'top',
                  label: (
                    <span className={styles.segmentedOption}>
                      <PanelTop size={15} />
                      {t('settings.navbarPositions.top')}
                    </span>
                  ),
                },
              ]}
              onChange={(navbarPosition) =>
                void settingsActions.saveSettings({
                  navbarPosition: navbarPosition as NavbarPosition,
                })
              }
            />
          </div>
        </div>
      </section>
      <h2 className={styles.groupTitle}>{t('settings.zoomSettings')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.pageZoom')}
            description={t('settings.pageZoomDescription')}
          />
          <div className={styles.zoomControl}>
            <Tooltip title={t('settings.zoomOut')}>
              <Button
                type="text"
                aria-label={t('settings.zoomOut')}
                disabled={settings.pageZoom <= PAGE_ZOOM_LIMITS.min}
                icon={<Minus size={15} />}
                onClick={() => changePageZoom(-PAGE_ZOOM_LIMITS.step)}
              />
            </Tooltip>
            <span className={styles.zoomValue}>{Math.round(settings.pageZoom * 100)}%</span>
            <Tooltip title={t('settings.zoomIn')}>
              <Button
                type="text"
                aria-label={t('settings.zoomIn')}
                disabled={settings.pageZoom >= PAGE_ZOOM_LIMITS.max}
                icon={<Plus size={15} />}
                onClick={() => changePageZoom(PAGE_ZOOM_LIMITS.step)}
              />
            </Tooltip>
            <Tooltip title={t('settings.resetZoom')}>
              <Button
                type="text"
                aria-label={t('settings.resetZoom')}
                disabled={settings.pageZoom === PAGE_ZOOM_LIMITS.default}
                icon={<RotateCcw size={15} />}
                onClick={() =>
                  void settingsActions.saveSettings({ pageZoom: PAGE_ZOOM_LIMITS.default })
                }
              />
            </Tooltip>
          </div>
        </div>
      </section>
    </div>
  )
}

export default DisplaySettingsSection
