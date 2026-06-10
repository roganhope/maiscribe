import { useState, useEffect } from 'react'
import { useSpeakers } from '../hooks/useSpeakers'
import { SpeakerClipPlayer } from './SpeakerClipPlayer'
import type { Speaker, SpeakerClip } from '../../shared/types'

export function SpeakersTab() {
  const { speakers, loading, rename, unassign, updateNotes, merge, deleteSpeaker, getClips, getQuotes, refresh } = useSpeakers()
  const [clips, setClips] = useState<Record<string, SpeakerClip[]>>({})
  const [quotes, setQuotes] = useState<Record<string, string[]>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [notesInput, setNotesInput] = useState('')
  const [editingNotes, setEditingNotes] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState<string | null>(null)
  const [mergeSelection, setMergeSelection] = useState<string>('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const unnamed = speakers.filter(s => !s.name)
  const named = speakers.filter(s => s.name)

  useEffect(() => {
    for (const s of unnamed) {
      if (!clips[s.id]) loadClips(s.id)
      if (!quotes[s.id]) loadQuotes(s.id)
    }
  }, [speakers])

  async function loadClips(id: string) {
    if (!clips[id]) {
      const c = await getClips(id)
      setClips(prev => ({ ...prev, [id]: c }))
    }
  }

  async function loadQuotes(id: string) {
    if (!quotes[id]) {
      const q = await getQuotes(id)
      setQuotes(prev => ({ ...prev, [id]: q }))
    }
  }

  async function handleAssign(id: string) {
    const trimmed = nameInput.trim()
    if (!trimmed) { setEditingId(null); return }
    await rename(id, trimmed)
    setEditingId(null)
  }

  async function handleSaveNotes(id: string) {
    await updateNotes(id, notesInput)
    setEditingNotes(null)
  }

  async function handleMerge(keepId: string, removeId: string) {
    await merge(keepId, removeId)
    setMergeTarget(null)
  }

  async function handleDelete(id: string) {
    await deleteSpeaker(id)
    setConfirmDelete(null)
    setExpandedId(null)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>
  }

  if (speakers.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        No speakers yet. Process some recordings to get started.
      </div>
    )
  }

  return (
    <div className="p-6 overflow-y-auto h-full">
      {unnamed.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-yellow-400 uppercase tracking-wide mb-4">
            Needs Attention ({unnamed.length})
          </h2>
          <div className="grid gap-4">
            {unnamed.map(speaker => (
              <div key={speaker.id} className="bg-gray-800 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-2">
                  {editingId === speaker.id ? (
                    <input
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onBlur={() => handleAssign(speaker.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAssign(speaker.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      autoFocus
                      placeholder="Enter name..."
                      className="text-sm bg-transparent border border-gray-600 rounded px-2 py-1 text-gray-100 focus:border-accent-400 outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => { setEditingId(speaker.id); setNameInput('') }}
                      className="text-sm text-accent-400 hover:text-accent-300"
                    >
                      Assign name
                    </button>
                  )}
                  <SpeakerClipPlayer clips={clips[speaker.id] || []} />
                </div>
                {(quotes[speaker.id] || []).length > 0 && (
                  <div className="mb-2 space-y-1">
                    {quotes[speaker.id].map((q, i) => (
                      <p key={i} className="text-xs text-gray-400 italic truncate">&ldquo;{q}&rdquo;</p>
                    ))}
                  </div>
                )}
                <div className="text-xs text-gray-500">
                  {speaker.appearances.length} recording{speaker.appearances.length !== 1 ? 's' : ''} &middot; First seen {new Date(speaker.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
          All Speakers ({named.length})
        </h2>
        <div className="flex flex-col gap-2">
          {named.map(speaker => (
            <div key={speaker.id} className="bg-gray-800 rounded-lg">
              <button
                onClick={() => {
                  const newId = expandedId === speaker.id ? null : speaker.id
                  setExpandedId(newId)
                  if (newId) loadClips(newId)
                }}
                className="w-full px-4 py-3 flex items-center gap-3 text-left"
              >
                <span className="text-sm font-medium text-gray-200">{speaker.name}</span>
                {speaker.notes && (
                  <span className="text-xs text-gray-500 truncate max-w-48">{speaker.notes}</span>
                )}
                <span className="ml-auto text-xs text-gray-500">
                  {speaker.appearances.length} recording{speaker.appearances.length !== 1 ? 's' : ''}
                </span>
              </button>

              {expandedId === speaker.id && (
                <div className="px-4 pb-4 border-t border-gray-700 pt-3">
                  <div className="flex items-center gap-3 mb-3">
                    <SpeakerClipPlayer clips={clips[speaker.id] || []} />
                    {!speaker.enrolledOnModal && (
                      <span className="text-xs text-yellow-500">not synced to Modal</span>
                    )}
                  </div>

                  <div className="mb-3">
                    {editingNotes === speaker.id ? (
                      <div>
                        <textarea
                          value={notesInput}
                          onChange={(e) => setNotesInput(e.target.value)}
                          onBlur={() => handleSaveNotes(speaker.id)}
                          className="w-full text-sm bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 focus:border-accent-400 outline-none resize-none"
                          rows={2}
                          placeholder="Notes about this person..."
                          autoFocus
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingNotes(speaker.id); setNotesInput(speaker.notes || '') }}
                        className="text-xs text-gray-500 hover:text-gray-300"
                      >
                        {speaker.notes || 'Add notes...'}
                      </button>
                    )}
                  </div>

                  <div className="text-xs text-gray-500 mb-3">
                    Recordings: {speaker.appearances.map(a => a.recordingId).join(', ')}
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => { setEditingId(speaker.id); setNameInput(speaker.name || '') }}
                      className="text-xs text-gray-400 hover:text-gray-200"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => unassign(speaker.id)}
                      className="text-xs text-gray-400 hover:text-yellow-400"
                    >
                      Unassign
                    </button>
                    <button
                      onClick={() => { setMergeTarget(mergeTarget === speaker.id ? null : speaker.id); setMergeSelection('') }}
                      className="text-xs text-gray-400 hover:text-gray-200"
                    >
                      Merge with...
                    </button>
                    {confirmDelete === speaker.id ? (
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleDelete(speaker.id)} className="text-xs text-red-400">Confirm</button>
                        <button onClick={() => setConfirmDelete(null)} className="text-xs text-gray-500">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(speaker.id)}
                        className="text-xs text-gray-400 hover:text-red-400"
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  {mergeTarget === speaker.id && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-gray-400">Merge into:</span>
                      <select
                        value={mergeSelection}
                        onChange={(e) => setMergeSelection(e.target.value)}
                        className="text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200"
                      >
                        <option value="" disabled>Select speaker...</option>
                        {named.filter(s => s.id !== speaker.id).map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => { if (mergeSelection) handleMerge(mergeSelection, speaker.id) }}
                        disabled={!mergeSelection}
                        className="text-xs px-2 py-0.5 rounded bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Merge
                      </button>
                      <button
                        onClick={() => { setMergeTarget(null); setMergeSelection('') }}
                        className="text-xs text-gray-500 hover:text-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
