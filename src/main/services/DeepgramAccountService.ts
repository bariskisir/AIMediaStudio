/**
 * Validates Deepgram credentials and retrieves optional project balance data.
 */

import type { ApiBalance } from '@shared/types'
import { z } from 'zod'

const projectsSchema = z.object({
  projects: z.array(z.object({ project_id: z.string().min(1) })),
})

const balancesSchema = z.object({
  balances: z.array(
    z.object({
      amount: z.number().finite(),
      units: z.string().trim().min(1).max(24),
    }),
  ),
})

const REQUEST_TIMEOUT_MS = 10_000
const BALANCE_TIMEOUT_MS = 4_000

export default class DeepgramAccountService {
  /** Validates an API key and returns balance data when its project supports it. */
  public async verifyAndGetBalance(apiKey: string): Promise<ApiBalance[]> {
    const projectIds = await this.fetchProjectIds(apiKey)
    return this.fetchBalances(apiKey, projectIds)
  }

  /** Retrieves balance data without turning an unsupported account into a UI error. */
  public async getBalance(apiKey: string): Promise<ApiBalance[]> {
    try {
      const projectIds = await this.fetchProjectIds(apiKey)
      return await this.fetchBalances(apiKey, projectIds)
    } catch {
      return []
    }
  }

  /** Lists projects and treats rejection as an invalid or unauthorized API key. */
  private async fetchProjectIds(apiKey: string): Promise<string[]> {
    const response = await fetch('https://api.deepgram.com/v1/projects', {
      headers: { Authorization: `Token ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error('Deepgram rejected the API key.')
    const payload = projectsSchema.parse(await response.json())
    return payload.projects.map((project) => project.project_id)
  }

  /** Aggregates supported balance responses across all projects by billing unit. */
  private async fetchBalances(apiKey: string, projectIds: string[]): Promise<ApiBalance[]> {
    const responses = await Promise.all(
      projectIds.map(async (projectId): Promise<ApiBalance[]> => {
        try {
          const response = await fetch(
            `https://api.deepgram.com/v1/projects/${encodeURIComponent(projectId)}/balances`,
            {
              headers: { Authorization: `Token ${apiKey}` },
              signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
            },
          )
          if (!response.ok) return []
          return balancesSchema.parse(await response.json()).balances
        } catch {
          return []
        }
      }),
    )
    const totals = new Map<string, number>()
    responses.flat().forEach((balance) => {
      const units = balance.units.toUpperCase()
      totals.set(units, (totals.get(units) ?? 0) + balance.amount)
    })
    return [...totals.entries()].map(([units, amount]) => ({ amount, units }))
  }
}
