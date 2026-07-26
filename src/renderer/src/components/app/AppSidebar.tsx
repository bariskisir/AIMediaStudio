/**
 * Renders the persistent Transcript sidebar and global window controls.
 */

import type { AppSettingsPatch } from '@shared/types'
import AppNavigationActions from './AppNavigationActions'
import styles from './AppSidebar.module.scss'

interface AppSidebarProps {
  onSettingsChange: (patch: AppSettingsPatch) => Promise<void>
}

/** Displays primary navigation, theme switching, pinning, and settings access. */
const AppSidebar = ({ onSettingsChange }: AppSidebarProps): React.JSX.Element => {
  return (
    <aside className={`${styles.container} no-drag`}>
      <AppNavigationActions placement="left" onSettingsChange={onSettingsChange} />
    </aside>
  )
}

export default AppSidebar
