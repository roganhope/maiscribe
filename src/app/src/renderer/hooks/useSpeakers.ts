import { useState, useEffect, useCallback } from 'react'
import type { Speaker, SpeakerClip } from '../../shared/types'

export function useSpeakers() {
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const list = await window.api.speakers.list()
    setSpeakers(list)
    setLoading(false)
    return list
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const rename = useCallback(async (id: string, name: string) => {
    const result = await window.api.speakers.rename(id, name)
    if (result.ok) {
      setSpeakers(prev => prev.map(s => s.id === id ? { ...s, name } : s))
    }
    return result
  }, [])

  const unassign = useCallback(async (id: string) => {
    await window.api.speakers.unassign(id)
    setSpeakers(prev => prev.map(s => s.id === id ? { ...s, name: null, enrolledOnModal: false } : s))
  }, [])

  const updateNotes = useCallback(async (id: string, notes: string) => {
    await window.api.speakers.updateNotes(id, notes)
    setSpeakers(prev => prev.map(s => s.id === id ? { ...s, notes } : s))
  }, [])

  const merge = useCallback(async (keepId: string, removeId: string) => {
    await window.api.speakers.merge(keepId, removeId)
    await refresh()
  }, [refresh])

  const deleteSpeaker = useCallback(async (id: string) => {
    await window.api.speakers.delete(id)
    setSpeakers(prev => prev.filter(s => s.id !== id))
  }, [])

  const getClips = useCallback(async (id: string): Promise<SpeakerClip[]> => {
    return window.api.speakers.getClips(id)
  }, [])

  const getQuotes = useCallback(async (id: string): Promise<string[]> => {
    return window.api.speakers.getQuotes(id)
  }, [])

  return {
    speakers,
    loading,
    refresh,
    rename,
    unassign,
    updateNotes,
    merge,
    deleteSpeaker,
    getClips,
    getQuotes,
  }
}
