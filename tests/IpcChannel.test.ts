/**
 * Verifies the IPC surface contains file-based media generation and no capture commands.
 */

import { describe, expect, it } from 'vitest'
import { IpcChannel } from '../src/shared/IpcChannel'

describe('IpcChannel', () => {
  it('exposes dedicated media commands', () => {
    expect(Object.values(IpcChannel)).toContain('generation:start')
    expect(Object.values(IpcChannel)).toContain('media:save')
    expect(Object.values(IpcChannel)).toContain('references:select')
    expect(Object.values(IpcChannel)).toContain('audio-input:select')
  })

  it('does not expose recording or translation channels', () => {
    const channels = Object.values(IpcChannel).join(' ')
    expect(channels).not.toMatch(/recording|microphone|speaker|translation|transcript-result/)
  })
})
