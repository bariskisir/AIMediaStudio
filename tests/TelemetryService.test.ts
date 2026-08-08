/** Verifies privacy-bounded Application Insights startup telemetry. */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TelemetryService from '@main/services/TelemetryService'

const temporaryDirectories: string[] = []

/** Creates an isolated durable data directory for one telemetry test. */
const createDataRoot = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'aimediastudio-telemetry-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('TelemetryService', () => {
  it('does nothing when telemetry is disabled', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const service = new TelemetryService(await createDataRoot(), fetcher)

    await service.trackStartup({
      appName: 'AIMediaStudio',
      enabled: false,
      version: '1.3.0',
      platform: 'win32',
      locale: 'tr',
    })

    expect(fetcher).not.toHaveBeenCalled()
  })

  it('sends one bounded startup event with a durable anonymous user id', async () => {
    const dataRoot = await createDataRoot()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    const service = new TelemetryService(dataRoot, fetcher)
    const startup = {
      appName: 'AIMediaStudio',
      enabled: true,
      version: '1.3.0',
      platform: 'win32' as const,
      locale: 'tr' as const,
    }

    await service.trackStartup(startup)
    await service.trackStartup(startup)

    expect(fetcher).toHaveBeenCalledTimes(1)
    const request = fetcher.mock.calls[0]
    expect(request?.[0]).toBe('https://northeurope-2.in.applicationinsights.azure.com/v2/track')
    const body = JSON.parse(String(request?.[1]?.body)) as {
      tags: Record<string, string>
      data: { baseData: { name: string; properties: Record<string, string> } }
    }
    expect(body.data.baseData).toEqual({
      ver: 2,
      name: 'app.startup',
      properties: {
        appName: 'AIMediaStudio',
        version: '1.3.0',
        platform: 'win32',
        locale: 'tr',
      },
    })
    expect(body.tags).not.toHaveProperty('ai.location.ip')
    expect(body.tags['ai.user.id']).toMatch(/^[0-9a-f-]{36}$/)

    const persisted = JSON.parse(await readFile(join(dataRoot, 'telemetry.json'), 'utf8')) as {
      installationId: string
    }
    expect(persisted.installationId).toBe(body.tags['ai.user.id'])
  })
})
