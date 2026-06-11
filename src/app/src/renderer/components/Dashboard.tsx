import { useState, useEffect } from 'react'
import { DropZone } from './DropZone'
import { QueueItem } from './QueueItem'
import { useQueue } from '../hooks/useQueue'

interface DashboardProps {
  onOpenHistory: (outputPath: string) => void
  onNavigateToKeys: () => void
}

export function Dashboard({ onOpenHistory, onNavigateToKeys }: DashboardProps) {
  const queue = useQueue()
  const [keysReady, setKeysReady] = useState<boolean | null>(null)

  // Done items are dismissed when the user navigates away from this tab
  useEffect(() => {
    return () => { window.api.queue.clearDone() }
  }, [])

  useEffect(() => {
    window.api.env.get().then((vars) => {
      const hasModal = !!(vars.MODAL_TOKEN_ID && vars.MODAL_TOKEN_SECRET)
      const hasHf = !!vars.HF_TOKEN
      setKeysReady(hasModal && hasHf)
    })
  }, [])

  const isProcessing = queue.some(i => i.status === 'processing')
  const hasStaged = queue.some(i => i.status === 'staged')

  function handleStart() {
    window.api.queue.start()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && hasStaged && !isProcessing) {
      handleStart()
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 h-full" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-100">maiscribe</h1>
        {isProcessing && (
          <button
            onClick={() => window.api.queue.cancel()}
            className="text-xs px-3 py-1 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30"
          >
            Cancel
          </button>
        )}
      </div>

      <DropZone disabled={keysReady === false} onNavigateToKeys={onNavigateToKeys} />

      {queue.length > 0 && (
        <div className="flex flex-col gap-2 overflow-y-auto flex-1">
          {queue.map(item => (
            <QueueItem key={item.id} item={item} onOpenHistory={onOpenHistory} />
          ))}
        </div>
      )}

      {queue.length === 0 && (
        <p className="text-center text-gray-500 mt-8">
          No files in queue. Drop audio files above or add them to the inbox folder.
        </p>
      )}

      {hasStaged && !isProcessing && (
        <div className="flex justify-center pb-2">
          <button
            onClick={handleStart}
            className="px-6 py-2 rounded-lg bg-accent-500 hover:bg-accent-600 text-white font-medium text-sm"
          >
            Start Transcriptions
          </button>
        </div>
      )}
    </div>
  )
}
