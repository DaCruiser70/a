'use client'

import {
  PHONE_PLACEHOLDER, PHONE_HINT, PHONE_PREFIX_SR, PHONE_INPUT_MAX, formatPhoneInput,
} from '@/lib/phone-format'

// A phone field with a fixed "+1" in front (shown, not editable) and the helper line under it. Formats
// as the person types or pastes. The "+1" itself is hidden from screen readers; the helper line says
// "Country code plus one is already included" for them, through aria-describedby.
export default function PhoneInput({
  id, value, onChange, name, required, invalid, errorId, extraHint, extraHintId, autoComplete = 'tel-national',
}: {
  id:            string
  value:         string
  onChange:      (formatted: string) => void
  name?:         string
  required?:     boolean
  invalid?:      boolean
  errorId?:      string       // the field's error element, described when invalid
  extraHint?:    string       // a second helper line for this field
  extraHintId?:  string
  autoComplete?: string
}) {
  const hintId = `${id}-phone-hint`
  const describedBy = [hintId, extraHint ? extraHintId : null, invalid ? errorId : null].filter(Boolean).join(' ')
  return (
    <>
      <div className="phone-field">
        <span className="phone-prefix" aria-hidden="true">+1</span>
        <input
          id={id}
          name={name}
          className="form-input phone-input"
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          placeholder={PHONE_PLACEHOLDER}
          maxLength={PHONE_INPUT_MAX}
          required={required}
          value={value}
          onChange={e => onChange(formatPhoneInput(e.target.value))}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
      </div>
      <span id={hintId} className="form-input-hint">
        {PHONE_HINT}<span className="form-sr-only"> {PHONE_PREFIX_SR}</span>
      </span>
      {extraHint && <span id={extraHintId} className="form-input-hint">{extraHint}</span>}
    </>
  )
}
