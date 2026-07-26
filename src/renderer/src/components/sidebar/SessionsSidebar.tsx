/**
 * Manages saved transcription sessions in the collapsible workspace sidebar.
 */

import { useState } from 'react'
import { Button, Dropdown, Empty, Input, Modal, Tooltip, type MenuProps } from 'antd'
import { Download, FileDown, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SessionSummary } from '@shared/types'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSessionActions } from '@renderer/hooks/useSessionActions'
import { useAppSelector } from '@renderer/store'
import { formatDate, formatDuration } from '@renderer/utils/formatters'
import styles from './SessionsSidebar.module.scss'

/** Renders new, open, export, delete, and collapse actions for locally persisted sessions. */
const SessionsSidebar = (): React.JSX.Element => {
  const sessions = useAppSelector((state) => state.app.sessions)
  const currentSession = useAppSelector((state) => state.app.currentSession)
  const session = useAppSelector((state) => state.app.session.state)
  const timeFormat = useAppSelector((state) => state.app.settings.timeFormat)
  const sidebarOpen = useAppSelector((state) => state.app.sessionsSidebarOpen)
  const actions = useSessionActions()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const light = theme === 'light'
  const recordingActive = session !== 'idle'
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)

  /** Resolves a generated title from the active interface locale while preserving custom names. */
  const displayTitle = (item: SessionSummary): string =>
    item.isDefaultTitle ? t('sessions.newSession') : item.title

  /** Opens the rename dialog with the selected session's current title. */
  const beginRename = (item: SessionSummary): void => {
    setRenameTarget(item)
    setRenameValue(displayTitle(item))
  }

  /** Persists the edited title and closes the dialog after a successful update. */
  const commitRename = async (): Promise<void> => {
    if (!renameTarget || !renameValue.trim()) return
    setRenaming(true)
    const renamed = await actions.renameSession(renameTarget.id, renameValue.trim())
    setRenaming(false)
    if (renamed) setRenameTarget(null)
  }

  /** Deletes every session that can be removed and selects the first remaining workspace. */
  const deleteAllSessions = async (): Promise<void> => {
    if (deletingAll) return
    setDeletingAll(true)
    try {
      const ids = [...sessions].map((s) => s.id)
      for (const id of ids) {
        await actions.deleteSession(id)
      }
    } catch {
      /* ignore */
    }
    setDeletingAll(false)
  }

  /** Exports every session as individual files in the requested format. */
  const exportAllSessions = async (format: 'txt' | 'json'): Promise<void> => {
    for (const item of sessions) {
      if (item.segmentCount > 0) await actions.exportSession(item.id, format)
    }
  }

  /** Determines whether a session may be deleted (at least one session must remain). */
  const canDelete = (item: SessionSummary): boolean => {
    if (sessions.length <= 1 && item.segmentCount === 0) return false
    return true
  }

  const isSingleEmptySession = sessions.length === 1 && sessions[0]?.segmentCount === 0
  const isDeleteAllDisabled =
    recordingActive || deletingAll || sessions.length === 0 || isSingleEmptySession
  const isExportAllDisabled = recordingActive || sessions.length === 0 || isSingleEmptySession

  /** Builds the right-click context menu for a single session row. */
  const sessionMenu = (item: SessionSummary): MenuProps => ({
    items: [
      { key: 'rename', icon: <Pencil size={14} />, label: t('common.rename') },
      { type: 'divider' },
      {
        key: 'export-txt',
        icon: <FileDown size={14} />,
        label: t('sessions.exportTxt'),
        disabled: item.segmentCount === 0,
      },
      {
        key: 'export-json',
        icon: <FileDown size={14} />,
        label: t('sessions.exportJson'),
        disabled: item.segmentCount === 0,
      },
      {
        key: 'export-all-txt',
        icon: <Download size={14} />,
        label: t('sessions.exportTxtAll'),
        disabled: isSingleEmptySession,
      },
      {
        key: 'export-all-json',
        icon: <Download size={14} />,
        label: t('sessions.exportJsonAll'),
        disabled: isSingleEmptySession,
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
      if (key === 'export-txt') void actions.exportSession(item.id, 'txt')
      if (key === 'export-json') void actions.exportSession(item.id, 'json')
      if (key === 'export-all-txt') void exportAllSessions('txt')
      if (key === 'export-all-json') void exportAllSessions('json')
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
                    disabled={isDeleteAllDisabled}
                    onClick={() => void deleteAllSessions()}
                  />
                </Tooltip>
                <Dropdown
                  disabled={isExportAllDisabled}
                  menu={{
                    items: [
                      {
                        key: 'export-all-txt',
                        icon: <Download size={14} />,
                        label: t('sessions.exportTxtAll'),
                      },
                      {
                        key: 'export-all-json',
                        icon: <Download size={14} />,
                        label: t('sessions.exportJsonAll'),
                      },
                    ],
                    onClick: ({ key }) => {
                      if (key === 'export-all-txt') void exportAllSessions('txt')
                      if (key === 'export-all-json') void exportAllSessions('json')
                    },
                  }}
                  trigger={['click']}
                >
                  <Tooltip title={t('sessions.exportAll')}>
                    <Button
                      type="text"
                      size="small"
                      icon={<Download size={15} />}
                      disabled={isExportAllDisabled}
                    />
                  </Tooltip>
                </Dropdown>
                <Tooltip title={t('sessions.newSession')}>
                  <Button
                    type="text"
                    size="small"
                    disabled={recordingActive}
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
                    <Dropdown
                      key={item.id}
                      menu={sessionMenu(item)}
                      trigger={['contextMenu']}
                      disabled={recordingActive}
                    >
                      <div
                        className={`${styles.item} ${currentSession?.id === item.id ? styles.active : ''}`}
                      >
                        <button
                          type="button"
                          className={styles.openButton}
                          disabled={recordingActive}
                          onClick={() => void actions.openSession(item.id)}
                        >
                          <span className={styles.fileIcon}>
                            <FileText size={14} />
                          </span>
                          <span className={styles.itemBody}>
                            <span className={styles.itemTitle}>{displayTitle(item)}</span>
                            <span className={styles.itemMeta}>
                              {formatDate(item.createdAt, timeFormat)} ·{' '}
                              {formatDuration(item.durationMs)}
                            </span>
                          </span>
                        </button>
                        <Tooltip title={t('common.delete')}>
                          <Button
                            className={styles.deleteButton ?? ''}
                            type="text"
                            danger
                            size="small"
                            disabled={recordingActive || !canDelete(item)}
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
          ...(light ? { ghost: true as const } : {}),
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
          placeholder={t('sessions.renameSession')}
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => void commitRename()}
        />
      </Modal>
    </>
  )
}

export default SessionsSidebar
