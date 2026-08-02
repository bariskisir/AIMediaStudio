/** Verifies durable window-state validation and connected-display restoration. */

import { describe, expect, it } from 'vitest'
import { fitWindowBoundsToDisplays, parsePersistedWindowState } from '../src/main/windowState'

describe('parsePersistedWindowState', () => {
  it('accepts valid normal bounds and display modes', () => {
    const state = {
      revision: 1 as const,
      bounds: { x: -900, y: 40, width: 800, height: 600 },
      maximized: true,
      fullScreen: false,
    }
    expect(parsePersistedWindowState(state)).toEqual(state)
  })

  it('rejects malformed or unbounded coordinates', () => {
    expect(parsePersistedWindowState({ revision: 1, bounds: null })).toBeNull()
    expect(
      parsePersistedWindowState({
        revision: 1,
        bounds: { x: 1_000_000, y: 0, width: 800, height: 600 },
        maximized: false,
        fullScreen: false,
      }),
    ).toBeNull()
  })
})

describe('fitWindowBoundsToDisplays', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 }
  const secondary = { x: -1280, y: 0, width: 1280, height: 984 }

  it('keeps bounds on the connected display where the window was left', () => {
    expect(
      fitWindowBoundsToDisplays({ x: -1100, y: 80, width: 900, height: 700 }, [primary, secondary]),
    ).toEqual({ x: -1100, y: 80, width: 900, height: 700 })
  })

  it('fits oversized saved bounds into the matching work area', () => {
    expect(
      fitWindowBoundsToDisplays({ x: 120, y: 30, width: 2400, height: 1400 }, [primary]),
    ).toEqual(primary)
  })

  it('declines coordinates left on a disconnected display', () => {
    expect(
      fitWindowBoundsToDisplays({ x: -1200, y: 100, width: 800, height: 600 }, [primary]),
    ).toBeNull()
  })
})
