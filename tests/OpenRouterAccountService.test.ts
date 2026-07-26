/**
 * Verifies OpenRouter credit validation and remaining-balance calculation.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import OpenRouterAccountService from '../src/main/services/OpenRouterAccountService'

describe('OpenRouterAccountService', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('subtracts total usage from purchased credits', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: { total_credits: 20, total_usage: 7.5 } })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const balance = await new OpenRouterAccountService().verifyAndGetBalance('sk-or-test')

    expect(balance).toEqual([{ amount: 12.5, units: 'USD' }])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/credits',
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-or-test' } }),
    )
  })

  it('rejects an invalid key during save validation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    )
    await expect(new OpenRouterAccountService().verifyAndGetBalance('invalid')).rejects.toThrow(
      'OpenRouter rejected the API key',
    )
  })

  it('silently omits balance on a refresh failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 })),
    )
    await expect(new OpenRouterAccountService().getBalance('key')).resolves.toEqual([])
  })
})
