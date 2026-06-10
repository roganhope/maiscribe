import type { RecordingListItem } from '../../shared/types'
import { RecordingSidebarItem } from './RecordingSidebarItem'

interface Props {
  recordings: RecordingListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function RecordingSidebar({ recordings, selectedId, onSelect }: Props) {
  if (recordings.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm p-4">
        No recordings yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col overflow-y-auto h-full">
      {recordings.map(recording => (
        <RecordingSidebarItem
          key={recording.id}
          recording={recording}
          selected={recording.id === selectedId}
          onClick={() => onSelect(recording.id)}
        />
      ))}
    </div>
  )
}
