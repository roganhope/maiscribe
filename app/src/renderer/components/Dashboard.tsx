import { useState, useEffect } from 'react'
import { DropZone } from './DropZone'
import { QueueItem } from './QueueItem'
import { useQueue } from '../hooks/useQueue'
import { useConfig } from '../hooks/useConfig'

export function Dashboard() {
  const queue = useQueue()
  const { config } = useConfig()
  const [watching, setWatching] = useState(false)

  useEffect(() => {
    if (config?.pipeline.autoWatch) {
      setWatching(true)
    }
  }, [config])

  function toggleWatcher() {
    const next = !watching
    setWatching(next)
    window.api.watcher.toggle(next)
  }

  const isProcessing = queue.some(i => i.status === 'processing')

  return (
    <div className="flex flex-col gap-6 p-6 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-100">Audio Transcription</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleWatcher}
            className={`text-xs px-3 py-1 rounded ${
              watching ? 'bg-green-600/20 text-green-400' : 'bg-gray-700 text-gray-400'
            }`}
          >
            {watching ? 'Watching' : 'Watch off'}
          </button>
          {isProcessing && (
            <button
              onClick={() => window.api.queue.cancel()}
              className="text-xs px-3 py-1 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <DropZone />

      {queue.length > 0 && (
        <div className="flex flex-col gap-2 overflow-y-auto flex-1">
          {queue.map(item => (
            <QueueItem key={item.id} item={item} />
          ))}
        </div>
      )}

      {queue.length === 0 && (
        <p className="text-center text-gray-500 mt-8">
          No files in queue. Drop audio files above or add them to the inbox folder.
        </p>
      )}
    </div>
  )
}
