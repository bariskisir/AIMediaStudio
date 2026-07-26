/**
 * Verifies that DeepgramAccountService correctly fetches project IDs,
 * aggregates balance data across projects, and handles API errors gracefully.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import DeepgramAccountService from '../src/main/services/DeepgramAccountService'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DeepgramAccountService', () => {
  const service = new DeepgramAccountService()

  function mockProjectsResponse(projectIds: string[]) {
    return {
      ok: true,
      json: async () => ({
        projects: projectIds.map((id) => ({ project_id: id })),
      }),
    }
  }

  function mockBalancesResponse(balances: { amount: number; units: string }[]) {
    return {
      ok: true,
      json: async () => ({ balances }),
    }
  }

  function mockErrorResponse(status = 401) {
    return { ok: false, status }
  }

  describe('verifyAndGetBalance', () => {
    it('returns balance data for a valid API key', async () => {
      mockFetch
        .mockResolvedValueOnce(mockProjectsResponse(['proj-1']))
        .mockResolvedValueOnce(mockBalancesResponse([{ amount: 50, units: 'USD' }]))

      const balances = await service.verifyAndGetBalance('dg-key')
      expect(balances).toHaveLength(1)
      expect(balances[0]).toEqual({ amount: 50, units: 'USD' })
    })

    it('throws when the projects API returns a non-ok status', async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(401))

      await expect(service.verifyAndGetBalance('bad-key')).rejects.toThrow(
        'Deepgram rejected the API key.',
      )
    })

    it('aggregates balances across multiple projects', async () => {
      mockFetch
        .mockResolvedValueOnce(mockProjectsResponse(['proj-1', 'proj-2']))
        .mockResolvedValueOnce(mockBalancesResponse([{ amount: 10, units: 'USD' }]))
        .mockResolvedValueOnce(mockBalancesResponse([{ amount: 15, units: 'USD' }]))

      const balances = await service.verifyAndGetBalance('dg-key')
      expect(balances).toHaveLength(1)
      expect(balances[0]).toEqual({ amount: 25, units: 'USD' })
    })

    it('aggregates balances across different units', async () => {
      mockFetch
        .mockResolvedValueOnce(mockProjectsResponse(['proj-1', 'proj-2']))
        .mockResolvedValueOnce(
          mockBalancesResponse([
            { amount: 10, units: 'USD' },
            { amount: 5, units: 'HOURS' },
          ]),
        )
        .mockResolvedValueOnce(mockBalancesResponse([{ amount: 20, units: 'USD' }]))

      const balances = await service.verifyAndGetBalance('dg-key')
      const usdBalance = balances.find((b) => b.units === 'USD')
      const hoursBalance = balances.find((b) => b.units === 'HOURS')
      expect(usdBalance?.amount).toBe(30)
      expect(hoursBalance?.amount).toBe(5)
    })

    it('normalizes unit casing to uppercase', async () => {
      mockFetch
        .mockResolvedValueOnce(mockProjectsResponse(['proj-1']))
        .mockResolvedValueOnce(mockBalancesResponse([{ amount: 10, units: 'usd' }]))

      const balances = await service.verifyAndGetBalance('dg-key')
      expect(balances[0]?.units).toBe('USD')
    })

    it('passes the Authorization token header', async () => {
      mockFetch
        .mockResolvedValueOnce(mockProjectsResponse(['proj-1']))
        .mockResolvedValueOnce(mockBalancesResponse([{ amount: 50, units: 'USD' }]))

      await service.verifyAndGetBalance('my-api-key')

      const calls = mockFetch.mock.calls
      expect(calls[0]?.[1]?.headers.Authorization).toBe('Token my-api-key')
      expect(calls[1]?.[1]?.headers.Authorization).toBe('Token my-api-key')
    })
  })

  describe('getBalance', () => {
    it('returns balances for a valid key', async () => {
      mockFetch
        .mockResolvedValueOnce(mockProjectsResponse(['proj-1']))
        .mockResolvedValueOnce(mockBalancesResponse([{ amount: 100, units: 'USD' }]))

      const balances = await service.getBalance('dg-key')
      expect(balances).toHaveLength(1)
      expect(balances[0]?.amount).toBe(100)
    })

    it('returns an empty array when the projects API fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const balances = await service.getBalance('dg-key')
      expect(balances).toEqual([])
    })

    it('returns an empty array when the balances API fails for all projects', async () => {
      mockFetch
        .mockResolvedValueOnce(mockProjectsResponse(['proj-1']))
        .mockRejectedValueOnce(new Error('Balance fetch failed'))

      const balances = await service.getBalance('dg-key')
      expect(balances).toEqual([])
    })

    it('returns partial balances when some projects fail', async () => {
      mockFetch
        .mockResolvedValueOnce(mockProjectsResponse(['proj-ok', 'proj-fail']))
        .mockResolvedValueOnce(mockBalancesResponse([{ amount: 10, units: 'USD' }]))
        .mockRejectedValueOnce(new Error('Balance fetch failed'))

      const balances = await service.getBalance('dg-key')
      expect(balances).toEqual([{ amount: 10, units: 'USD' }])
    })
  })
})
