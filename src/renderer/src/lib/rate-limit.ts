export type RateUnit = 'KB' | 'MB'
export interface RateLimitDraft {
  value: string
  unit: RateUnit
}

const UNIT_FACTOR: Record<RateUnit, number> = {
  KB: 1024,
  MB: 1024 * 1024,
}

function formatNumber(value: number): string {
  return String(Number.isInteger(value) ? value : Number(value.toFixed(2)))
}

export function rateDraftFromBytes(bytes: number | null | undefined): RateLimitDraft {
  if (bytes === null || bytes === undefined || bytes <= 0) {
    return { value: '', unit: 'MB' }
  }
  if (bytes >= UNIT_FACTOR.MB) {
    return { value: formatNumber(bytes / UNIT_FACTOR.MB), unit: 'MB' }
  }
  return { value: formatNumber(bytes / UNIT_FACTOR.KB), unit: 'KB' }
}

export function rateDraftToBytes(draft: RateLimitDraft): number | null | undefined {
  const trimmed = draft.value.trim()
  if (trimmed === '') return null
  const number = Number(trimmed)
  if (!Number.isFinite(number) || number < 0) return undefined
  return Math.min(1_000_000_000, Math.round(number * UNIT_FACTOR[draft.unit]))
}

export function convertRateDraft(draft: RateLimitDraft, nextUnit: RateUnit): RateLimitDraft {
  if (draft.unit === nextUnit) return draft
  const trimmed = draft.value.trim()
  if (trimmed === '') return { value: '', unit: nextUnit }
  const number = Number(trimmed)
  if (!Number.isFinite(number) || number < 0) return { value: draft.value, unit: nextUnit }
  const bytes = number * UNIT_FACTOR[draft.unit]
  return {
    value: formatNumber(bytes / UNIT_FACTOR[nextUnit]),
    unit: nextUnit,
  }
}

export function ratePlaceholder(bytes: number, unit: RateUnit): string {
  if (bytes <= 0) return 'Unlimited'
  return formatNumber(bytes / UNIT_FACTOR[unit])
}
