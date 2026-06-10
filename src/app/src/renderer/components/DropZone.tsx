import { useState, DragEvent } from 'react'

interface DropZoneProps {
  disabled?: boolean
  onNavigateToKeys?: () => void
}

export function DropZone({ disabled, onNavigateToKeys }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (disabled) return
    const files = Array.from(e.dataTransfer.files)
    const paths = files.map(f => window.api.file.getPath(f)).filter(Boolean)
    if (paths.length > 0) {
      window.api.queue.add(paths)
    }
  }

  function handleBrowse() {
    if (disabled) return
    window.api.dialog.selectFiles().then((paths) => {
      if (paths.length > 0) {
        window.api.queue.add(paths)
      }
    })
  }

  if (disabled) {
    return (
      <div className="border-2 border-dashed rounded-xl p-8 text-center border-gray-700 opacity-60">
        <p className="text-lg text-gray-400">🔒</p>
        <p className="text-sm text-gray-400 mt-2">
          <button
            onClick={onNavigateToKeys}
            className="text-accent-400 hover:text-accent-300 underline"
          >
            Configure model tokens
          </button>
          {' '}to get started
        </p>
      </div>
    )
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`
        border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer
        ${dragOver ? 'border-accent-400 bg-accent-500/10' : 'border-gray-600 hover:border-gray-500'}
      `}
      onClick={handleBrowse}
    >
      <p className="text-lg text-gray-300">Drop audio files here</p>
      <p className="text-sm text-gray-500 mt-1">or click to browse</p>
    </div>
  )
}
