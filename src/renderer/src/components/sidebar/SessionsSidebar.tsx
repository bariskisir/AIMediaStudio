/**
 * Manages independent media generation session entries.
 */

import { useState } from 'react'
import { Button, Dropdown, Empty, Input, Modal, Tag, Tooltip, type MenuProps } from 'antd'
import { AudioLines, FileJson, Film, Image, Pencil, Plus, Trash2, Volume2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SessionSummary } from '@shared/types'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSessionActions } from '@renderer/hooks/useSessionActions'
import { useAppSelector } from '@renderer/store'
import { formatDate } from '@renderer/utils/formatters'
import { getGenerationStatusColor } from '@renderer/utils/generationStatus'
import styles from './SessionsSidebar.module.scss'

/** Renders create, open, rename, metadata export, and terminal deletion actions. */
const SessionsSidebar = (): React.JSX.Element => {
  const sessions = useAppSelector((state) => state.app.sessions)
  const currentSession = useAppSelector((state) => state.app.currentSession)
  const timeFormat = useAppSelector((state) => state.app.settings.timeFormat)
  const sidebarOpen = useAppSelector((state) => state.app.sessionsSidebarOpen)
  const actions = useSessionActions()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)

  /** Resolves a localized placeholder while preserving user and prompt-derived titles. */
  const displayTitle = (item: SessionSummary): string =>
    item.isDefaultTitle ? t('sessions.newSession') : item.title

  /** Opens the rename form with one session's visible title. */
  const beginRename = (item: SessionSummary): void => {
    setRenameTarget(item)
    setRenameValue(displayTitle(item))
  }

  /** Persists a valid title before dismissing the rename dialog. */
  const commitRename = async (): Promise<void> => {
    if (!renameTarget || !renameValue.trim()) return
    setRenaming(true)
    const succeeded = await actions.renameSession(renameTarget.id, renameValue)
    setRenaming(false)
    if (succeeded) setRenameTarget(null)
  }

  /** Prevents deletion while a provider can still update a session. */
  const canDelete = (item: SessionSummary): boolean => {
    if (sessions.length === 1 && !item.hasItem) return false
    return !['submitting', 'pending', 'in_progress'].includes(item.status ?? '')
  }

  /** The delete-all button is active when there are deletable sessions. */
  const canDeleteAll = sessions.some(canDelete)

  /** Iterates over deletable sessions sequentially to avoid races. */
  const deleteAllSessions = async (): Promise<void> => {
    if (deletingAll) return
    setDeletingAll(true)
    try {
      for (const { id } of sessions) {
        await actions.deleteSession(id)
      }
    } catch {
      /* ignore */
    }
    setDeletingAll(false)
  }

  /** Chooses an icon that distinguishes every durable media workflow. */
  const mediaIcon = (item: SessionSummary): React.JSX.Element => {
    if (item.mediaKind === 'video') return <Film size={14} />
    if (item.mediaKind === 'tts') return <Volume2 size={14} />
    if (item.mediaKind === 'stt') return <AudioLines size={14} />
    return <Image size={14} />
  }

  /** Builds the context menu for one history record. */
  const sessionMenu = (item: SessionSummary): MenuProps => ({
    items: [
      { key: 'rename', icon: <Pencil size={14} />, label: t('common.rename') },
      {
        key: 'export',
        icon: <FileJson size={14} />,
        label: t('sessions.exportJson'),
        disabled: !item.hasItem,
      },
      { type: 'divider' },
      {
        key: 'delete',
        danger: true,
        icon: <Trash2 size={14} />,
        label: t('common.delete'),
        disabled: !canDelete(item),
      },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation()
      if (key === 'rename') beginRename(item)
      if (key === 'export') void actions.exportSession(item.id)
      if (key === 'delete') void actions.deleteSession(item.id)
    },
  })

  return (
    <>
      <aside
        className={`${styles.container} ${sidebarOpen ? '' : styles.collapsed}`}
        aria-hidden={!sidebarOpen}
      >
        {sidebarOpen && (
          <>
            <header className={styles.header}>
              <span>{t('nav.sessions')}</span>
              <div className={styles.headerActions}>
                <Tooltip title={t('sessions.deleteAll')}>
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<Trash2 size={15} />}
                    disabled={!canDeleteAll || deletingAll}
                    onClick={() => void deleteAllSessions()}
                  />
                </Tooltip>
                <Tooltip title={t('sessions.newSession')}>
                  <Button
                    type="text"
                    size="small"
                    icon={<Plus size={15} />}
                    onClick={() => void actions.createSession()}
                  />
                </Tooltip>
              </div>
            </header>
            <div className={styles.scrollArea}>
              {sessions.length === 0 ? (
                <div className={styles.emptyWrap}>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t('sessions.emptyTitle')}
                  />
                </div>
              ) : (
                <div className={styles.list}>
                  {sessions.map((item) => (
                    <Dropdown key={item.id} menu={sessionMenu(item)} trigger={['contextMenu']}>
                      <div
                        className={`${styles.item} ${currentSession?.id === item.id ? styles.active : ''}`}
                      >
                        <button
                          type="button"
                          className={styles.openButton}
                          onClick={() => void actions.openSession(item.id)}
                        >
                          <span className={styles.fileIcon}>{mediaIcon(item)}</span>
                          <span className={styles.itemBody}>
                            <span className={styles.itemTitle}>{displayTitle(item)}</span>
                            <span className={styles.itemMeta}>
                              {formatDate(item.updatedAt, timeFormat)}
                            </span>
                            {item.status && (
                              <Tag
                                className={styles.statusTag ?? ''}
                                bordered={false}
                                color={getGenerationStatusColor(item.status)}
                              >
                                {item.status.replace('_', ' ')}
                              </Tag>
                            )}
                          </span>
                        </button>
                        <Tooltip title={t('common.delete')}>
                          <Button
                            className={styles.deleteButton ?? ''}
                            type="text"
                            danger
                            size="small"
                            disabled={!canDelete(item)}
                            icon={<Trash2 size={13} />}
                            onClick={() => void actions.deleteSession(item.id)}
                          />
                        </Tooltip>
                      </div>
                    </Dropdown>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </aside>
      <Modal
        title={t('sessions.renameSession')}
        open={renameTarget !== null}
        okText={t('common.rename')}
        cancelText={t('common.cancel')}
        confirmLoading={renaming}
        okButtonProps={{
          disabled: !renameValue.trim(),
          ...(theme === 'light' ? { ghost: true as const } : {}),
        }}
        onOk={() => void commitRename()}
        onCancel={() => setRenameTarget(null)}
        destroyOnHidden
      >
        <Input
          className={styles.renameInput}
          value={renameValue}
          maxLength={200}
          autoFocus
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => void commitRename()}
        />
      </Modal>
    </>
  )
}

export default SessionsSidebar
