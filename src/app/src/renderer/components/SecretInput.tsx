import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  autoComplete?: string
}

/**
 * A masked text input with an eye toggle to reveal its contents.
 *
 * API tokens are long, opaque and pasted by hand, so a mistyped or truncated
 * one is invisible while masked and only surfaces as a failed connection test.
 * Revealing is the fastest way to check what is actually in the field.
 */
export function SecretInput({
  value,
  onChange,
  placeholder,
  className = '',
  autoComplete = 'off',
}: Props) {
  const [revealed, setRevealed] = useState(false)

  return (
    <div className="relative">
      <input
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        // Right padding keeps long tokens from running under the button.
        className={`w-full bg-gray-700 rounded pl-3 pr-10 py-2 text-sm text-gray-200 placeholder-gray-500 ${className}`}
      />
      <button
        // type="button" so this never submits a surrounding form.
        type="button"
        onClick={() => setRevealed((r) => !r)}
        aria-label={revealed ? 'Hide value' : 'Reveal value'}
        title={revealed ? 'Hide' : 'Reveal'}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-200"
      >
        {revealed ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  )
}
