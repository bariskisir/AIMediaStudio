/**
 * Renders application identity, author, repository, and support links.
 */

import { Button, Tag } from 'antd'
import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { APP_AUTHOR, APP_AUTHOR_URL, APP_REPO, APP_REPO_URL } from '@shared/appInfo'
import logoUrl from '../../../../../../build/icon.svg'
import { useDesktopActions } from '@renderer/hooks/useDesktopActions'
import { useAppSelector } from '@renderer/store'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

/** Displays reusable application metadata and project links. */
const AboutSettingsSection = (): React.JSX.Element => {
  const version = useAppSelector((state) => state.app.version)
  const desktopActions = useDesktopActions()
  const { t } = useTranslation()

  return (
    <div className={styles.settingContainer}>
      <div className={styles.aboutHero}>
        <img src={logoUrl} alt="" />
        <h2>{t('app.name')}</h2>
        <p>{t('app.tagline')}</p>
        <Tag>v{version}</Tag>
      </div>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel title={t('settings.author')} description={APP_AUTHOR} />
          <Button
            type="text"
            icon={<ExternalLink size={14} />}
            onClick={() => void desktopActions.openExternal(APP_AUTHOR_URL)}
          />
        </div>
        <div className={styles.settingRow}>
          <SettingLabel title={t('settings.sourceCode')} description={APP_REPO} />
          <Button
            type="text"
            icon={<ExternalLink size={14} />}
            onClick={() => void desktopActions.openExternal(APP_REPO_URL)}
          />
        </div>
      </section>
    </div>
  )
}

export default AboutSettingsSection
