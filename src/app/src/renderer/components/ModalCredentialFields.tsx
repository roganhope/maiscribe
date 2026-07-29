import { useState } from 'react'
import { SecretInput } from './SecretInput'
import { parseModalTokenCommand, maskToken } from '../utils/modalCommand'

interface Props {
  tokenId: string
  tokenSecret: string
  onChange: (tokenId: string, tokenSecret: string) => void
  /** Fired after a command paste fills both fields, so the step can self-resolve. */
  onPasted?: (tokenId: string, tokenSecret: string) => void
}

/**
 * The two Modal token fields, enterable either way.
 *
 * Modal's UI hands the user a complete `modal token set` line. Making them
 * dismantle it into two fields is the step that introduces stray whitespace, so
 * paste is the default and manual entry is the fallback.
 */
export function ModalCredentialFields({ tokenId, tokenSecret, onChange, onPasted }: Props) {
  const [mode, setMode] = useState<'paste' | 'manual'>('paste')
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState(false)
  // Set once a paste succeeds, so the command (and the secret in it) stops
  // being rendered and a short confirmation takes its place.
  const [pastedId, setPastedId] = useState<string | null>(null)

  function handlePaste(text: string) {
    setPasteText(text)
    const parsed = parseModalTokenCommand(text)
    if (parsed) {
      setPasteError(false)
      setPastedId(parsed.tokenId)
      setPasteText('')
      onChange(parsed.tokenId, parsed.tokenSecret)
      onPasted?.(parsed.tokenId, parsed.tokenSecret)
      return
    }
    setPasteError(text.trim().length > 0)
  }

  function reset() {
    setPastedId(null)
    setPasteText('')
    setPasteError(false)
  }

  return (
    <div>
      <div className="flex gap-1 mb-3">
        {(['paste', 'manual'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              mode === m
                ? 'bg-gray-700 text-gray-200'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {m === 'paste' ? 'Paste command' : 'Enter manually'}
          </button>
        ))}
      </div>

      {mode === 'paste' ? (
        pastedId ? (
          <div className="text-sm">
            <p className="text-green-400">
              Parsed token ID <span className="font-mono">{maskToken(pastedId)}</span> and secret
            </p>
            <button
              onClick={reset}
              className="mt-1 text-xs text-accent-400 hover:text-accent-300 underline"
            >
              Paste a different command
            </button>
          </div>
        ) : (
          <div>
            <textarea
              value={pasteText}
              onChange={(e) => handlePaste(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="modal token set --token-id ak-... --token-secret as-..."
              className="w-full bg-gray-700 rounded px-3 py-2 text-sm font-mono text-gray-200 resize-none placeholder:text-gray-500"
            />
            {pasteError && (
              <p className="mt-1 text-xs text-red-400">
                Couldn't find <span className="font-mono">--token-id</span> and{' '}
                <span className="font-mono">--token-secret</span> in that. Paste the whole{' '}
                <span className="font-mono">modal token set</span> line, or switch to manual entry.
              </p>
            )}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-sm text-gray-400">Token ID</label>
            <SecretInput
              value={tokenId}
              onChange={(value) => onChange(value, tokenSecret)}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400">Token Secret</label>
            <SecretInput
              value={tokenSecret}
              onChange={(value) => onChange(tokenId, value)}
              className="mt-1"
            />
          </div>
        </div>
      )}
    </div>
  )
}
