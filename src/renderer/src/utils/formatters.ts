/**
 * Provides consistent date, price, and history formatting helpers.
 */

import {
  getComparablePriceAmount,
  isCharacterPrice,
  isTokenPrice,
  type ModelPrice,
} from '@shared/openrouter'
import type { SessionDocument, SessionSummary, TimeFormat } from '@shared/types'

/** Formats a stored ISO date with the preferred 12- or 24-hour clock. */
export const formatDate = (isoDate: string, timeFormat: TimeFormat): string => {
  const date = new Date(isoDate)
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: timeFormat === '12-hour',
  }).format(date)
}

/** Formats native media prices directly and token prices per one million tokens. */
export const formatModelPrice = (
  price: ModelPrice | null,
  translateUnit?: (key: string) => string,
): string => {
  if (!price) return translateUnit?.('pricing.unavailable') ?? 'Pricing unavailable'
  const amount = getComparablePriceAmount(price)
  const fallbackUnit = isCharacterPrice(price)
    ? '1M characters'
    : isTokenPrice(price)
      ? price.unit.toLocaleLowerCase('en-US').includes('video')
        ? '1M video tokens'
        : price.unit.toLocaleLowerCase('en-US').includes('input')
          ? '1M input tokens'
          : price.unit.toLocaleLowerCase('en-US').includes('output')
            ? '1M output tokens'
            : '1M tokens'
      : price.unit
  const unitKey = isCharacterPrice(price)
    ? 'pricing.characters'
    : isTokenPrice(price)
      ? price.unit.toLocaleLowerCase('en-US').includes('video')
        ? 'pricing.videoTokens'
        : price.unit.toLocaleLowerCase('en-US').includes('input')
          ? 'pricing.inputTokens'
          : price.unit.toLocaleLowerCase('en-US').includes('output')
            ? 'pricing.outputTokens'
            : 'pricing.tokens'
      : price.unit.toLocaleLowerCase('en-US').includes('image')
        ? 'pricing.image'
        : price.unit.toLocaleLowerCase('en-US') === 'second'
          ? 'pricing.second'
          : price.unit.toLocaleLowerCase('en-US') === 'hour'
            ? 'pricing.hour'
            : `pricing.${price.unit}`
  const unit = translateUnit?.(unitKey) ?? fallbackUnit
  const variant = price.variant ? ` · ${price.variant}` : ''
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} / ${unit}${variant}`
}

/** Converts one complete generation session to compact history metadata. */
export const toSessionSummary = (session: SessionDocument): SessionSummary => ({
  id: session.id,
  title: session.title,
  isDefaultTitle: session.isDefaultTitle,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  hasItem: session.item !== null,
  ...(session.item ? { mediaKind: session.item.kind, status: session.item.status } : {}),
  preview:
    (session.item?.kind === 'stt'
      ? session.item.resultText || session.item.inputAudio?.originalName
      : session.item?.prompt
    )?.slice(0, 140) ?? '',
})
