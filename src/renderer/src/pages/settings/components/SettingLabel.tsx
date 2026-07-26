/**
 * Renders the shared title and description block used by settings rows.
 */

import type { PropsWithChildren } from 'react'
import styles from '../SettingsPage.module.scss'

interface SettingLabelProps extends PropsWithChildren {
  title: string
  description: string
}

/** Displays one preference label with optional supporting content. */
const SettingLabel = ({ title, description, children }: SettingLabelProps): React.JSX.Element => (
  <div className={styles.settingLabel}>
    <strong>{title}</strong>
    <span>{description}</span>
    {children}
  </div>
)

export default SettingLabel
