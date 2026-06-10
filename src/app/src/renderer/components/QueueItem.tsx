import { useState } from 'react'
import type { QueueItem as QueueItemType } from '../../shared/types'

const STATUS_STYLES = {
  staged: 'bg-gray-700 text-gray-300',
  pending: 'bg-gray-600 text-gray-200',
  processing: 'bg-accent-500 text-white',
  done: 'bg-green-600 text-white',
  error: 'bg-red-600 text-white',
}

function formatTimeRemaining(item: QueueItemType): string | null {
  if (!item.startedAt || !item.estimatedDurationSec) return null
  const elapsed = (Date.now() - item.startedAt) / 1000
  const remaining = Math.max(0, item.estimatedDurationSec - elapsed)
  if (remaining < 5) return 'almost done'
  if (remaining < 60) return `~${Math.round(remaining)}s left`
  return `~${Math.round(remaining / 60)}m left`
}

function getProgressLabel(item: QueueItemType): string {
  return item.progress || 'Processing'
}

interface Props {
  item: QueueItemType
  onOpenHistory: (outputPath: string) => void
}

export function QueueItem({ item, onOpenHistory }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const percent = item.progressPercent ?? 0

  return (
    <div className="bg-gray-800 rounded-lg">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLES[item.status]}`}>
          {item.status}
        </span>

        <span className="flex-1 truncate text-sm text-gray-200">{item.fileName}</span>

        {item.status === 'staged' && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                showSettings ? 'bg-gray-600 text-gray-200' : 'bg-gray-700 text-gray-400 hover:text-gray-200'
              }`}
            >
              Options
            </button>
            <button
              onClick={() => window.api.queue.startItem(item.id)}
              className="text-xs px-2 py-0.5 rounded bg-accent-500/20 text-accent-400 hover:bg-accent-500/30"
            >
              Start
            </button>
          </div>
        )}

        {item.status === 'processing' && (
          <span className="text-xs text-gray-400">
            {percent > 0 ? `${percent}%` : ''}{percent > 0 && formatTimeRemaining(item) ? ' · ' : ''}{formatTimeRemaining(item) || ''}
          </span>
        )}

        {item.status === 'done' && item.outputPath && (
          <button
            onClick={() => { window.api.queue.remove(item.id); onOpenHistory(item.outputPath!) }}
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

        {item.status !== 'processing' && (
          <button
            onClick={() => window.api.queue.remove(item.id)}
            className="text-xs text-gray-500 hover:text-gray-300 ml-1"
          >
            &times;
          </button>
        )}
      </div>

      {showSettings && item.status === 'staged' && (
        <div className="px-4 pb-3 flex gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Audio:</label>
            <select
              value={item.options.audioHandling}
              onChange={(e) => window.api.queue.updateOptions(item.id, { audioHandling: e.target.value as any })}
              className="text-xs bg-gray-700 rounded px-2 py-1 text-gray-200"
            >
              <option value="store">Copy audio to maiscribe, keep original</option>
              <option value="store-and-delete">Move audio to maiscribe, delete original</option>
              <option value="delete">Don't store audio, leave original</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Summarize:</label>
            <select
              value={item.options.summarize ? 'yes' : 'no'}
              onChange={(e) => window.api.queue.updateOptions(item.id, { summarize: e.target.value === 'yes' })}
              className="text-xs bg-gray-700 rounded px-2 py-1 text-gray-200"
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Min speakers:</label>
            <input
              type="number"
              min={1}
              max={20}
              value={item.options.minSpeakers}
              onChange={(e) => window.api.queue.updateOptions(item.id, { minSpeakers: parseInt(e.target.value) || 2 })}
              className="text-xs bg-gray-700 rounded px-2 py-1 text-gray-200 w-14"
            />
          </div>
        </div>
      )}

      {item.status === 'processing' && (
        <div className="px-4 pb-3 space-y-1.5">
          <span className="text-xs text-gray-400">
            {getProgressLabel(item)}<span className="animate-ellipsis" />
          </span>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            {percent > 0 ? (
              <div
                className="h-full bg-accent-500 rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${percent}%` }}
              />
            ) : (
              <div className="h-full w-1/3 bg-accent-500 rounded-full animate-indeterminate" />
            )}
          </div>
        </div>
      )}

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
