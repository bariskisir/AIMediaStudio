/**
 * Renders global window and settings actions in either sidebar or titlebar form.
 */

import { Button, Tooltip } from 'antd'
import { Monitor, Moon, Pin, PinOff, Settings, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { AppSettingsPatch, NavbarPosition, ThemeMode } from '@shared/types'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setPage } from '@renderer/store/appSlice'
import styles from './AppNavigationActions.module.scss'

interface AppNavigationActionsProps {
  placement: NavbarPosition
  onSettingsChange: (patch: AppSettingsPatch) => Promise<void>
}

const NEXT_THEME: Record<ThemeMode, ThemeMode> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
}

/** Displays pinning, theme, and settings actions in the configured navbar. */
const AppNavigationActions = ({
  placement,
  onSettingsChange,
}: AppNavigationActionsProps): React.JSX.Element => {
  const dispatch = useAppDispatch()
  const page = useAppSelector((state) => state.app.page)
  const settings = useAppSelector((state) => state.app.settings)
  const { t } = useTranslation()
  const { theme } = useTheme()
  const light = theme === 'light'
  const tooltipPlacement = placement === 'left' ? 'right' : 'bottom'
  const iconSize = placement === 'top' ? 16 : 18

  /** Returns the icon matching the persisted theme preference. */
  const themeIcon = (): React.JSX.Element => {
    if (settings.theme === 'light') return <Sun size={iconSize} />
    if (settings.theme === 'dark') return <Moon size={iconSize} />
    return <Monitor size={iconSize} />
  }

  return (
    <div className={`${styles.container} ${styles[placement]} no-drag`}>
      <Tooltip placement={tooltipPlacement} title={t('settings.alwaysOnTop')}>
        <Button
          className={styles.actionButton ?? ''}
          {...(settings.alwaysOnTop
            ? { type: 'primary' as const, ...(light ? { ghost: true as const } : {}) }
            : { type: 'text' as const })}
          icon={settings.alwaysOnTop ? <Pin size={iconSize} /> : <PinOff size={iconSize} />}
          onClick={() => void onSettingsChange({ alwaysOnTop: !settings.alwaysOnTop })}
        />
      </Tooltip>
      <Tooltip placement={tooltipPlacement} title={t(`themes.${settings.theme}`)}>
        <Button
          className={styles.actionButton ?? ''}
          type="text"
          icon={themeIcon()}
          onClick={() => void onSettingsChange({ theme: NEXT_THEME[settings.theme] })}
        />
      </Tooltip>
      <Tooltip placement={tooltipPlacement} title={t('nav.settings')}>
        <Button
          className={styles.actionButton ?? ''}
          {...(page === 'settings'
            ? { type: 'primary' as const, ...(light ? { ghost: true as const } : {}) }
            : { type: 'text' as const })}
          icon={<Settings size={iconSize} />}
          onClick={() => dispatch(setPage('settings'))}
        />
      </Tooltip>
    </div>
  )
}

export default AppNavigationActions
