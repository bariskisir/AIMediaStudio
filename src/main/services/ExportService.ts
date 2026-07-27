/**
 * Renders portable JSON metadata without credentials, base64 content, or local paths.
 */

import type { SessionDocument } from '@shared/types'

/** Serializes one generation session as stable, human-readable JSON metadata. */
export const renderSessionMetadata = (session: SessionDocument): string =>
  `${JSON.stringify(session, null, 2)}\n`
