/**
 * Retrieves published Transcript releases and downloads verified Windows installers from GitHub.
 */

import { createHash } from 'node:crypto'
import { mkdir, open, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { APP_REPO } from '@shared/appInfo'

const RELEASES_API_URL = `https://api.github.com/repos/${APP_REPO}/releases/latest`
const GITHUB_ORIGIN = 'https://github.com'
const RELEASE_DOWNLOAD_PATH_PREFIX = `/${APP_REPO}/releases/download/`
const RELEASE_CACHE_DURATION_MS = 5 * 60 * 1_000
const REQUEST_TIMEOUT_MS = 10 * 60 * 1_000

const releaseAssetSchema = z.object({
  name: z.string().min(1),
  browser_download_url: z.url(),
  size: z.number().int().positive(),
  digest: z.string().nullable().optional(),
})

const releaseSchema = z.object({
  tag_name: z.string().min(1),
  name: z.string().nullable(),
  body: z.string().nullable(),
  html_url: z.url(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(releaseAssetSchema),
})

export interface GitHubReleaseAsset {
  name: string
  downloadUrl: string
  size: number
  digest?: string
}

export interface GitHubRelease {
  version: string
  name: string
  releaseNotes?: string
  pageUrl: string
  assets: GitHubReleaseAsset[]
}

export interface DownloadedRelease {
  filePath: string
  sha256: string
}

export type DownloadProgressListener = (percent: number) => void

type Fetcher = typeof globalThis.fetch

/** Converts a stable Git tag or application version into comparable numeric parts. */
const parseVersion = (version: string): readonly [number, number, number] => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim())
  if (!match) throw new Error(`Unsupported release version: ${version}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Returns whether a candidate stable release is newer than the installed application. */
export const isNewerVersion = (candidate: string, installed: string): boolean => {
  const candidateParts = parseVersion(candidate)
  const installedParts = parseVersion(installed)
  for (let index = 0; index < candidateParts.length; index += 1) {
    const candidatePart = candidateParts[index] ?? 0
    const installedPart = installedParts[index] ?? 0
    if (candidatePart !== installedPart) return candidatePart > installedPart
  }
  return false
}

/** Maps Electron's architecture identifier to the release asset naming convention. */
const getReleaseArchitecture = (architecture: NodeJS.Architecture): 'x64' | 'arm64' => {
  if (architecture === 'x64' || architecture === 'arm64') return architecture
  throw new Error(`Application updates are not available for ${architecture} Windows builds.`)
}

/** Locates the exact setup executable produced for the current Windows architecture. */
export const selectWindowsInstaller = (
  release: GitHubRelease,
  architecture: NodeJS.Architecture,
): GitHubReleaseAsset => {
  const releaseArchitecture = getReleaseArchitecture(architecture)
  const expectedName = `transcript-${release.version}-windows-${releaseArchitecture}-setup.exe`
  const asset = release.assets.find(
    (candidate) => candidate.name.toLowerCase() === expectedName.toLowerCase(),
  )
  if (!asset) throw new Error(`Release ${release.version} does not contain ${expectedName}.`)
  return asset
}

export default class GitHubReleaseClient {
  private cachedRelease: { release: GitHubRelease; expiresAt: number } | null = null
  private latestReleaseRequest: Promise<GitHubRelease> | null = null

  /** Creates a release client with an injectable Fetch implementation for deterministic tests. */
  public constructor(private readonly fetcher: Fetcher = globalThis.fetch) {}

  /** Retrieves and validates the latest public, stable GitHub release. */
  public async getLatestRelease(): Promise<GitHubRelease> {
    if (this.cachedRelease && this.cachedRelease.expiresAt > Date.now()) {
      return this.cachedRelease.release
    }
    if (!this.latestReleaseRequest) this.latestReleaseRequest = this.fetchLatestRelease()
    try {
      const release = await this.latestReleaseRequest
      this.cachedRelease = { release, expiresAt: Date.now() + RELEASE_CACHE_DURATION_MS }
      return release
    } finally {
      this.latestReleaseRequest = null
    }
  }

  /** Requests the latest release from the same public GitHub REST endpoint used by UsageBar. */
  private async fetchLatestRelease(): Promise<GitHubRelease> {
    const response = await this.fetcher(RELEASES_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Transcript-Desktop',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      throw new Error(`GitHub release request failed with HTTP ${response.status}.`)
    }
    return this.parseApiRelease(response)
  }

  /** Converts one validated GitHub REST response into the internal release contract. */
  private async parseApiRelease(response: Response): Promise<GitHubRelease> {
    const parsed = releaseSchema.parse(await response.json())
    if (parsed.draft || parsed.prerelease) {
      throw new Error('GitHub returned a release that is not a public stable release.')
    }
    const version = parsed.tag_name.replace(/^v/i, '')
    parseVersion(version)
    return {
      version,
      name: parsed.name ?? `Transcript v${version}`,
      ...(parsed.body ? { releaseNotes: parsed.body } : {}),
      pageUrl: parsed.html_url,
      assets: parsed.assets.map((asset) => ({
        name: asset.name,
        downloadUrl: asset.browser_download_url,
        size: asset.size,
        ...(asset.digest ? { digest: asset.digest } : {}),
      })),
    }
  }

  /** Streams an installer directly to the update directory and verifies its size and digest. */
  public async downloadInstaller(
    asset: GitHubReleaseAsset,
    destinationDirectory: string,
    onProgress: DownloadProgressListener,
  ): Promise<DownloadedRelease> {
    this.assertTrustedAsset(asset)
    await mkdir(destinationDirectory, { recursive: true })
    const filePath = join(destinationDirectory, asset.name)
    const response = await this.fetcher(asset.downloadUrl, {
      headers: { 'User-Agent': 'Transcript-Desktop' },
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok || !response.body) {
      throw new Error(`Update download failed with HTTP ${response.status}.`)
    }

    const handle = await open(filePath, 'w')
    const hash = createHash('sha256')
    const reader = response.body.getReader()
    let bytesWritten = 0
    let lastProgress = -1
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        await handle.write(chunk.value)
        hash.update(chunk.value)
        bytesWritten += chunk.value.byteLength
        const progress = Math.min(100, Math.floor((bytesWritten / asset.size) * 100))
        if (progress !== lastProgress) {
          lastProgress = progress
          onProgress(progress)
        }
      }
    } catch (error) {
      await handle.close()
      await unlink(filePath).catch(() => undefined)
      throw error
    }
    await handle.close()

    if (bytesWritten !== asset.size) {
      await unlink(filePath).catch(() => undefined)
      throw new Error(
        `Update size verification failed: expected ${asset.size}, received ${bytesWritten}.`,
      )
    }
    const sha256 = hash.digest('hex')
    if (asset.digest && asset.digest.toLowerCase() !== `sha256:${sha256}`) {
      await unlink(filePath).catch(() => undefined)
      throw new Error('Update checksum verification failed.')
    }
    onProgress(100)
    return { filePath, sha256 }
  }

  /** Rejects asset names and URLs that could escape the expected GitHub release boundary. */
  private assertTrustedAsset(asset: GitHubReleaseAsset): void {
    if (basename(asset.name) !== asset.name || !asset.name.toLowerCase().endsWith('-setup.exe')) {
      throw new Error('GitHub returned an invalid update asset name.')
    }
    let downloadUrl: URL
    let decodedFileName: string
    try {
      downloadUrl = new URL(asset.downloadUrl)
      const encodedFileName = downloadUrl.pathname.split('/').at(-1)
      decodedFileName = encodedFileName ? decodeURIComponent(encodedFileName) : ''
    } catch {
      throw new Error('GitHub returned an invalid update download URL.')
    }
    const normalizedPath = downloadUrl.pathname.toLowerCase()
    const hasExpectedFileName = decodedFileName.toLowerCase() === asset.name.toLowerCase()
    if (
      downloadUrl.origin.toLowerCase() !== GITHUB_ORIGIN ||
      downloadUrl.username ||
      downloadUrl.password ||
      downloadUrl.search ||
      downloadUrl.hash ||
      !normalizedPath.startsWith(RELEASE_DOWNLOAD_PATH_PREFIX) ||
      !hasExpectedFileName
    ) {
      throw new Error('GitHub returned an untrusted update download URL.')
    }
  }
}
