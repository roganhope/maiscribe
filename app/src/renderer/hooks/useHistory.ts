import { useState, useEffect, useCallback } from 'react'
import type { RecordingListItem, RecordingDetail } from '../../shared/types'

export function useHistory() {
  const [recordings, setRecordings] = useState<RecordingListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RecordingDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    const list = await window.api.history.list()
    setRecordings(list)
    setLoading(false)
    if (list.length > 0 && !selectedId) {
      setSelectedId(list[0].id)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    const recording = recordings.find(r => r.id === selectedId)
    if (!recording) return
    setDetailLoading(true)
    window.api.history.get(recording.folderPath).then((d) => {
      setDetail(d)
      setDetailLoading(false)
    })
  }, [selectedId, recordings])

  const selectRecording = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  const updateTitle = useCallback(async (folderPath: string, title: string) => {
    await window.api.history.updateTitle(folderPath, title)
    setRecordings(prev =>
      prev.map(r => r.folderPath === folderPath ? { ...r, title } : r)
    )
    setDetail(prev => prev && prev.folderPath === folderPath ? { ...prev, title } : prev)
  }, [])

  return {
    recordings,
    selectedId,
    detail,
    loading,
    detailLoading,
    selectRecording,
    updateTitle,
    refresh,
  }
}
