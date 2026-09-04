import { useEffect, useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface Props {
  getText: () => string
  label: string
}

export function CopyButton({ getText, label }: Props) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  function handleCopy() {
    const text = getText()
    if (!text) return
    window.api.clipboard.writeText(text)
    setCopied(true)
  }

  return (
    <button
      onClick={handleCopy}
      title={copied ? 'Copied' : label}
      aria-label={label}
      className="text-gray-500 hover:text-gray-300 transition-colors"
    >
      {copied ? <Check size={14} className="text-accent-400" /> : <Copy size={14} />}
    </button>
  )
}
