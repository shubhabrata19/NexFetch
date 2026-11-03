import type { ChangeEvent } from 'react'

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

interface RateLimitInputProps {
  id: string
  label: string
  value: RateLimitDraft
  placeholderBytes: number
  disabled?: boolean
  onChange: (value: RateLimitDraft) => void
}

export function RateLimitInput({
  id,
  label,
  value,
  placeholderBytes,
  disabled = false,
  onChange,
}: RateLimitInputProps) {
  const changeUnit = (event: ChangeEvent<HTMLSelectElement>): void => {
    onChange(convertRateDraft(value, event.target.value as RateUnit))
  }

  return (
    <label className="rate-limit-input" htmlFor={id}>
      <span className="rate-limit-label">{label}</span>
      <span className="rate-limit-box">
        <input
          id={id}
          className="rate-limit-value"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder={ratePlaceholder(placeholderBytes, value.unit)}
          value={value.value}
          disabled={disabled}
          aria-label={`${label} speed limit in ${value.unit} per second`}
          onChange={(event) => onChange({ ...value, value: event.target.value })}
        />
        <select
          className="rate-limit-unit"
          value={value.unit}
          disabled={disabled}
          aria-label={`${label} speed limit unit`}
          onChange={changeUnit}
        >
          <option value="KB">KB/s</option>
          <option value="MB">MB/s</option>
        </select>
      </span>
    </label>
  )
}
