import { useState, useEffect } from 'react'
import type { RecordingDetail as RecordingDetailType, Speaker } from '../../shared/types'
import { AudioPlayer } from './AudioPlayer'
import { SummaryView } from './SummaryView'
import { TranscriptView } from './TranscriptView'
import { SpeakerSubmodule } from './SpeakerSubmodule'
import { CopyButton } from './CopyButton'
import { summaryToText, transcriptToText } from '../utils/copyText'

interface Props {
  recording: RecordingDetailType
  onUpdateTitle: (folderPath: string, title: string) => void
  onDelete: (folderPath: string) => void
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }) + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function RecordingDetail({ recording, onUpdateTitle, onDelete }: Props) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(recording.title)
  const [showTranscript, setShowTranscript] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setTitleDraft(recording.title)
    setEditingTitle(false)
    setShowTranscript(false)
    setConfirmDelete(false)
  }, [recording.id])

  const [speakerNames, setSpeakerNames] = useState<Record<string, string | null>>({})

  useEffect(() => {
    async function loadNames() {
      const names: Record<string, string | null> = {}
      for (const speakerId of Object.values(recording.transcription.speakerMap)) {
        const speaker = await window.api.speakers.get(speakerId)
        if (speaker) names[speakerId] = speaker.name
      }
      setSpeakerNames(names)
    }
    loadNames()
  }, [recording.id, recording.transcription.speakerMap])

  function handleTitleSubmit() {
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== recording.title) {
      onUpdateTitle(recording.folderPath, trimmed)
    } else {
      setTitleDraft(recording.title)
    }
    setEditingTitle(false)
  }

  function handleTitleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleTitleSubmit()
    if (e.key === 'Escape') {
      setTitleDraft(recording.title)
      setEditingTitle(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto h-full">
      {editingTitle ? (
        <input
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={handleTitleSubmit}
          onKeyDown={handleTitleKeyDown}
          autoFocus
          className="text-xl font-bold bg-transparent border border-gray-600 rounded px-2 py-1 text-gray-100 focus:border-accent-400 outline-none"
        />
      ) : (
        <h1
          onClick={() => setEditingTitle(true)}
          className="text-xl font-bold text-gray-100 cursor-pointer hover:text-accent-400 transition-colors"
        >
          {recording.title}
        </h1>
      )}

      <div className="flex flex-wrap gap-3 text-xs text-gray-400">
        <span>{formatDate(recording.date)}</span>
        {recording.durationMinutes > 0 && <span>{recording.durationMinutes} min</span>}
        <span className="capitalize">{recording.recordingType}</span>
        {recording.participants.length > 0 && (
          <span>{recording.participants.join(', ')}</span>
        )}
      </div>

      {recording.audioFilePath && (
        <AudioPlayer filePath={recording.audioFilePath} />
      )}

      {Object.keys(recording.transcription.speakerMap).length > 0 && (
        <SpeakerSubmodule
          speakerMap={recording.transcription.speakerMap}
          recordingId={recording.id}
          onSpeakerRenamed={() => {
            window.api.history.get(recording.folderPath).then(() => {})
          }}
        />
      )}

      {recording.summary.sections.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Summary</h2>
            <CopyButton
              label="Copy summary"
              getText={() => summaryToText(recording.summary.sections)}
            />
          </div>
          <SummaryView sections={recording.summary.sections} />
        </section>
      )}

      {recording.transcription.segments.length > 0 && (
        <section>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              className="flex items-center gap-2 text-sm font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-300"
            >
              <span className={`transition-transform ${showTranscript ? 'rotate-90' : ''}`}>&#9654;</span>
              Transcript
            </button>
            <CopyButton
              label="Copy transcript"
              getText={() =>
                transcriptToText(
                  recording.transcription.segments,
                  recording.transcription.speakerMap,
                  speakerNames,
                )
              }
            />
          </div>
          {showTranscript && (
            <div className="mt-4">
              <TranscriptView
                segments={recording.transcription.segments}
                speakerMap={recording.transcription.speakerMap}
                speakerNames={speakerNames}
              />
            </div>
          )}
        </section>
      )}

      <section className="mt-auto pt-6 border-t border-gray-700">
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Delete Recording
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-xs text-red-400">Are you sure? This cannot be undone.</span>
            <button
              onClick={() => onDelete(recording.folderPath)}
              className="text-xs px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-gray-400 hover:text-gray-300"
            >
              Cancel
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
