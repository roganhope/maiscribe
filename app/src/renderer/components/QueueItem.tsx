import { useState } from 'react'
import type { QueueItem as QueueItemType } from '../../shared/types'

const STATUS_STYLES = {
  pending: 'bg-gray-600 text-gray-200',
  processing: 'bg-accent-500 text-white',
  done: 'bg-green-600 text-white',
  error: 'bg-red-600 text-white',
}

interface Props {
  item: QueueItemType
}

export function QueueItem({ item }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-gray-800 rounded-lg">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLES[item.status]}`}>
          {item.status}
        </span>

        <span className="flex-1 truncate text-sm text-gray-200">{item.fileName}</span>

        {item.progress && item.status === 'processing' && (
          <span className="text-xs text-gray-400 truncate max-w-48">{item.progress}</span>
        )}

        {item.status === 'done' && item.outputPath && (
          <button
            onClick={() => window.api.shell.openPath(item.outputPath!)}
            className="text-xs text-accent-400 hover:text-accent-300"
          >
            Open
          </button>
        )}

        {item.status === 'error' && (
          <div className="flex gap-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-gray-400 hover:text-gray-300"
            >
              {expanded ? 'Hide' : 'Details'}
            </button>
            <button
              onClick={() => window.api.queue.retry(item.id)}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {expanded && item.error && (
        <div className="px-4 pb-3">
          <pre className="text-xs text-red-300 bg-red-950/30 rounded p-2 whitespace-pre-wrap break-words">
            {item.error}
          </pre>
        </div>
      )}
    </div>
  )
}
