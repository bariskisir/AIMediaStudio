/**
 * Defines the renderer navigation allowlist independently from Electron window state.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Compares paths with the host platform's case-sensitivity rules. */
const pathsMatch = (candidate: string, trusted: string): boolean => {
  const candidatePath = resolve(candidate)
  const trustedPath = resolve(trusted)
  return process.platform === 'win32'
    ? candidatePath.toLowerCase() === trustedPath.toLowerCase()
    : candidatePath === trustedPath
}

/** Allows the packaged renderer file or a page served by the exact development origin. */
export const isTrustedRendererNavigation = (
  candidateUrl: string,
  packagedRendererPath: string,
  developmentUrl?: string,
): boolean => {
  try {
    const candidate = new URL(candidateUrl)
    if (developmentUrl) {
      const trustedDevelopmentUrl = new URL(developmentUrl)
      return (
        (candidate.protocol === 'http:' || candidate.protocol === 'https:') &&
        candidate.origin === trustedDevelopmentUrl.origin
      )
    }
    return (
      candidate.protocol === 'file:' && pathsMatch(fileURLToPath(candidate), packagedRendererPath)
    )
  } catch {
    return false
  }
}
