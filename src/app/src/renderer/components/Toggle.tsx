interface Props {
  label: string
  /** Shown on hover via the `?` affordance, matching the rest of Settings. */
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  labelClassName?: string
  /** Tints the on state red — for switches whose "on" destroys something. */
  danger?: boolean
}

export function Toggle({ label, hint, checked, onChange, labelClassName = 'text-sm', danger }: Props) {
  const on = danger ? 'bg-red-500' : 'bg-accent-500'

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className={labelClassName}>{label}</span>
        {hint && (
          <span className="text-xs text-gray-500 cursor-help shrink-0" title={hint}>?</span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-10 h-5 rounded-full transition-colors ${checked ? on : 'bg-gray-600'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`}
        />
      </button>
    </div>
  )
}
