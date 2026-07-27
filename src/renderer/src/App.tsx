/**
 * Composes the reusable desktop shell, media workspace, settings, and update notice.
 */

import { lazy, Suspense } from 'react'
import { Button, Spin } from 'antd'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './App.module.scss'
import AppSidebar from '@renderer/components/app/AppSidebar'
import Titlebar from '@renderer/components/app/Titlebar'
import { useAppInit } from '@renderer/hooks/useAppInit'
import { useDesktopActions } from '@renderer/hooks/useDesktopActions'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import HomePage from '@renderer/pages/home/HomePage'
import { useAppSelector } from '@renderer/store'

const SettingsPage = lazy(() => import('@renderer/pages/settings/SettingsPage'))

/** Renders application pages after main-process bootstrap completes. */
const App = (): React.JSX.Element => {
  useAppInit()
  const initialized = useAppSelector((state) => state.app.initialized)
  const page = useAppSelector((state) => state.app.page)
  const navbarPosition = useAppSelector((state) => state.app.settings.navbarPosition)
  const update = useAppSelector((state) => state.app.update)
  const desktopActions = useDesktopActions()
  const settingsActions = useSettingsActions()
  const { t } = useTranslation()

  if (!initialized) {
    return (
      <div className={styles.loadingScreen}>
        <Spin size="small" />
        <span>{t('common.loading')}</span>
      </div>
    )
  }

  return (
    <div className={styles.shell}>
      <Titlebar onSettingsChange={settingsActions.saveSettings} />
      <div className={styles.body}>
        {navbarPosition === 'left' && (
          <AppSidebar onSettingsChange={settingsActions.saveSettings} />
        )}
        <div className={styles.workspace}>
          {page === 'home' ? (
            <HomePage />
          ) : (
            <Suspense fallback={<Spin className={styles.pageSpinner ?? ''} size="small" />}>
              <SettingsPage />
            </Suspense>
          )}
        </div>
      </div>
      {update.state === 'downloaded' && (
        <div className={styles.updateNotice}>
          <Download size={15} />
          <span>{t('settings.readyToInstall', { version: update.version })}</span>
          <Button size="small" type="primary" onClick={() => void desktopActions.installUpdate()}>
            {t('settings.installNow')}
          </Button>
        </div>
      )}
    </div>
  )
}

export default App
