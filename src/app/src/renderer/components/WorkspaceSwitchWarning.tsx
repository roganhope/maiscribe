import type { WorkspaceComparison } from '../../shared/types'

interface Props {
  comparison: WorkspaceComparison
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Shown when new tokens point at a different Modal workspace.
 *
 * The image and the model weights are cached per workspace, so switching throws
 * both away. Without this the cost is invisible until the next transcription
 * stalls for several minutes with no explanation.
 */
export function WorkspaceSwitchWarning({ comparison, onConfirm, onCancel }: Props) {
  if (comparison.kind !== 'changed') return null

  return (
    <div className="mt-3 rounded border border-yellow-700/60 bg-yellow-900/20 p-3">
      <p className="text-sm font-medium text-yellow-300">
        {comparison.confident
          ? 'This is a different Modal workspace.'
          : "These tokens may point at a different workspace — maiscribe couldn't confirm."}
      </p>
      <p className="mt-1 text-sm text-yellow-200/80">
        <span className="font-mono">{comparison.from}</span>
        {' → '}
        <span className="font-mono">{comparison.to}</span>
      </p>
      <p className="mt-2 text-xs text-yellow-200/70">
        The GPU image and ~3&nbsp;GB of model weights are cached per workspace. Nothing is cached
        in <span className="font-mono">{comparison.to}</span> yet, so maiscribe has to rebuild
        them — several minutes before your next transcription runs.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onConfirm}
          className="px-3 py-1.5 text-sm rounded bg-yellow-700/70 hover:bg-yellow-700 text-yellow-50"
        >
          Switch to {comparison.to}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
        >
          Keep {comparison.from}
        </button>
      </div>
    </div>
  )
}
