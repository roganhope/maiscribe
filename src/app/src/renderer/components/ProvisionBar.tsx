import type { ProvisionStatus } from '../../shared/types'

/**
 * Progress for the one-time Modal workspace setup.
 *
 * Sits under the python-env strip and follows the same rule: visible only while
 * something is happening or has gone wrong. The image-build step has no
 * sub-progress of its own — it runs before any of our code does — so the bar
 * moves in six discrete steps rather than continuously.
 */
export function ProvisionBar({ status }: { status: ProvisionStatus }) {
  if (status.state === 'idle' || status.state === 'ready') return null

  if (status.state === 'error') {
    return (
      <div className="px-6 py-2 text-sm bg-red-900/50 text-red-300 flex items-center gap-3">
        <span className="flex-1 min-w-0 truncate">Setup failed: {status.message}</span>
        <button
          onClick={() => window.api.provision.retry()}
          className="shrink-0 px-2 py-0.5 rounded bg-red-800/60 hover:bg-red-800 text-red-100 text-xs"
        >
          Retry
        </button>
        <button
          onClick={() => window.api.provision.skip()}
          className="shrink-0 text-xs text-red-300/80 hover:text-red-200 underline"
        >
          Start anyway
        </button>
      </div>
    )
  }

  const percent = status.total ? Math.round((status.index / status.total) * 100) : 0

  return (
    <div className="px-6 py-2 bg-gray-800 text-gray-400">
      <div className="flex items-center gap-3 text-sm">
        <span className="flex-1 min-w-0 truncate">
          Setting up your app — {status.message}
        </span>
        {status.total > 0 && (
          <span className="shrink-0 text-xs text-gray-500 tabular-nums">
            {status.index} of {status.total}
          </span>
        )}
      </div>
      <div className="mt-1.5 h-1 w-full rounded bg-gray-700 overflow-hidden">
        <div
          className="h-full bg-accent-400 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
