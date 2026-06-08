import { useState, DragEvent } from 'react'

export function DropZone() {
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    const paths = files.map(f => f.path).filter(Boolean)
    if (paths.length > 0) {
      window.api.queue.add(paths)
    }
  }

  function handleBrowse() {
    window.api.dialog.selectFiles().then((paths) => {
      if (paths.length > 0) {
        window.api.queue.add(paths)
      }
    })
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
