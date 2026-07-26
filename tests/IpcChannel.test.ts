/**
 * Verifies IPC channel naming conventions and that common channels are present.
 */

import { describe, expect, it } from 'vitest'
import { IpcChannel } from '../src/shared/IpcChannel'

describe('IpcChannel', () => {
  const channels = Object.values(IpcChannel)

  it('has no duplicate channel values', () => {
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('uses a colon-delimited namespace prefix for every channel', () => {
    for (const channel of channels) {
      expect(channel).toMatch(/^[a-z-]+:[a-z-]+$/)
    }
  })

  it('separates event channels with the "event:" prefix', () => {
    const events = channels.filter((c) => c.startsWith('event:'))
    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      expect(event).toMatch(/^event:[a-z-]+$/)
    }
  })

  it('includes the required bootstrap channel', () => {
    expect(channels).toContain('app:bootstrap')
  })

  it('includes the required settings channel', () => {
    expect(channels).toContain('settings:save')
  })

  it('includes the required credential channels', () => {
    expect(channels).toContain('credentials:save')
    expect(channels).toContain('credentials:get')
    expect(channels).toContain('credentials:delete')
  })

  it('includes the required session channels', () => {
    expect(channels).toContain('session:create')
    expect(channels).toContain('session:get')
    expect(channels).toContain('session:rename')
    expect(channels).toContain('session:delete')
    expect(channels).toContain('session:export')
  })

  it('includes the required window channels', () => {
    expect(channels).toContain('window:always-on-top')
    expect(channels).toContain('window:minimize')
    expect(channels).toContain('window:toggle-maximize')
    expect(channels).toContain('window:close')
    expect(channels).toContain('window:is-maximized')
    expect(channels).toContain('event:window-maximized-changed')
  })

  it('includes the required theme channel', () => {
    expect(channels).toContain('theme:set')
  })

  it('includes the required shell channel', () => {
    expect(channels).toContain('shell:open-external')
  })

  it('includes the required log channels', () => {
    expect(channels).toContain('logs:open-directory')
    expect(channels).toContain('logs:write')
  })

  it('includes the required update channels', () => {
    expect(channels).toContain('updates:check')
    expect(channels).toContain('updates:install')
  })

  it('includes the required error and update-state events', () => {
    expect(channels).toContain('event:error')
    expect(channels).toContain('event:update-state')
    expect(channels).toContain('event:settings-open-requested')
  })
})
