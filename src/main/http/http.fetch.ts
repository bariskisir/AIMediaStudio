/**
 * Shared HTTP fetch helper routing outbound requests through Electron's network stack.
 *
 * Requests go through Electron's `net.fetch` (Chromium network stack) when running inside
 * the Electron main process, falling back to Node fetch otherwise (for example under Vitest).
 * The Chromium stack trusts the OS certificate store, so provider calls keep working behind
 * TLS-intercepting antivirus software or corporate proxies whose root CA is installed
 * system-wide but unknown to Node's bundled CA list.
 */

/** Fetch-compatible function signature shared by the Chromium and Node network stacks. */
export type HttpFetchFunction = typeof fetch

/**
 * Memoized Electron `net.fetch`, or null when the Chromium network stack is unavailable.
 * `undefined` means the implementation has not been resolved yet.
 */
let electronFetch: HttpFetchFunction | null | undefined

/**
 * Loads Electron's `net.fetch` when running inside the Electron main process.
 *
 * @returns Electron fetch function, or null when unavailable
 */
const loadElectronFetch = async (): Promise<HttpFetchFunction | null> => {
  try {
    const versions = (globalThis as { process?: { versions?: Record<string, string> } }).process
      ?.versions
    if (!versions || !('electron' in versions)) return null
    const electron = (await import('electron')) as unknown as { net?: { fetch?: unknown } }
    const candidate = electron.net?.fetch
    if (typeof candidate !== 'function') return null
    return (candidate as HttpFetchFunction).bind(electron.net)
  } catch {
    return null
  }
}

/**
 * Sends an HTTP request through the Chromium network stack when available, falling back
 * to Node fetch otherwise. The fallback reads `globalThis.fetch` lazily on every call so
 * test doubles installed via `vi.stubGlobal('fetch', ...)` keep working.
 *
 * Shared by provider catalogs, media transport, video downloads, update downloads, and
 * telemetry so every outbound HTTPS call trusts the OS certificate store inside Electron.
 *
 * @param input - Request URL or Request object
 * @param init - Optional fetch init options
 * @returns Fetch Response promise
 */
export const httpFetch = async (
  input: Parameters<HttpFetchFunction>[0],
  init?: Parameters<HttpFetchFunction>[1],
): Promise<Response> => {
  if (electronFetch === undefined) electronFetch = await loadElectronFetch()
  const implementation = electronFetch ?? globalThis.fetch
  return implementation(input, init)
}
