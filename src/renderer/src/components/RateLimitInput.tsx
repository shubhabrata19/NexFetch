import type { ChangeEvent } from 'react'
import { convertRateDraft, ratePlaceholder } from '../lib/rate-limit'
import type { RateLimitDraft, RateUnit } from '../lib/rate-limit'

export {
  convertRateDraft,
  rateDraftFromBytes,
  rateDraftToBytes,
  ratePlaceholder,
} from '../lib/rate-limit'
export type { RateLimitDraft, RateUnit } from '../lib/rate-limit'

interface RateLimitInputProps {
  id: string
  label: string
  value: RateLimitDraft
  placeholderBytes: number
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
  onChange: (value: RateLimitDraft) => void
}

export function RateLimitInput({
  id,
  label,
  value,
  placeholderBytes,
  disabled = false,
  invalid = false,
  describedBy,
  onChange,
}: RateLimitInputProps) {
  const changeUnit = (event: ChangeEvent<HTMLSelectElement>): void => {
    onChange(convertRateDraft(value, event.target.value as RateUnit))
  }

  return (
    <label className="rate-limit-input" htmlFor={id}>
      <span className="rate-limit-label">{label}</span>
      <span className={`rate-limit-box${invalid ? ' rate-limit-box--invalid' : ''}`}>
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
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
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
