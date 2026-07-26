/**
 * Validates OpenRouter credentials and reports remaining prepaid USD credit.
 */

import type { ApiBalance } from '@shared/types'
import { z } from 'zod'

const creditsSchema = z.object({
  data: z.object({
    total_credits: z.number(),
    total_usage: z.number(),
  }),
})

export default class OpenRouterAccountService {
  /** Validates an API key and returns its remaining OpenRouter credit. */
  public async verifyAndGetBalance(apiKey: string): Promise<ApiBalance[]> {
    return [await this.fetchBalance(apiKey)]
  }

  /** Retrieves balance data without turning a transient failure into a settings error. */
  public async getBalance(apiKey: string): Promise<ApiBalance[]> {
    try {
      return [await this.fetchBalance(apiKey)]
    } catch {
      return []
    }
  }

  /** Fetches total credits and usage, then calculates the remaining USD value. */
  private async fetchBalance(apiKey: string): Promise<ApiBalance> {
    const response = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!response.ok) throw new Error('OpenRouter rejected the API key.')
    const { data } = creditsSchema.parse(await response.json())
    return { amount: data.total_credits - data.total_usage, units: 'USD' }
  }
}
