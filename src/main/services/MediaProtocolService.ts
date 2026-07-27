/**
 * Serves application-owned media through a secure stream-capable custom protocol.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { net, protocol, type Session } from 'electron'
import type MediaAssetService from './MediaAssetService'
import { parseMediaByteRange } from './MediaRange'
import type ReferenceImageService from './ReferenceImageService'

const MEDIA_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mpeg': 'video/mpeg',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pcm': 'audio/pcm',
  '.wav': 'audio/wav',
}

/** Resolves an application-owned media MIME type from its persisted extension. */
const contentTypeForPath = (path: string): string =>
  MEDIA_CONTENT_TYPES[extname(path).toLocaleLowerCase('en-US')] ?? 'application/octet-stream'

/** Registers scheme privileges before Electron becomes ready. */
export const registerMediaScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'aimedia',
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
    },
  ])
}

export default class MediaProtocolService {
  /** Creates a resolver for durable outputs and short-lived reference previews. */
  public constructor(
    private readonly assets: MediaAssetService,
    private readonly references: ReferenceImageService,
  ) {}

  /** Attaches the protocol to the same isolated session used by the renderer window. */
  public attach(electronSession: Session): void {
    if (electronSession.protocol.isProtocolHandled('aimedia')) {
      electronSession.protocol.unhandle('aimedia')
    }
    electronSession.protocol.handle('aimedia', async (request) => {
      try {
        const url = new URL(request.url)
        if (url.host === 'reference') {
          const token = url.pathname.split('/').filter(Boolean)[0]
          const path = token ? this.references.resolvePreviewPath(token) : null
          return path
            ? net.fetch(pathToFileURL(path).toString())
            : new Response('Not found', { status: 404 })
        }
        if (url.host === 'asset') {
          const [sessionId, assetId] = url.pathname.split('/').filter(Boolean)
          if (!sessionId || !assetId) return new Response('Not found', { status: 404 })
          const path = await this.assets.resolveAsset(sessionId, assetId)
          return this.serveAsset(request, path)
        }
        return new Response('Not found', { status: 404 })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    })
  }

  /** Streams a complete asset or one Chromium-requested byte range with correct media headers. */
  private async serveAsset(request: Request, path: string): Promise<Response> {
    const details = await stat(path)
    const rangeHeader = request.headers.get('range')
    const range = rangeHeader ? parseMediaByteRange(rangeHeader, details.size) : null
    if (rangeHeader && !range) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${details.size}` },
      })
    }
    const start = range?.start ?? 0
    const end = range?.end ?? details.size - 1
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'Content-Length': String(Math.max(0, end - start + 1)),
      'Content-Type': contentTypeForPath(path),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${details.size}` } : {}),
    })
    if (request.method === 'HEAD') {
      return new Response(null, { status: range ? 206 : 200, headers })
    }
    const body = Readable.toWeb(createReadStream(path, { start, end }))
    return new Response(body, { status: range ? 206 : 200, headers })
  }
}
