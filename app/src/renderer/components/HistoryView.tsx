import { useHistory } from '../hooks/useHistory'
import { RecordingSidebar } from './RecordingSidebar'
import { RecordingDetail } from './RecordingDetail'

export function HistoryView() {
  const {
    recordings,
    selectedId,
    detail,
    loading,
    detailLoading,
    selectRecording,
    updateTitle,
  } = useHistory()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Loading...
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <div className="w-72 border-r border-gray-700 flex-shrink-0">
        <RecordingSidebar
          recordings={recordings}
          selectedId={selectedId}
          onSelect={selectRecording}
        />
      </div>
      <div className="flex-1 min-w-0">
        {detailLoading && (
          <div className="flex items-center justify-center h-full text-gray-500">
            Loading...
          </div>
        )}
        {!detailLoading && detail && (
          <RecordingDetail recording={detail} onUpdateTitle={updateTitle} />
        )}
        {!detailLoading && !detail && recordings.length > 0 && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Select a recording
          </div>
        )}
        {!detailLoading && recordings.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            No recordings yet.
          </div>
        )}
      </div>
    </div>
  )
}
