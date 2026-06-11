import { forwardRef, useImperativeHandle } from 'react'
import { useHistory } from '../hooks/useHistory'
import { useRecordingFilters } from '../hooks/useRecordingFilters'
import { RecordingFilterBar } from './RecordingFilterBar'
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

  const {
    filters,
    setQuery,
    setSpeaker,
    setDatePreset,
    setCustomRange,
    clear,
    filteredRecordings,
    speakerOptions,
    isActive,
  } = useRecordingFilters(recordings)

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
      <div className="w-72 border-r border-gray-700 flex-shrink-0 flex flex-col">
        {recordings.length > 0 && (
          <RecordingFilterBar
            filters={filters}
            speakerOptions={speakerOptions}
            isActive={isActive}
            onQueryChange={setQuery}
            onSpeakerChange={setSpeaker}
            onDatePresetChange={setDatePreset}
            onCustomRangeChange={setCustomRange}
            onClear={clear}
          />
        )}
        <div className="flex-1 min-h-0">
          <RecordingSidebar
            recordings={filteredRecordings}
            selectedId={selectedId}
            onSelect={selectRecording}
            filtersActive={isActive}
          />
        </div>
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
