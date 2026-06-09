import { forwardRef, useImperativeHandle } from 'react'
import { useHistory } from '../hooks/useHistory'
import { RecordingSidebar } from './RecordingSidebar'
import { RecordingDetail } from './RecordingDetail'

export interface HistoryViewHandle {
  selectByPath: (folderPath: string) => void
}

export const HistoryView = forwardRef<HistoryViewHandle>(function HistoryView(_props, ref) {
  const {
    recordings,
    selectedId,
    detail,
    loading,
    detailLoading,
    selectRecording,
    updateTitle,
    deleteRecording,
    refresh,
  } = useHistory()

  useImperativeHandle(ref, () => ({
    selectByPath(folderPath: string) {
      refresh().then((list) => {
        const folderName = folderPath.split('/').pop() || folderPath
        const match = list.find(r => r.id === folderName || r.folderPath === folderPath)
        if (match) {
          selectRecording(match.id)
        } else {
          selectRecording(folderName)
        }
      })
    },
  }), [selectRecording, refresh])

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
          <RecordingDetail recording={detail} onUpdateTitle={updateTitle} onDelete={deleteRecording} />
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
})
