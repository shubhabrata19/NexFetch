interface PeerLimitInputProps {
  id: string
  label: string
  value: string
  placeholder: number
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
  onChange: (value: string) => void
}

export function PeerLimitInput({
  id,
  label,
  value,
  placeholder,
  disabled = false,
  invalid = false,
  describedBy,
  onChange,
}: PeerLimitInputProps) {
  return (
    <label className="rate-limit-input" htmlFor={id}>
      <span className="rate-limit-label">{label}</span>
      <span className={`rate-limit-box${invalid ? ' rate-limit-box--invalid' : ''}`}>
        <input
          id={id}
          className="rate-limit-value"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={4}
          placeholder={String(placeholder)}
          value={value}
          disabled={disabled}
          aria-label={`${label} in peers`}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="peer-limit-suffix">peers</span>
      </span>
    </label>
  )
}
