import type { RecordingListItem } from '../../shared/types'

interface Props {
  recording: RecordingListItem
  selected: boolean
  onClick: () => void
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function RecordingSidebarItem({ recording, selected, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-l-2 transition-colors ${
        selected
          ? 'border-accent-400 bg-gray-700/50'
          : 'border-transparent hover:bg-gray-800/50'
      }`}
    >
      <p className="text-sm text-gray-200 truncate font-medium">{recording.title}</p>
      <p className="text-xs text-gray-500 mt-0.5">{formatDate(recording.date)}</p>
      {recording.participants.length > 0 && (
        <p className="text-xs text-gray-500 mt-0.5 truncate">
          {recording.participants.join(', ')}
        </p>
      )}
    </button>
  )
}
