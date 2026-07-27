/**
 * Maps generation lifecycle states to consistent Ant Design status colors.
 */

import type { GenerationStatus } from '@shared/types'

/** Defines the semantic status colors accepted by Ant Design tags. */
export type GenerationStatusColor = 'success' | 'processing' | 'error' | 'warning' | 'default'

/** Identifies lifecycle states that must keep new generation submissions locked. */
export const isActiveGenerationStatus = (status: GenerationStatus | undefined): boolean =>
  status === 'submitting' || status === 'pending' || status === 'in_progress'

/** Returns one consistent color for output headers and history records. */
export const getGenerationStatusColor = (status: GenerationStatus): GenerationStatusColor => {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'cancelled' || status === 'expired') return 'warning'
  if (isActiveGenerationStatus(status)) return 'processing'
  return 'default'
}
