/**
 * Renders the draggable desktop title bar and workspace navigation controls.
 */

import { Button, Tooltip } from 'antd'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import logoUrl from '../../../../../build/icon.svg'
import type { AppSettingsPatch } from '@shared/types'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setPage, setSessionsSidebarOpen } from '@renderer/store/appSlice'
import AppNavigationActions from './AppNavigationActions'
import WindowControls from './WindowControls'
import styles from './Titlebar.module.scss'

interface TitlebarProps {
  onSettingsChange: (patch: AppSettingsPatch) => Promise<void>
}

/** Places home, history, global settings, and native window controls in one bar. */
const Titlebar = ({ onSettingsChange }: TitlebarProps): React.JSX.Element => {
  const dispatch = useAppDispatch()
  const page = useAppSelector((state) => state.app.page)
  const sidebarOpen = useAppSelector((state) => state.app.sessionsSidebarOpen)
  const navbarPosition = useAppSelector((state) => state.app.settings.navbarPosition)
  const platform = useAppSelector((state) => state.app.platform)
  const { t } = useTranslation()

  return (
    <header
      className={`${styles.container} ${platform === 'darwin' ? styles.nativeWindowControls : ''} drag-region`}
    >
      <div className={`${styles.topActions} no-drag`}>
        <Tooltip placement="bottom" title="AI Media Studio">
          <Button
            className={styles.titleButton ?? ''}
            type="text"
            icon={<img className={styles.titleLogo} src={logoUrl} alt="" />}
            onClick={() => dispatch(setPage('home'))}
          />
        </Tooltip>
        {page === 'home' && (
          <Tooltip
            placement="bottom"
            title={t(sidebarOpen ? 'sidebar.hideSidebar' : 'sidebar.showSidebar')}
          >
            <Button
              className={styles.titleButton ?? ''}
              type="text"
              icon={sidebarOpen ? <PanelLeftClose size={18} /> : <PanelRightClose size={18} />}
              onClick={() => dispatch(setSessionsSidebarOpen(!sidebarOpen))}
            />
          </Tooltip>
        )}
      </div>
      <div className={styles.rightActions}>
        {navbarPosition === 'top' && (
          <AppNavigationActions placement="top" onSettingsChange={onSettingsChange} />
        )}
        <WindowControls />
      </div>
    </header>
  )
}

export default Titlebar
