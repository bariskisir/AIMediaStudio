/**
 * Verifies the renderer navigation allowlist rejects URL-prefix lookalikes.
 */

import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isTrustedRendererNavigation } from '../src/main/security/RendererNavigationPolicy'

const PACKAGED_PATH = 'C:\\App\\out\\renderer\\index.html'
const DEV_URL = 'http://localhost:5173/'

describe('isTrustedRendererNavigation', () => {
  describe('packaged (file://) mode', () => {
    it('allows the exact renderer document path', () => {
      expect(isTrustedRendererNavigation(pathToFileURL(PACKAGED_PATH).href, PACKAGED_PATH)).toBe(
        true,
      )
    })

    it('allows the renderer path with a hash fragment', () => {
      const url = pathToFileURL(PACKAGED_PATH)
      url.hash = 'settings'
      expect(isTrustedRendererNavigation(url.href, PACKAGED_PATH)).toBe(true)
    })

    it('rejects a different file in the same directory', () => {
      expect(
        isTrustedRendererNavigation(
          pathToFileURL('C:\\App\\out\\renderer\\unexpected.html').href,
          PACKAGED_PATH,
        ),
      ).toBe(false)
    })

    it('rejects a file outside the renderer directory', () => {
      expect(
        isTrustedRendererNavigation(
          pathToFileURL('C:\\Windows\\System32\\malicious.html').href,
          PACKAGED_PATH,
        ),
      ).toBe(false)
    })
  })

  describe('development (http://) mode', () => {
    it('allows the exact development origin', () => {
      expect(isTrustedRendererNavigation(DEV_URL, PACKAGED_PATH, DEV_URL)).toBe(true)
    })

    it('allows a path under the development origin', () => {
      expect(
        isTrustedRendererNavigation(
          'http://localhost:5173/settings?section=general',
          PACKAGED_PATH,
          DEV_URL,
        ),
      ).toBe(true)
    })

    it('rejects a lookalike origin with a host suffix', () => {
      expect(
        isTrustedRendererNavigation(
          'http://localhost:5173.evil.example/settings',
          PACKAGED_PATH,
          DEV_URL,
        ),
      ).toBe(false)
    })

    it('rejects a different port on the same host', () => {
      expect(isTrustedRendererNavigation('http://localhost:9999/', PACKAGED_PATH, DEV_URL)).toBe(
        false,
      )
    })

    it('rejects an https variant of the development origin', () => {
      expect(isTrustedRendererNavigation('https://localhost:5173/', PACKAGED_PATH, DEV_URL)).toBe(
        false,
      )
    })
  })

  describe('edge cases', () => {
    it('rejects completely malformed input', () => {
      expect(isTrustedRendererNavigation('not-a-url', PACKAGED_PATH)).toBe(false)
    })

    it('rejects empty strings', () => {
      expect(isTrustedRendererNavigation('', PACKAGED_PATH)).toBe(false)
    })
  })
})
