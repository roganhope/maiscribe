import { useState, useMemo, useCallback } from 'react'
import type { RecordingListItem } from '../../shared/types'
import {
  emptyFilters,
  filterRecordings,
  filtersActive,
  getSpeakerOptions,
  type DatePreset,
  type RecordingFilters,
} from '../utils/recordingFilters'

export function useRecordingFilters(recordings: RecordingListItem[]) {
  const [filters, setFilters] = useState<RecordingFilters>(emptyFilters)

  const setQuery = useCallback((query: string) => {
    setFilters(prev => ({ ...prev, query }))
  }, [])

  const setSpeaker = useCallback((speaker: string | null) => {
    setFilters(prev => ({ ...prev, speaker }))
  }, [])

  const setDatePreset = useCallback((datePreset: DatePreset) => {
    setFilters(prev => ({ ...prev, datePreset }))
  }, [])

  const setCustomRange = useCallback((customFrom: string | null, customTo: string | null) => {
    setFilters(prev => ({ ...prev, customFrom, customTo }))
  }, [])

  const clear = useCallback(() => setFilters(emptyFilters), [])

  const filteredRecordings = useMemo(() => filterRecordings(recordings, filters), [recordings, filters])
  const speakerOptions = useMemo(() => getSpeakerOptions(recordings), [recordings])
  const isActive = filtersActive(filters)

  return {
    filters,
    setQuery,
    setSpeaker,
    setDatePreset,
    setCustomRange,
    clear,
    filteredRecordings,
    speakerOptions,
    isActive,
  }
}
