/**
 * Validates persisted desktop-window state and restores bounds only on connected displays.
 */

import { z } from 'zod'

/** Describes one rectangular desktop region in physical Electron coordinates. */
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Stores the last normal bounds and native display mode of the main window. */
export interface PersistedWindowState {
  revision: 1
  bounds: WindowBounds
  maximized: boolean
  fullScreen: boolean
}

const boundsSchema = z.object({
  x: z.number().int().min(-100_000).max(100_000),
  y: z.number().int().min(-100_000).max(100_000),
  width: z.number().int().min(1).max(100_000),
  height: z.number().int().min(1).max(100_000),
})

const windowStateSchema = z.object({
  revision: z.literal(1),
  bounds: boundsSchema,
  maximized: z.boolean(),
  fullScreen: z.boolean(),
})

/** Returns validated persisted state or null when the stored document is malformed. */
export const parsePersistedWindowState = (input: unknown): PersistedWindowState | null => {
  const parsed = windowStateSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

/** Calculates the overlapping area shared by two rectangles. */
const intersectionArea = (left: WindowBounds, right: WindowBounds): number => {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  )
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  )
  return width * height
}

/** Clamps one coordinate between inclusive lower and upper bounds. */
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum)

/**
 * Fits saved bounds inside the connected work area they overlap most, or declines stale
 * off-screen coordinates so Electron can use its centered default.
 */
export const fitWindowBoundsToDisplays = (
  bounds: WindowBounds,
  workAreas: WindowBounds[],
): WindowBounds | null => {
  let bestWorkArea: WindowBounds | null = null
  let bestIntersection = 0
  for (const workArea of workAreas) {
    const area = intersectionArea(bounds, workArea)
    if (area <= bestIntersection) continue
    bestIntersection = area
    bestWorkArea = workArea
  }
  if (!bestWorkArea) return null

  const width = Math.min(bounds.width, bestWorkArea.width)
  const height = Math.min(bounds.height, bestWorkArea.height)
  return {
    x: clamp(bounds.x, bestWorkArea.x, bestWorkArea.x + bestWorkArea.width - width),
    y: clamp(bounds.y, bestWorkArea.y, bestWorkArea.y + bestWorkArea.height - height),
    width,
    height,
  }
}
